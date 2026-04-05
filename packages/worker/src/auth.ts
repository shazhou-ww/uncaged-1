/**
 * Auth handler — Platform-level authentication for Uncaged
 *
 * Routes:
 *   POST /auth/passkey/register/options  — Get WebAuthn registration challenge
 *   POST /auth/passkey/register/verify   — Verify registration and create credential
 *   POST /auth/passkey/login/options     — Get WebAuthn login challenge
 *   POST /auth/passkey/login/verify      — Verify login assertion
 *   GET  /auth/google/login              — Redirect to Google OAuth
 *   GET  /auth/google/callback           — Google OAuth callback
 *   GET  /auth/session                   — Current session info
 *   POST /auth/refresh                   — Refresh access token
 *   POST /auth/logout                    — Logout (revoke refresh token)
 *
 * Passkey (WebAuthn) verification uses pure Web Crypto API — no npm dependencies.
 * CBOR decoding is implemented inline (minimal, only what WebAuthn needs).
 * JWT signing/verification uses HMAC-SHA256 via crypto.subtle.
 *
 * TODO: Import Auth class from @uncaged/core/auth once it exists, replacing
 *       the inline JWT helpers below.
 */

import type { WorkerEnv } from './index.js'
import { IdentityResolver } from '@uncaged/core/identity'

// ─── Constants ───

const DEFAULT_RP_ID = 'uncaged.shazhou.work'
const RP_NAME = 'Uncaged'
const CHALLENGE_TTL = 60 // seconds
const ACCESS_TOKEN_TTL = 60 * 60 // 1 hour
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60 // 30 days

/** Get RP ID from env or use default */
function getRpId(env: WorkerEnv): string {
  return (env as any).AUTH_RP_ID || DEFAULT_RP_ID
}

// ─── Types ───

interface JWTPayload {
  sub: string // user_id
  iat: number
  exp: number
  type: 'access' | 'refresh'
  displayName?: string
}

interface ChallengeData {
  type: 'register' | 'login'
  userId: string | null
  displayName: string
  tempUserId?: string // random user ID for new registrations
}

interface WebAuthnRegistrationCredential {
  id: string // base64url credentialId
  rawId: string // base64url
  type: 'public-key'
  response: {
    attestationObject: string // base64url
    clientDataJSON: string // base64url
  }
}

interface WebAuthnLoginCredential {
  id: string // base64url credentialId
  rawId: string // base64url
  type: 'public-key'
  response: {
    authenticatorData: string // base64url
    clientDataJSON: string // base64url
    signature: string // base64url
    userHandle?: string // base64url
  }
}

// ─── Main Handler ───

