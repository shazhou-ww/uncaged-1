/**
 * JWT Authentication — Platform-level auth for Uncaged
 *
 * Uses HMAC-SHA256 via Web Crypto API (no external deps, CF Workers compatible).
 *
 * Token strategy:
 *   access_token:  15 min, self-contained, Worker-local verification (zero KV lookup)
 *   refresh_token: 7 days, stored in KV (refresh:{token} → userId), revocable
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JwtPayload {
  sub: string   // user_id
  name: string  // display_name
  iat: number   // issued at (seconds)
  exp: number   // expires (seconds)
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number  // access token TTL in seconds
}

export interface CookieOptions {
  accessToken: string   // Set-Cookie header value for access_token
  refreshToken: string  // Set-Cookie header value for refresh_token
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCESS_TOKEN_TTL = 900        // 15 minutes
const REFRESH_TOKEN_TTL = 604800    // 7 days

/** Pre-encoded JWT header: {"alg":"HS256","typ":"JWT"} */
const JWT_HEADER = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// ---------------------------------------------------------------------------
// Base64url helpers
// ---------------------------------------------------------------------------

function base64urlEncode(data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(str: string): Uint8Array {
  // Restore standard base64
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  // Re-add padding
  const pad = base64.length % 4
  if (pad === 2) base64 += '=='
  else if (pad === 3) base64 += '='

  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// ---------------------------------------------------------------------------
// Auth class
// ---------------------------------------------------------------------------

export class Auth {
  private secret: string
  private kv: KVNamespace

  constructor(secret: string, kv: KVNamespace) {
    this.secret = secret
    this.kv = kv
  }

  // -------------------------------------------------------------------------
  // Key import (cached per-instance via the subtle API)
  // -------------------------------------------------------------------------

  private async getKey(): Promise<CryptoKey> {
    const enc = new TextEncoder()
    return crypto.subtle.importKey(
      'raw',
      enc.encode(this.secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    )
  }

  // -------------------------------------------------------------------------
  // Low-level JWT helpers
  // -------------------------------------------------------------------------

  private async sign(payload: JwtPayload): Promise<string> {
    const enc = new TextEncoder()
    const payloadB64 = base64urlEncode(enc.encode(JSON.stringify(payload)))
    const signingInput = `${JWT_HEADER}.${payloadB64}`

    const key = await this.getKey()
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(signingInput))

    return `${signingInput}.${base64urlEncode(new Uint8Array(sig))}`
  }

  private async verify(token: string): Promise<JwtPayload | null> {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [header, payload, signature] = parts
    if (header !== JWT_HEADER) return null

    const enc = new TextEncoder()
    const signingInput = `${header}.${payload}`

    const key = await this.getKey()
    const sigBytes = base64urlDecode(signature)

    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(signingInput))
    if (!valid) return null

    try {
      const decoded = JSON.parse(new TextDecoder().decode(base64urlDecode(payload))) as JwtPayload & {
        type?: string
      }
      // Reject legacy refresh JWTs if presented as access tokens (e.g. Bearer misuse)
      if (decoded.type === 'refresh') return null
      const now = Math.floor(Date.now() / 1000)
      if (decoded.exp <= now) return null
      return decoded
    } catch {
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Sign a JWT access token (15 min TTL) */
  async signAccessToken(userId: string, displayName: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    return this.sign({
      sub: userId,
      name: displayName,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL,
    })
  }

  /** Sign a refresh token (7 day TTL, stored in KV) */
  async signRefreshToken(userId: string): Promise<string> {
    const token = crypto.randomUUID()
    const issuedAt = Math.floor(Date.now() / 1000)
    await this.kv.put(
      `refresh:${token}`,
      JSON.stringify({ userId, issuedAt }),
      { expirationTtl: REFRESH_TOKEN_TTL },
    )
    return token
  }

  /** Issue both tokens */
  async issueTokens(userId: string, displayName: string): Promise<TokenPair> {
    const [accessToken, refreshToken] = await Promise.all([
      this.signAccessToken(userId, displayName),
      this.signRefreshToken(userId),
    ])
    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL }
  }

  /** Verify access token — returns payload or null. Zero KV lookups. */
  async verifyAccessToken(token: string): Promise<JwtPayload | null> {
    return this.verify(token)
  }

  /** Refresh: verify refresh token from KV, issue new access token */
  async refresh(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresIn: number } | null> {
    const raw = await this.kv.get(`refresh:${refreshToken}`)
    if (!raw) return null

    let data: { userId: string; issuedAt: number }
    try {
      data = JSON.parse(raw)
    } catch {
      return null
    }

    // We need display name for the access token — look up isn't possible here
    // without DB access, so we embed the userId only. Callers who need the name
    // should pass it. For refresh we use a minimal payload.
    // Actually: the spec says the access token includes `name`. Since we only
    // have userId in KV, we use an empty string and let the caller patch it.
    // Better: store displayName in KV too. But the spec says KV value is
    // { userId, issuedAt }. We'll issue a token with sub=userId and name="" —
    // the caller (refresh endpoint) should look up the display name if needed,
    // or we can adjust. For now, keep it simple: store userId in KV, use userId
    // as name fallback.
    const accessToken = await this.signAccessToken(data.userId, data.userId)
    return { accessToken, expiresIn: ACCESS_TOKEN_TTL }
  }

  /** Revoke refresh token (logout) */
  async revokeRefreshToken(refreshToken: string): Promise<void> {
    await this.kv.delete(`refresh:${refreshToken}`)
  }

  /** Build Set-Cookie headers for both tokens */
  buildCookies(tokens: TokenPair): CookieOptions {
    return {
      accessToken: `access_token=${tokens.accessToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${ACCESS_TOKEN_TTL}`,
      refreshToken: `refresh_token=${tokens.refreshToken}; HttpOnly; Secure; SameSite=Lax; Path=/auth/refresh; Max-Age=${REFRESH_TOKEN_TTL}`,
    }
  }

  /** Extract access token from request (cookie or Authorization header) */
  extractToken(request: Request): string | null {
    // Priority 1: Authorization header
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim()
      if (token) return token
    }

    // Priority 2: access_token cookie
    const cookie = request.headers.get('Cookie')
    if (cookie) {
      const match = cookie.match(/(?:^|;\s*)access_token=([^;]+)/)
      if (match) return match[1]
    }

    return null
  }

  /** Middleware-style: verify request and return payload or null */
  async authenticate(request: Request): Promise<JwtPayload | null> {
    const token = this.extractToken(request)
    if (!token) return null
    return this.verifyAccessToken(token)
  }
}