export async function handleAuthRoutes(
  request: Request,
  env: WorkerEnv,
  pathname: string,
): Promise<Response | null> {
  // Guard: require SESSION_SECRET for auth to work
  if (!env.SESSION_SECRET && !env.SIGIL_DEPLOY_TOKEN) {
    return jsonError('Auth not configured: SESSION_SECRET missing', 503)
  }

  try {
    // ─── Passkey routes ───
    if (pathname === '/auth/passkey/register/options' && request.method === 'POST') {
      return await handlePasskeyRegisterOptions(request, env)
    }
    if (pathname === '/auth/passkey/register/verify' && request.method === 'POST') {
      return await handlePasskeyRegisterVerify(request, env)
    }
    if (pathname === '/auth/passkey/login/options' && request.method === 'POST') {
      return await handlePasskeyLoginOptions(request, env)
    }
    if (pathname === '/auth/passkey/login/verify' && request.method === 'POST') {
      return await handlePasskeyLoginVerify(request, env)
    }

    // ─── Google OAuth routes ───
    if (pathname === '/auth/google/login' && request.method === 'GET') {
      return handleGoogleLogin(request, env)
    }
    if (pathname === '/auth/google/callback' && request.method === 'GET') {
      return await handleGoogleCallback(request, env)
    }

    // ─── Magic Link routes ───
    if (pathname === '/auth/magic/send' && request.method === 'POST') {
      return handleMagicLinkSend(request, env)
    }
    if (pathname === '/auth/magic/verify' && request.method === 'GET') {
      return handleMagicLinkVerify(request, env)
    }

    // ─── Session management ───
    if (pathname === '/auth/session' && request.method === 'GET') {
      return await handleSession(request, env)
    }
    if (pathname === '/auth/refresh' && request.method === 'POST') {
      return await handleRefresh(request, env)
    }
    if (pathname === '/auth/logout' && request.method === 'POST') {
      return await handleLogout(request, env)
    }

    return null
  } catch (err: any) {
    console.error('[auth] unhandled error:', err)
    return jsonError('Internal server error', 500)
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Passkey — Registration
// ═══════════════════════════════════════════════════════════════════════════════

async function handlePasskeyRegisterOptions(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const kv = env.CHAT_KV
  const body = await safeJsonBody<{ displayName?: string }>(request)

  // Check if there's an authenticated user (linking a passkey to existing account)
  const existingUserId = await extractUserIdFromToken(request, env)
  const displayName = body?.displayName || 'User'

  // Generate challenge
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const challengeB64 = base64urlEncode(challenge)

  // Generate a random user ID for new registrations
  const tempUserId = existingUserId || crypto.randomUUID()
  const userIdBytes = new TextEncoder().encode(tempUserId)

  // Store challenge in KV
  const challengeData: ChallengeData = {
    type: 'register',
    userId: existingUserId,
    displayName,
    tempUserId,
  }
  await kv.put(
    `webauthn:challenge:${challengeB64}`,
    JSON.stringify(challengeData),
    { expirationTtl: CHALLENGE_TTL },
  )

  return jsonOk({
    challenge: challengeB64,
    rp: {
      name: RP_NAME,
      id: getRpId(env),
    },
    user: {
      id: base64urlEncode(userIdBytes),
      name: displayName,
      displayName,
    },
    pubKeyCredParams: [
      { alg: -7, type: 'public-key' }, // ES256 (P-256)
      { alg: -257, type: 'public-key' }, // RS256
    ],
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    timeout: 60000,
    attestation: 'none',
  })
}

async function handlePasskeyRegisterVerify(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const kv = env.CHAT_KV
  const db = env.MEMORY_DB
  if (!db) return jsonError('Database not configured', 503)

  const body = await safeJsonBody<{ credential: WebAuthnRegistrationCredential }>(request)
  if (!body?.credential) return jsonError('Missing credential', 400)

  const { credential } = body

  // 1. Parse clientDataJSON
  const clientDataBytes = base64urlDecode(credential.response.clientDataJSON)
  const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes))

  // Verify type
  if (clientData.type !== 'webauthn.create') {
    return jsonError('Invalid clientData type', 400)
  }

  // Verify origin
  const expectedOrigins = [`https://${getRpId(env)}`]
  if (!expectedOrigins.includes(clientData.origin)) {
    return jsonError('Invalid origin', 400)
  }

  // 2. Verify challenge from KV
  const challengeB64 = clientData.challenge
  const challengeKey = `webauthn:challenge:${challengeB64}`
  const challengeRaw = await kv.get(challengeKey)
  if (!challengeRaw) {
    return jsonError('Challenge expired or invalid', 400)
  }
  const challengeData: ChallengeData = JSON.parse(challengeRaw)
  if (challengeData.type !== 'register') {
    return jsonError('Challenge type mismatch', 400)
  }

  // 3. Parse attestationObject (CBOR)
  const attestationBytes = base64urlDecode(credential.response.attestationObject)
  const attestation = cborDecode(attestationBytes) as {
    fmt: string
    attStmt: Record<string, unknown>
    authData: Uint8Array
  }

  const authData = attestation.authData
  if (!(authData instanceof Uint8Array)) {
    return jsonError('Invalid authData', 400)
  }

  // 4. Verify rpIdHash (bytes 0-31)
  const rpIdHash = authData.slice(0, 32)
  const expectedRpIdHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(getRpId(env))),
  )
  if (!arrayBufferEqual(rpIdHash, expectedRpIdHash)) {
    return jsonError('RP ID hash mismatch', 400)
  }

  // 5. Check flags (byte 32)
  const flags = authData[32]
  const userPresent = (flags & 0x01) !== 0
  const attestedCredentialData = (flags & 0x40) !== 0
  if (!userPresent) {
    return jsonError('User presence flag not set', 400)
  }
  if (!attestedCredentialData) {
    return jsonError('Attested credential data flag not set', 400)
  }

  // 6. Parse attested credential data
  // bytes 33-36: counter (big-endian uint32)
  const counter = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0)

  // bytes 37-52: AAGUID (16 bytes) — we skip it
  let offset = 37 + 16 // 53

  // credentialId length (2 bytes big-endian)
  const credIdLen = new DataView(authData.buffer, authData.byteOffset + offset, 2).getUint16(0)
  offset += 2

  // credentialId
  const credentialIdBytes = authData.slice(offset, offset + credIdLen)
  const credentialIdB64 = base64urlEncode(credentialIdBytes)
  offset += credIdLen

  // COSE public key (CBOR encoded, remaining bytes)
  const coseKeyBytes = authData.slice(offset)
  const coseKey = cborDecode(coseKeyBytes) as Map<number, unknown>

  // 7. Extract and import public key
  const { cryptoKey, algorithmName, publicKeyBytes } = await importCoseKey(coseKey)

  // 8. Create or link user via IdentityResolver
  const identity = new IdentityResolver(db)
  const existingUserId = challengeData.userId
  let userId: string

  if (existingUserId) {
    // Linking passkey to existing user — just store credential
    userId = existingUserId
  } else {
    // New user registration
    // Use IdentityResolver to create the user with passkey credential
    const resolved = await identity.resolve({
      agentId: '__platform__',
      authType: 'passkey',
      externalId: credentialIdB64,
      displayName: challengeData.displayName,
      channelType: 'web',
      channelExternalId: credentialIdB64,
    })
    userId = resolved.userId

    // Update the credential with public key and metadata
    await db
      .prepare(
        'UPDATE credentials SET public_key = ?, metadata = ? WHERE type = ? AND external_id = ?',
      )
      .bind(
        publicKeyBytes as any,
        JSON.stringify({
          algorithm: algorithmName,
          counter,
          transports: [],
          createdAt: Date.now(),
        }),
        'passkey',
        credentialIdB64,
      )
      .run()

    // Delete challenge from KV
    await kv.delete(challengeKey)

    // 9. Issue JWT tokens and set HttpOnly cookies
    const { Auth } = await import('@uncaged/core/auth')
    const auth = new Auth(getJwtSecret(env), env.CHAT_KV)
    const tokens = await auth.issueTokens(userId, challengeData.displayName)
    const cookies = auth.buildCookies(tokens)

    const headers = new Headers()
    headers.append('Content-Type', 'application/json')
    headers.append('Set-Cookie', cookies.accessToken)
    headers.append('Set-Cookie', cookies.refreshToken)

    return new Response(JSON.stringify({
      verified: true,
      userId,
      tokens,
    }), { status: 200, headers })
  }

  // Linking to existing user — store credential directly
  const credId = crypto.randomUUID()
  await db
    .prepare(
      'INSERT INTO credentials (id, user_id, type, external_id, public_key, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      credId,
      userId,
      'passkey',
      credentialIdB64,
      publicKeyBytes as any,
      JSON.stringify({
        algorithm: algorithmName,
        counter,
        transports: [],
        createdAt: Date.now(),
      }),
      Date.now(),
    )
    .run()

  // Delete challenge from KV
  await kv.delete(challengeKey)

  // Issue JWT tokens and set HttpOnly cookies
  const { Auth } = await import('@uncaged/core/auth')
  const auth = new Auth(getJwtSecret(env), env.CHAT_KV)
  const tokens = await auth.issueTokens(userId, challengeData.displayName)
  const cookies = auth.buildCookies(tokens)

  const headers = new Headers()
  headers.append('Content-Type', 'application/json')
  headers.append('Set-Cookie', cookies.accessToken)
  headers.append('Set-Cookie', cookies.refreshToken)

  return new Response(JSON.stringify({
    verified: true,
    userId,
    tokens,
  }), { status: 200, headers })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Passkey — Login
// ═══════════════════════════════════════════════════════════════════════════════

async function handlePasskeyLoginOptions(
  _request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const kv = env.CHAT_KV

  // Generate challenge
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const challengeB64 = base64urlEncode(challenge)

  await kv.put(
    `webauthn:challenge:${challengeB64}`,
    JSON.stringify({ type: 'login' }),
    { expirationTtl: CHALLENGE_TTL },
  )

  return jsonOk({
    challenge: challengeB64,
    rpId: getRpId(env),
    userVerification: 'preferred',
    timeout: 60000,
  })
}

async function handlePasskeyLoginVerify(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  const kv = env.CHAT_KV
  const db = env.MEMORY_DB
  if (!db) return jsonError('Database not configured', 503)

  const body = await safeJsonBody<{ credential: WebAuthnLoginCredential }>(request)
  if (!body?.credential) return jsonError('Missing credential', 400)

  const { credential } = body

  // 1. Parse clientDataJSON
  const clientDataBytes = base64urlDecode(credential.response.clientDataJSON)
  const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes))

  // Verify type
  if (clientData.type !== 'webauthn.get') {
    return jsonError('Invalid clientData type', 400)
  }

  // Verify origin
  const expectedOrigins = [`https://${getRpId(env)}`]
  if (!expectedOrigins.includes(clientData.origin)) {
    return jsonError('Invalid origin', 400)
  }

  // 2. Verify challenge from KV
  const challengeB64 = clientData.challenge
  const challengeKey = `webauthn:challenge:${challengeB64}`
  const challengeRaw = await kv.get(challengeKey)
  if (!challengeRaw) {
    return jsonError('Challenge expired or invalid', 400)
  }
  const challengeDataParsed = JSON.parse(challengeRaw)
  if (challengeDataParsed.type !== 'login') {
    return jsonError('Challenge type mismatch', 400)
  }

  // 3. Look up credential in DB
  const credentialIdB64 = credential.id
  const credRow = await db
    .prepare(
      'SELECT c.id, c.user_id, c.public_key, c.metadata, u.display_name FROM credentials c JOIN users u ON c.user_id = u.id WHERE c.type = ? AND c.external_id = ?',
    )
    .bind('passkey', credentialIdB64)
    .first<{
      id: string
      user_id: string
      public_key: ArrayBuffer
      metadata: string
      display_name: string
    }>()

  if (!credRow) {
    return jsonError('Credential not found', 400)
  }

  const metadata = JSON.parse(credRow.metadata || '{}')
  const storedCounter: number = metadata.counter || 0
  const algorithmName: string = metadata.algorithm || 'ES256'

  // 4. Parse authenticatorData
  const authDataBytes = base64urlDecode(credential.response.authenticatorData)

  // Verify rpIdHash (bytes 0-31)
  const rpIdHash = authDataBytes.slice(0, 32)
  const expectedRpIdHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(getRpId(env))),
  )
  if (!arrayBufferEqual(rpIdHash, expectedRpIdHash)) {
    return jsonError('RP ID hash mismatch', 400)
  }

  // Check flags
  const flags = authDataBytes[32]
  const userPresent = (flags & 0x01) !== 0
  if (!userPresent) {
    return jsonError('User presence flag not set', 400)
  }

  // Counter (bytes 33-36)
  const counter = new DataView(
    authDataBytes.buffer,
    authDataBytes.byteOffset + 33,
    4,
  ).getUint32(0)

  // 5. Verify counter (if the authenticator supports counters)
  if (counter > 0 || storedCounter > 0) {
    if (counter <= storedCounter) {
      return jsonError('Counter replay detected — possible cloned authenticator', 400)
    }
  }

  // 6. Verify signature
  const signatureBytes = base64urlDecode(credential.response.signature)

  // The signed data is: authenticatorData || SHA-256(clientDataJSON)
  const clientDataHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', clientDataBytes),
  )
  const signedData = new Uint8Array(authDataBytes.length + clientDataHash.length)
  signedData.set(authDataBytes)
  signedData.set(clientDataHash, authDataBytes.length)

  // Import the stored public key
  const publicKeyBytes = new Uint8Array(credRow.public_key)
  const cryptoKey = await importStoredPublicKey(publicKeyBytes, algorithmName)

  const verifyAlgo = getVerifyAlgorithm(algorithmName)
  let sigToVerify = signatureBytes

  // For ECDSA, WebAuthn uses DER-encoded signatures, but Web Crypto expects raw (r||s)
  if (algorithmName === 'ES256') {
    sigToVerify = derToRaw(signatureBytes)
  }

  const valid = await crypto.subtle.verify(verifyAlgo, cryptoKey, sigToVerify, signedData)
  if (!valid) {
    return jsonError('Signature verification failed', 400)
  }

  // 7. Update counter in metadata
  metadata.counter = counter
  metadata.lastUsed = Date.now()
  await db
    .prepare('UPDATE credentials SET metadata = ? WHERE id = ?')
    .bind(JSON.stringify(metadata), credRow.id)
    .run()

  // 8. Delete challenge from KV
  await kv.delete(challengeKey)

  // 9. Issue JWT tokens and set HttpOnly cookies
  const { Auth } = await import('@uncaged/core/auth')
  const auth = new Auth(getJwtSecret(env), env.CHAT_KV)
  const tokens = await auth.issueTokens(credRow.user_id, credRow.display_name)
  const cookies = auth.buildCookies(tokens)

  const headers = new Headers()
  headers.append('Content-Type', 'application/json')
  headers.append('Set-Cookie', cookies.accessToken)
  headers.append('Set-Cookie', cookies.refreshToken)

  return new Response(JSON.stringify({
    verified: true,
    userId: credRow.user_id,
    displayName: credRow.display_name,
    tokens,
  }), { status: 200, headers })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Google OAuth
// ═══════════════════════════════════════════════════════════════════════════════

function handleGoogleLogin(_request: Request, env: WorkerEnv): Response {
  if (!env.GOOGLE_CLIENT_ID) {
    return jsonError('Google OAuth not configured', 503)
  }

  const callbackUrl = `https://${getRpId(env)}/auth/google/callback`
  const state = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)))

  const redirectUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(env.GOOGLE_CLIENT_ID)}&` +
    `redirect_uri=${encodeURIComponent(callbackUrl)}&` +
    `scope=${encodeURIComponent('openid email profile')}&` +
    `response_type=code&` +
    `state=${state}`

  return Response.redirect(redirectUrl, 302)
}

async function handleGoogleCallback(
  request: Request,
  env: WorkerEnv,
): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return jsonError('Google OAuth not configured', 503)
  }

  const db = env.MEMORY_DB
  if (!db) return jsonError('Database not configured', 503)

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error) {
    return jsonError(`OAuth error: ${error}`, 400)
  }
  if (!code) {
    return jsonError('Authorization code missing', 400)
  }

  const callbackUrl = `https://${getRpId(env)}/auth/google/callback`

  // Exchange code for token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: callbackUrl,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenResponse.ok) {
    const errBody = await tokenResponse.text()
    console.error('[auth/google] token exchange failed:', errBody)
    return jsonError('Token exchange failed', 500)
  }

  const tokenData = (await tokenResponse.json()) as { access_token: string }

  // Fetch user info
  const userInfoResponse = await fetch(
    'https://www.googleapis.com/oauth2/v2/userinfo',
    {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    },
  )

  if (!userInfoResponse.ok) {
    return jsonError('Failed to fetch user info', 500)
  }

  const userInfo = (await userInfoResponse.json()) as {
    email: string
    name: string
    picture: string
    sub: string
  }

  if (!userInfo.email) {
    return jsonError('Missing email from Google', 400)
  }

  // Resolve identity using IdentityResolver
  const identity = new IdentityResolver(db)
  const resolved = await identity.resolve({
    agentId: '__platform__',
    authType: 'google',
    externalId: userInfo.email,
    displayName: userInfo.name || userInfo.email,
    channelType: 'web',
    channelExternalId: userInfo.email,
  })

  // Store Google profile picture in credential metadata if this is a new user
  if (resolved.isNewUser && userInfo.picture) {
    await db
      .prepare(
        'UPDATE credentials SET metadata = ? WHERE type = ? AND external_id = ?',
      )
      .bind(
        JSON.stringify({ picture: userInfo.picture, googleSub: userInfo.sub }),
        'google',
        userInfo.email,
      )
      .run()
  }

  // Issue tokens and set cookies
  const { Auth } = await import('@uncaged/core/auth')
  const auth = new Auth(getJwtSecret(env), env.CHAT_KV)
  const tokens = await auth.issueTokens(
    resolved.userId,
    userInfo.name || userInfo.email,
  )
  const cookies = auth.buildCookies(tokens)

  // Redirect to user's agent page
  const user = await db.prepare("SELECT slug FROM users WHERE id = ?").bind(resolved.userId).first<{ slug: string }>()
  const agent = await db.prepare("SELECT slug FROM agents WHERE owner_id = ? LIMIT 1").bind(resolved.userId).first<{ slug: string }>()
  const redirectTo = (user?.slug && agent?.slug) ? `/${user.slug}/${agent.slug}/` : '/'

  const headers = new Headers()
  headers.append('Location', redirectTo)
  headers.append('Set-Cookie', cookies.accessToken)
  headers.append('Set-Cookie', cookies.refreshToken)

  return new Response(null, { status: 302, headers })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Session Management
// ═══════════════════════════════════════════════════════════════════════════════

async function handleSession(request: Request, env: WorkerEnv): Promise<Response> {
  const userId = await extractUserIdFromToken(request, env)
  if (!userId) {
    return jsonError('Not authenticated', 401)
  }

  const db = env.MEMORY_DB
  if (!db) return jsonError('Database not configured', 503)

  const user = await db
    .prepare('SELECT id, display_name, slug, created_at FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string; display_name: string; slug: string; created_at: number }>()

  if (!user) {
    return jsonError('User not found', 404)
  }

  // Fetch credentials for this user (without public_key for security)
  const creds = await db
    .prepare(
      'SELECT type, external_id, created_at FROM credentials WHERE user_id = ?',
    )
    .bind(userId)
    .all<{ type: string; external_id: string; created_at: number }>()

  // Fetch agents owned by this user
  const agents = await db
    .prepare(
      'SELECT id, slug, display_name FROM agents WHERE owner_id = ?',
    )
    .bind(userId)
    .all<{ id: string; slug: string; display_name: string }>()

  return jsonOk({
    user: {
      id: user.id,
      displayName: user.display_name,
      slug: user.slug,
      createdAt: user.created_at,
    },
    agents: (agents.results || []).map((a: { id: string; slug: string; display_name: string }) => ({
      id: a.id,
      slug: a.slug,
      displayName: a.display_name,
    })),
    credentials: creds.results.map((c: { type: string; external_id: string; created_at: number }) => ({
      type: c.type,
      externalId: c.type === 'passkey' ? c.external_id.slice(0, 8) + '...' : c.external_id,
      createdAt: c.created_at,
    })),
  })
}

async function handleRefresh(request: Request, env: WorkerEnv): Promise<Response> {
  const body = await safeJsonBody<{ refreshToken?: string }>(request)
  let refreshToken = body?.refreshToken

  // If no refresh token in body, try to get it from cookies
  if (!refreshToken) {
    const cookie = request.headers.get('Cookie') || ''
    const refreshTokenMatch = cookie.match(/refresh_token=([^;]+)/)
    if (refreshTokenMatch) {
      refreshToken = refreshTokenMatch[1]
    }
  }

  if (!refreshToken) {
    return jsonError('Missing refreshToken', 400)
  }

  const kv = env.CHAT_KV

  // Verify the refresh token
  const payload = await verifyJwt(refreshToken, env)
  if (!payload || payload.type !== 'refresh') {
    return jsonError('Invalid or expired refresh token', 401)
  }

  // Check if token has been revoked
  const revoked = await kv.get(`revoked:${refreshToken}`)
  if (revoked) {
    return jsonError('Token has been revoked', 401)
  }

  // Issue new access token and update the access_token cookie
  const accessToken = await signJwt(
    {
      sub: payload.sub,
      type: 'access',
      displayName: payload.displayName,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL,
    },
    env,
  )

  const headers = new Headers()
  headers.append('Content-Type', 'application/json')
  headers.append('Set-Cookie', `access_token=${accessToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${ACCESS_TOKEN_TTL}`)

  return new Response(JSON.stringify({
    accessToken,
    expiresIn: ACCESS_TOKEN_TTL,
  }), { status: 200, headers })
}

async function handleLogout(request: Request, env: WorkerEnv): Promise<Response> {
  const body = await safeJsonBody<{ refreshToken?: string }>(request)
  const kv = env.CHAT_KV

  // Try to get refresh token from body first, then from cookies
  let refreshTokenToRevoke = body?.refreshToken

  if (!refreshTokenToRevoke) {
    const cookie = request.headers.get('Cookie') || ''
    const refreshTokenMatch = cookie.match(/refresh_token=([^;]+)/)
    if (refreshTokenMatch) {
      refreshTokenToRevoke = refreshTokenMatch[1]
    }
  }

  // Revoke refresh token if found
  if (refreshTokenToRevoke) {
    const payload = await verifyJwt(refreshTokenToRevoke, env)
    if (payload && payload.type === 'refresh') {
      // Store in KV as revoked until it would have expired
      const ttl = payload.exp - Math.floor(Date.now() / 1000)
      if (ttl > 0) {
        await kv.put(`revoked:${refreshTokenToRevoke}`, '1', {
          expirationTtl: ttl,
        })
      }
    }
  }

  // Clear cookies by setting them with Max-Age=0
  const headers = new Headers()
  headers.append('Content-Type', 'application/json')
  headers.append('Set-Cookie', 'access_token=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0')
  headers.append('Set-Cookie', 'refresh_token=; HttpOnly; Secure; SameSite=Lax; Path=/auth/refresh; Max-Age=0')

  return new Response(JSON.stringify({ loggedOut: true }), {
    status: 200,
    headers,
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Magic Link — Email-based authentication
// ═══════════════════════════════════════════════════════════════════════════════

// POST /auth/magic/send
async function handleMagicLinkSend(request: Request, env: WorkerEnv): Promise<Response> {
  const kv = env.CHAT_KV
  const db = env.MEMORY_DB
  if (!kv || !db) return jsonError('Not configured', 503)

  const body = await safeJsonBody<{ email?: string }>(request)
  const email = body?.email?.trim().toLowerCase()
  if (!email || !email.includes('@')) return jsonError('Valid email required', 400)

  // Find or create user by email
  let userId: string | null = null
  let displayName = email.split('@')[0]

  // Check credentials for this email (type=email or type=google)
  const cred = await db.prepare(
    "SELECT user_id FROM credentials WHERE external_id = ? AND type IN ('email', 'google') LIMIT 1"
  ).bind(email).first<{ user_id: string }>()

  if (cred) {
    userId = cred.user_id
    const user = await db.prepare("SELECT display_name FROM users WHERE id = ?").bind(userId).first<{ display_name: string }>()
    if (user) displayName = user.display_name
  } else {
    // Create new user + email credential
    userId = crypto.randomUUID()
    const shortId = `u_${Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')}`
    const slug = email.split('@')[0].replace(/[^a-z0-9-]/g, '-').slice(0, 30)
    const now = Date.now()
    
    await db.batch([
      db.prepare("INSERT INTO users (id, display_name, slug, short_id, created_at) VALUES (?, ?, ?, ?, ?)").bind(userId, displayName, slug, shortId, now),
      db.prepare("INSERT INTO credentials (id, user_id, type, external_id, created_at) VALUES (?, ?, 'email', ?, ?)").bind(crypto.randomUUID(), userId, email, now),
    ])
  }

  // Generate magic token
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32))
  const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('')
  
  // Store in KV with 10-minute TTL
  await kv.put(`magic:${token}`, JSON.stringify({ userId, email, createdAt: Date.now() }), { expirationTtl: 600 })

  // Send magic link email via Resend
  const magicLink = `https://${getRpId(env)}/auth/magic/verify?token=${token}`

  if (!env.RESEND_API_KEY) {
    console.warn('[Auth] RESEND_API_KEY not set, returning link as fallback')
    return jsonOk({ ok: true, message: 'Email not configured, use link directly', link: magicLink })
  }

  // Send magic link email via MailChannels
  try {
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Uncaged <noreply@shazhou.work>',
        to: [email],
        subject: '🔐 Uncaged 登录链接',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px; background: #0a0a0a; color: #fff; border-radius: 16px;">
            <div style="text-align: center; margin-bottom: 24px;">
              <span style="font-size: 48px;">🔓</span>
              <h2 style="color: #fbbf24; margin: 8px 0 0;">Uncaged</h2>
            </div>
            <p style="color: #d1d5db; font-size: 15px; text-align: center; margin-bottom: 32px;">
              点击下方按钮登录你的账号，链接 10 分钟内有效。
            </p>
            <div style="text-align: center; margin: 24px 0;">
              <a href="${magicLink}" style="display: inline-block; background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #0a0a0a; padding: 14px 40px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 16px;">
                登录 Uncaged
              </a>
            </div>
            <p style="color: #6b7280; font-size: 13px; text-align: center; margin-top: 32px;">
              如果这不是你的请求，请忽略此邮件。
            </p>
            <div style="border-top: 1px solid #1f2937; margin-top: 32px; padding-top: 16px; text-align: center;">
              <span style="color: #374151; font-size: 12px;">uncaged.shazhou.work</span>
            </div>
          </div>
        `,
      }),
    })

    if (!emailResponse.ok) {
      const errBody = await emailResponse.text()
      console.error('[Auth] Resend send failed:', emailResponse.status, errBody)
      // Don't fail the request — still return the link as fallback
    }
  } catch (err) {
    console.error('[Auth] Email send error:', err)
    // Don't fail — fallback to showing link
  }

  return jsonOk({
    ok: true,
    message: 'Login link sent to your email',
    // Keep link in response for now as fallback (some email providers may block MailChannels)
    // TODO: remove once email delivery is confirmed reliable
    link: magicLink,
  })
}

// GET /auth/magic/verify?token=xxx
async function handleMagicLinkVerify(request: Request, env: WorkerEnv): Promise<Response> {
  const kv = env.CHAT_KV
  const db = env.MEMORY_DB
  if (!kv || !db) return jsonError('Not configured', 503)

  const url = new URL(request.url)
  const token = url.searchParams.get('token')
  if (!token) return jsonError('Token required', 400)

  // Look up magic token
  const data = await kv.get(`magic:${token}`, 'json') as { userId: string; email: string } | null
  if (!data) return jsonError('Invalid or expired link', 401)

  // Delete token (one-time use)
  await kv.delete(`magic:${token}`)

  // Get user info
  const user = await db.prepare("SELECT id, display_name, slug FROM users WHERE id = ?").bind(data.userId).first<{ id: string; display_name: string; slug: string }>()
  if (!user) return jsonError('User not found', 404)

  // Issue JWT tokens using the Auth class from core
  const secret = env.SESSION_SECRET || env.SIGIL_DEPLOY_TOKEN
  if (!secret) return jsonError('Auth not configured', 503)

  // Import and use the Auth class from core
  const { Auth } = await import('@uncaged/core/auth')
  const auth = new Auth(secret, env.CHAT_KV)
  const tokens = await auth.issueTokens(user.id, user.display_name)
  const cookies = auth.buildCookies(tokens)

  // Redirect to home with cookies set
  // Try to find an agent owned by this user for the redirect target
  const agent = await db.prepare("SELECT slug FROM agents WHERE owner_id = ? LIMIT 1").bind(user.id).first<{ slug: string }>()
  const redirectTo = agent ? `/${user.slug}/${agent.slug}/` : '/'

  const headers = new Headers()
  headers.append('Location', redirectTo)
  headers.append('Set-Cookie', cookies.accessToken)
  headers.append('Set-Cookie', cookies.refreshToken)

  return new Response(null, { status: 302, headers })
}

// ═══════════════════════════════════════════════════════════════════════════════
// JWT Helpers (inline HMAC-SHA256 — TODO: replace with @uncaged/core/auth)
// ═══════════════════════════════════════════════════════════════════════════════

function getJwtSecret(env: WorkerEnv): string {
  // Use SESSION_SECRET if available, otherwise fall back to SIGIL_DEPLOY_TOKEN
  return env.SESSION_SECRET || env.SIGIL_DEPLOY_TOKEN
}

async function getHmacKey(env: WorkerEnv): Promise<CryptoKey> {
  const secret = getJwtSecret(env)
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function signJwt(payload: JWTPayload, env: WorkerEnv): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const headerB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(header)))
  const payloadB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)))
  const signingInput = `${headerB64}.${payloadB64}`

  const key = await getHmacKey(env)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput))
  const sigB64 = base64urlEncode(new Uint8Array(sig))

  return `${signingInput}.${sigB64}`
}

async function verifyJwt(
  token: string,
  env: WorkerEnv,
): Promise<JWTPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [headerB64, payloadB64, sigB64] = parts
  const signingInput = `${headerB64}.${payloadB64}`

  const key = await getHmacKey(env)
  const sig = base64urlDecode(sigB64)
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    sig,
    new TextEncoder().encode(signingInput),
  )
  if (!valid) return null

  const payload: JWTPayload = JSON.parse(
    new TextDecoder().decode(base64urlDecode(payloadB64)),
  )

  // Check expiration
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp && payload.exp < now) return null

  return payload
}

async function issueTokens(
  userId: string,
  displayName: string,
  env: WorkerEnv,
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const now = Math.floor(Date.now() / 1000)

  const accessToken = await signJwt(
    {
      sub: userId,
      type: 'access',
      displayName,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL,
    },
    env,
  )

  const refreshToken = await signJwt(
    {
      sub: userId,
      type: 'refresh',
      displayName,
      iat: now,
      exp: now + REFRESH_TOKEN_TTL,
    },
    env,
  )

  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL }
}

/** Exported version for use by other modules (e.g., index.ts chat API) */
export async function extractUserIdFromRequest(
  request: Request,
  env: WorkerEnv,
): Promise<string | null> {
  return extractUserIdFromToken(request, env)
}

async function extractUserIdFromToken(
  request: Request,
  env: WorkerEnv,
): Promise<string | null> {
  // 1. Check Authorization header first (for API clients)
  const authHeader = request.headers.get('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    const payload = await verifyJwt(token, env)
    // Accept tokens with type='access' or no type field (core auth compat)
    if (payload && (!payload.type || payload.type === 'access')) {
      return payload.sub
    }
  }

  // 2. Check cookies (for web clients)
  const cookie = request.headers.get('Cookie') || ''
  const accessTokenMatch = cookie.match(/access_token=([^;]+)/)
  if (accessTokenMatch) {
    const token = accessTokenMatch[1]
    const payload = await verifyJwt(token, env)
    // Accept tokens with type='access' or no type field (core auth compat)
    if (payload && (!payload.type || payload.type === 'access')) {
      return payload.sub
    }
  }

  return null
}

// ═══════════════════════════════════════════════════════════════════════════════
// CBOR Decoder — Minimal, only what WebAuthn attestation/COSE needs
// ═══════════════════════════════════════════════════════════════════════════════

function cborDecode(data: Uint8Array): unknown {
  let offset = 0

  function readUint8(): number {
    return data[offset++]
  }

  function readUint16(): number {
    const val = (data[offset] << 8) | data[offset + 1]
    offset += 2
    return val
  }

  function readUint32(): number {
    const val =
      ((data[offset] << 24) >>> 0) |
      (data[offset + 1] << 16) |
      (data[offset + 2] << 8) |
      data[offset + 3]
    offset += 4
    return val >>> 0 // ensure unsigned
  }

  function readBytes(len: number): Uint8Array {
    const slice = data.slice(offset, offset + len)
    offset += len
    return slice
  }

  function readArgument(additionalInfo: number): number {
    if (additionalInfo < 24) return additionalInfo
    if (additionalInfo === 24) return readUint8()
    if (additionalInfo === 25) return readUint16()
    if (additionalInfo === 26) return readUint32()
    // 27 = uint64 — not needed for WebAuthn, but handle as best-effort
    if (additionalInfo === 27) {
      // Read 8 bytes as a number (loses precision for very large values)
      const hi = readUint32()
      const lo = readUint32()
      return hi * 0x100000000 + lo
    }
    throw new Error(`CBOR: unsupported additional info ${additionalInfo}`)
  }

  function decode(): unknown {
    const initial = readUint8()
    const majorType = initial >> 5
    const additionalInfo = initial & 0x1f

    switch (majorType) {
      case 0: // unsigned integer
        return readArgument(additionalInfo)

      case 1: // negative integer
        return -1 - readArgument(additionalInfo)

      case 2: { // byte string
        const len = readArgument(additionalInfo)
        return readBytes(len)
      }

      case 3: { // text string
        const len = readArgument(additionalInfo)
        const bytes = readBytes(len)
        return new TextDecoder().decode(bytes)
      }

      case 4: { // array
        const len = readArgument(additionalInfo)
        const arr: unknown[] = []
        for (let i = 0; i < len; i++) {
          arr.push(decode())
        }
        return arr
      }

      case 5: { // map
        const len = readArgument(additionalInfo)
        const map = new Map<unknown, unknown>()
        for (let i = 0; i < len; i++) {
          const key = decode()
          const value = decode()
          map.set(key, value)
        }
        // Also return as plain object for string keys
        const obj: Record<string, unknown> = {}
        let hasStringKeys = false
        for (const [k, v] of map) {
          if (typeof k === 'string') {
            obj[k] = v
            hasStringKeys = true
          }
        }
        // If all keys are strings, return plain object; otherwise return Map
        if (hasStringKeys && map.size === Object.keys(obj).length) {
          return obj
        }
        return map
      }

      case 7: { // simple values and floats
        if (additionalInfo === 20) return false
        if (additionalInfo === 21) return true
        if (additionalInfo === 22) return null
        if (additionalInfo === 23) return undefined
        if (additionalInfo === 25) {
          // float16 — skip 2 bytes, rarely used in WebAuthn
          offset += 2
          return 0
        }
        if (additionalInfo === 26) {
          // float32
          const buf = new DataView(data.buffer, data.byteOffset + offset, 4)
          offset += 4
          return buf.getFloat32(0)
        }
        if (additionalInfo === 27) {
          // float64
          const buf = new DataView(data.buffer, data.byteOffset + offset, 8)
          offset += 8
          return buf.getFloat64(0)
        }
        return additionalInfo
      }

      default:
        throw new Error(`CBOR: unsupported major type ${majorType}`)
    }
  }

  return decode()
}

// ═══════════════════════════════════════════════════════════════════════════════
// COSE Key → Web Crypto Key
// ═══════════════════════════════════════════════════════════════════════════════

async function importCoseKey(
  coseKey: Map<number, unknown> | Record<string, unknown>,
): Promise<{ cryptoKey: CryptoKey; algorithmName: string; publicKeyBytes: Uint8Array }> {
  // COSE key parameters:
  //  1 = kty (key type)
  //  3 = alg (algorithm)
  // -1 = crv (curve, for EC)
  // -2 = x (x coordinate, for EC)
  // -3 = y (y coordinate, for EC)
  // -1 = n (modulus, for RSA)
  // -2 = e (exponent, for RSA)

  const get = (key: number): unknown => {
    if (coseKey instanceof Map) return coseKey.get(key)
    return (coseKey as any)[key]
  }

  const kty = get(1) as number
  const alg = get(3) as number

  if (kty === 2 && alg === -7) {
    // EC2 key, ES256 (P-256)
    const x = get(-2) as Uint8Array
    const y = get(-3) as Uint8Array

    if (!x || !y || x.length !== 32 || y.length !== 32) {
      throw new Error('Invalid EC2 key coordinates')
    }

    // Build uncompressed point: 0x04 || x || y
    const publicKeyBytes = new Uint8Array(65)
    publicKeyBytes[0] = 0x04
    publicKeyBytes.set(x, 1)
    publicKeyBytes.set(y, 33)

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify'],
    )

    return { cryptoKey, algorithmName: 'ES256', publicKeyBytes }
  }

  if (kty === 3 && alg === -257) {
    // RSA key, RS256
    const n = get(-1) as Uint8Array
    const e = get(-2) as Uint8Array

    if (!n || !e) {
      throw new Error('Invalid RSA key parameters')
    }

    // Build JWK for import
    const jwk: JsonWebKey = {
      kty: 'RSA',
      alg: 'RS256',
      n: base64urlEncode(n),
      e: base64urlEncode(e),
      ext: true,
    }

    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk as any,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      true,
      ['verify'],
    )

    // Export as SPKI for storage
    const spki = new Uint8Array(
      await crypto.subtle.exportKey('spki', cryptoKey) as ArrayBuffer,
    )

    return { cryptoKey, algorithmName: 'RS256', publicKeyBytes: spki }
  }

  throw new Error(`Unsupported COSE key type: kty=${kty}, alg=${alg}`)
}

async function importStoredPublicKey(
  publicKeyBytes: Uint8Array,
  algorithmName: string,
): Promise<CryptoKey> {
  if (algorithmName === 'ES256') {
    // Stored as uncompressed point (65 bytes: 0x04 || x || y)
    return crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
  }

  if (algorithmName === 'RS256') {
    // Stored as SPKI
    return crypto.subtle.importKey(
      'spki',
      publicKeyBytes,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
  }

  throw new Error(`Unsupported algorithm: ${algorithmName}`)
}

function getVerifyAlgorithm(
  algorithmName: string,
): { name: string; hash?: string } {
  if (algorithmName === 'ES256') {
    return { name: 'ECDSA', hash: 'SHA-256' }
  }
  if (algorithmName === 'RS256') {
    return { name: 'RSASSA-PKCS1-v1_5' }
  }
  throw new Error(`Unsupported algorithm: ${algorithmName}`)
}

// ═══════════════════════════════════════════════════════════════════════════════
// DER → Raw ECDSA Signature Conversion
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert a DER-encoded ECDSA signature to raw format (r || s).
 * WebAuthn returns DER, but Web Crypto expects raw.
 *
 * DER structure:
 *   SEQUENCE { INTEGER r, INTEGER s }
 *   30 <len> 02 <rlen> <r> 02 <slen> <s>
 */
function derToRaw(derSig: Uint8Array): Uint8Array {
  // Validate SEQUENCE tag
  if (derSig[0] !== 0x30) {
    throw new Error('Invalid DER signature: expected SEQUENCE tag')
  }

  let offset = 2 // skip SEQUENCE tag and length

  // Handle multi-byte length
  if (derSig[1] & 0x80) {
    const lenBytes = derSig[1] & 0x7f
    offset = 2 + lenBytes
  }

  // Parse r
  if (derSig[offset] !== 0x02) {
    throw new Error('Invalid DER signature: expected INTEGER tag for r')
  }
  offset++
  const rLen = derSig[offset++]
  let rBytes = derSig.slice(offset, offset + rLen)
  offset += rLen

  // Parse s
  if (derSig[offset] !== 0x02) {
    throw new Error('Invalid DER signature: expected INTEGER tag for s')
  }
  offset++
  const sLen = derSig[offset++]
  let sBytes = derSig.slice(offset, offset + sLen)

  // Remove leading zero byte if present (DER encodes as signed, but r/s are unsigned)
  if (rBytes.length === 33 && rBytes[0] === 0x00) rBytes = rBytes.slice(1)
  if (sBytes.length === 33 && sBytes[0] === 0x00) sBytes = sBytes.slice(1)

  // Pad to 32 bytes each (P-256)
  const raw = new Uint8Array(64)
  raw.set(rBytes, 32 - rBytes.length)
  raw.set(sBytes, 64 - sBytes.length)

  return raw
}

// ═══════════════════════════════════════════════════════════════════════════════
// Base64url Encoding/Decoding
// ═══════════════════════════════════════════════════════════════════════════════

function base64urlEncode(data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(str: string): Uint8Array {
  // Add padding
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4)
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// ═══════════════════════════════════════════════════════════════════════════════
// Utility Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function arrayBufferEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

async function safeJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T
  } catch {
    return null
  }
}
