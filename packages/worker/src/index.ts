// Unified Uncaged Worker — one codebase, N agent instances
// Phase 2: Slug resolution and short ID routing with D1 database
// Phase 3a: Capabilities data layer and CRUD API

import type { Env } from '@uncaged/core/env'
import { SigilClient } from '@uncaged/core/sigil'
import { LlmClient } from '@uncaged/core/llm'
import { ChatStore } from '@uncaged/core/chat-store'
import { Soul } from '@uncaged/core/soul'
import { Memory } from '@uncaged/core/memory'
import { BatonStore, type BatonEvent } from '@uncaged/core/baton'
import { handleBatonQueue, type NotifyFn } from '@uncaged/core/baton-runner'
import { IdentityResolver } from '@uncaged/core/identity'
import { handleCommonRoutes, type CoreClients } from './router.js'
import { handleTelegramRoutes, sendTelegram } from './channels/telegram.js'
import { handleWebRoutes } from './channels/web.js'
import { SlugResolver } from './slug-resolver.js'
import { handleCapabilitiesRoutes } from './capabilities.js'
import { handleAgentCapabilitiesRoutes } from './agent-capabilities.js'
import { 
  handleCapabilityDeploy, 
  handleCapabilityInvoke, 
  handleCapabilityQuery, 
  handleCapabilityInspect 
} from './sigil-routes.js'
import { handleAuthRoutes } from './auth.js'
import { getManifestJSON } from './pages/manifest.js'

// Re-export RunnerHub so wrangler can find the Durable Object class
export { RunnerHub } from '@uncaged/core/runner-hub'

// Unified environment — all channel secrets are optional
export interface WorkerEnv extends Env {
  // Telegram channel (optional)
  TELEGRAM_BOT_TOKEN?: string
  ALLOWED_CHAT_IDS?: string
  // Web channel (optional)
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  SESSION_SECRET?: string
  // Email (Resend)
  RESEND_API_KEY?: string
  // Comma-separated list of instanceIds that enable web channel (e.g. "xiaomai,another")
  WEB_INSTANCES?: string
  // Sigil execution engine bindings (Phase 3b)
  SIGIL_KV?: KVNamespace
  LOADER?: any  // worker_loaders binding
  // Static assets binding (React SPA)
  ASSETS: Fetcher
}

// Session interface (used by web channel)
export interface UserSession {
  email: string
  name: string
  picture: string
  created_at: number
}

/** SHA-256 hash using Web Crypto (available in CF Workers) */
async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Check if this instance has web channel enabled */
function isWebInstance(env: WorkerEnv, instanceId: string): boolean {
  if (!env.WEB_INSTANCES) return false
  const allowed = new Set(env.WEB_INSTANCES.split(',').map(s => s.trim()))
  return allowed.has(instanceId)
}

/** Resolve routing path to instanceId using SlugResolver */
async function resolveRouting(
  env: WorkerEnv,
  pathname: string
): Promise<{ instanceId?: string; redirect?: string; ownerOnly?: boolean; ownerId?: string; ownerSlug?: string; agentId?: string } | null> {
  if (!env.MEMORY_DB || !env.CHAT_KV) {
    console.error('[Routing] MEMORY_DB or CHAT_KV not configured')
    return null
  }

  const slugResolver = new SlugResolver(env.MEMORY_DB, env.CHAT_KV)

  // Handle /id/ routing
  if (pathname.startsWith('/id/')) {
    const idRoute = parseIdRoute(pathname)
    if (!idRoute) return null

    const resolved = await slugResolver.resolveById(idRoute.ownerShortId, idRoute.agentShortId)
    if (!resolved) return null

    // For backward compatibility, use agent slug as instanceId
    return { 
      instanceId: resolved.agentSlug,
      ownerId: resolved.ownerId,
      ownerSlug: resolved.ownerSlug,
      agentId: resolved.agentId
    }
  }

  // Check for owner-level routes: /:owner/api/v1/capabilities/...
  const ownerRoute = parseOwnerLevelRoute(pathname)
  if (ownerRoute) {
    // Check for redirects first
    const ownerRedirect = await slugResolver.checkRedirect('user', ownerRoute.ownerSlug)
    if (ownerRedirect) {
      return { 
        redirect: `/${ownerRedirect}/api/v1/capabilities${ownerRoute.remainingPath}`
      }
    }

    // Resolve owner only
    const resolved = await slugResolver.resolveOwnerBySlug(ownerRoute.ownerSlug)
    if (!resolved) return null

    return {
      ownerOnly: true,
      ownerId: resolved.ownerId,
      ownerSlug: resolved.ownerSlug
    }
  }

  // Handle platform capabilities route: /platform/capabilities
  if (pathname.startsWith('/platform/capabilities')) {
    return {
      ownerOnly: true,
      ownerId: '__platform__',
      ownerSlug: 'platform'
    }
  }

  // Handle slug routing
  const slugRoute = parseSlugRoute(pathname)
  if (!slugRoute) return null

  // Check for redirects first
  const ownerRedirect = await slugResolver.checkRedirect('user', slugRoute.ownerSlug)
  if (ownerRedirect) {
    return { 
      redirect: `/${ownerRedirect}/${slugRoute.agentSlug}` 
    }
  }

  const agentRedirect = await slugResolver.checkRedirect('agent', slugRoute.agentSlug)
  if (agentRedirect) {
    return { 
      redirect: `/${slugRoute.ownerSlug}/${agentRedirect}` 
    }
  }

  // Resolve current slugs
  const resolved = await slugResolver.resolveBySlug(slugRoute.ownerSlug, slugRoute.agentSlug)
  if (!resolved) return null

  // For backward compatibility, use agent slug as instanceId
  return { 
    instanceId: resolved.agentSlug,
    ownerId: resolved.ownerId,
    ownerSlug: resolved.ownerSlug,
    agentId: resolved.agentId
  }
}

/** Remove routing prefix from pathname */
function stripRoutePrefix(url: URL, isIdRoute: boolean): string {
  if (url.hostname === 'uncaged.shazhou.work') {
    const pathSegments = url.pathname.split('/').filter(Boolean)
    
    if (isIdRoute) {
      // Remove /id/owner_short_id/agent_short_id prefix
      if (pathSegments.length >= 3 && pathSegments[0] === 'id') {
        const remainingSegments = pathSegments.slice(3)
        return remainingSegments.length > 0 ? `/${remainingSegments.join('/')}` : '/'
      }
    } else {
      // Remove /owner/agent prefix  
      if (pathSegments.length >= 2) {
        const remainingSegments = pathSegments.slice(2)
        return remainingSegments.length > 0 ? `/${remainingSegments.join('/')}` : '/'
      }
    }
  }
  // For legacy domains, return original pathname
  return url.pathname
}

/** Normalize API versioned paths to legacy paths */
function normalizeApiPath(pathname: string): string {
  // Strip /api/v1 prefix if present
  if (pathname.startsWith('/api/v1/')) {
    return pathname.slice(7) // '/api/v1/chat' → '/chat'
  }
  if (pathname === '/api/v1') {
    return '/'
  }
  return pathname
}

/** Check if path matches reserved platform prefixes */
function isReservedPrefix(pathname: string): boolean {
  // Note: /id/ is NOT reserved — handled by SlugResolver for short ID routing
  // Note: /platform/ is NOT reserved — handled by resolveRouting for platform capabilities
  const reservedPrefixes = ['/auth/', '/admin/', '/.well-known/']
  return reservedPrefixes.some(prefix => pathname.startsWith(prefix))
}

/** Parse /id/ routing path */
function parseIdRoute(pathname: string): { ownerShortId: string; agentShortId: string } | null {
  // Match /id/:owner_short_id/:agent_short_id/...
  const match = pathname.match(/^\/id\/([^\/]+)\/([^\/]+)(?:\/.*)?$/)
  if (!match) return null
  return {
    ownerShortId: match[1],
    agentShortId: match[2]
  }
}

/** Parse slug routing path */  
function parseSlugRoute(pathname: string): { ownerSlug: string; agentSlug: string } | null {
  // Match /:owner_slug/:agent_slug/...
  const pathSegments = pathname.split('/').filter(Boolean)
  if (pathSegments.length < 2) return null
  return {
    ownerSlug: pathSegments[0],
    agentSlug: pathSegments[1]
  }
}

/** Parse owner-level route: /:owner/api/v1/capabilities/... */
function parseOwnerLevelRoute(pathname: string): { ownerSlug: string; remainingPath: string } | null {
  // Match /:owner_slug/api/v1/capabilities/...
  const pathSegments = pathname.split('/').filter(Boolean)
  if (pathSegments.length < 4) return null
  
  if (pathSegments[1] === 'api' && pathSegments[2] === 'v1' && pathSegments[3] === 'capabilities') {
    const remainingSegments = pathSegments.slice(4)
    const remainingPath = remainingSegments.length > 0 ? `/${remainingSegments.join('/')}` : ''
    return {
      ownerSlug: pathSegments[0],
      remainingPath
    }
  }
  
  return null
}

/** Handle legacy domain redirects */
function handleLegacyRedirect(request: Request): Response | null {
  const url = new URL(request.url)
  const hostname = url.hostname
  
  // Only handle legacy subdomains
  if (hostname.endsWith('.shazhou.work') && hostname !== 'uncaged.shazhou.work') {
    // Skip if it's a known existing endpoint that should continue working
    if (url.pathname === '/webhook') {
      return null // Let it continue to work with legacy hostname routing
    }
    
    // For other paths, defer to main routing flow (after SlugResolver setup)
    return null
  }
  
  return null
}

/** Build the 5 core clients that every route needs */
function buildClients(env: WorkerEnv, instanceId: string) {
  const sigil = new SigilClient(env.SIGIL_URL || '', env.SIGIL_DEPLOY_TOKEN || '', env.MEMORY_DB)
  
  // Enable local Sigil execution if bindings available (Phase 3b)
  if (env.SIGIL_KV && env.LOADER && env.AI) {
    sigil.setLocalExecution(env.SIGIL_KV, env.LOADER, env.AI)
  }
  
  const llm = new LlmClient(
    env.DASHSCOPE_API_KEY,
    env.LLM_MODEL || undefined,
    env.LLM_BASE_URL || undefined,
  )
  llm.a2aToken = env.A2A_TOKEN

  // Wire up RunnerHub DO stub if binding is available
  if (env.RUNNER_HUB) {
    const hubId = env.RUNNER_HUB.idFromName(instanceId)
    llm.runnerHub = env.RUNNER_HUB.get(hubId)
  }

  const chatStore = new ChatStore(env.CHAT_KV)
  const soul = new Soul(env.CHAT_KV, instanceId)
  const memory = new Memory(env.MEMORY_INDEX, env.AI, instanceId, env.MEMORY_DB)
  const identity = env.MEMORY_DB ? new IdentityResolver(env.MEMORY_DB) : null
  return { sigil, llm, chatStore, soul, memory, identity }
}

/** Route request to appropriate handler based on path */
async function routeRequest(
  request: Request,
  env: WorkerEnv,
  clients: CoreClients,
  instanceId: string | undefined,
  ctx: ExecutionContext,
  pathname: string,
  routingInfo?: { ownerId?: string; ownerSlug?: string; agentId?: string },
): Promise<Response> {
  // ─── Capabilities routes (owner-level and platform) ───
  if (routingInfo?.ownerSlug && routingInfo?.ownerId) {
    // ─── Sigil execution routes ───
    // POST /:owner/api/v1/capabilities/deploy
    if (pathname === '/api/v1/capabilities/deploy' && request.method === 'POST') {
      return handleCapabilityDeploy({
        env,
        ownerSlug: routingInfo.ownerSlug
      }, request)
    }

    // GET /:owner/api/v1/capabilities/query
    if (pathname === '/api/v1/capabilities/query' && request.method === 'GET') {
      const url = new URL(request.url)
      return handleCapabilityQuery({
        env,
        ownerSlug: routingInfo.ownerSlug
      }, url)
    }

    // GET /:owner/api/v1/capabilities/:slug/inspect
    if (pathname.startsWith('/api/v1/capabilities/') && pathname.endsWith('/inspect') && request.method === 'GET') {
      const pathParts = pathname.split('/')
      const capabilitySlug = pathParts[4]  // /api/v1/capabilities/:slug/inspect
      return handleCapabilityInspect({
        env,
        ownerSlug: routingInfo.ownerSlug
      }, capabilitySlug)
    }

    // Standard capabilities CRUD routes
    const capResponse = await handleCapabilitiesRoutes(
      request, 
      env, 
      routingInfo.ownerSlug, 
      routingInfo.ownerId
    )
    if (capResponse) return capResponse
  }

  // ─── Agent-level Sigil routes ───
  if (routingInfo?.ownerSlug && routingInfo?.agentId) {
    // POST /:owner/:agent/run/:capability
    if (pathname.startsWith('/run/') && request.method === 'POST') {
      const capabilitySlug = pathname.slice(5)  // Remove '/run/' prefix
      return handleCapabilityInvoke({
        env,
        ownerSlug: routingInfo.ownerSlug,
        agentSlug: routingInfo.agentId  // Using agentId as agentSlug for now
      }, capabilitySlug, request)
    }
  }

  // ─── Agent capabilities routes ───
  if (routingInfo?.agentId) {
    const agentCapResponse = await handleAgentCapabilitiesRoutes(
      request,
      env,
      routingInfo.agentId
    )
    if (agentCapResponse) return agentCapResponse
  }

  // For agent-specific routes, instanceId is required
  if (!instanceId) {
    return new Response('Invalid routing context', { status: 400 })
  }

  // ─── Runner WebSocket ───
  // Route: /runner/ws — WebSocket upgrade for Runner clients
  if (pathname === '/runner/ws' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
    if (!env.RUNNER_HUB || !env.MEMORY_DB) {
      return new Response('Runner not configured', { status: 503 })
    }

    // Bearer token authentication
    const auth = request.headers.get('Authorization')
    if (!auth?.startsWith('Bearer ')) {
      return new Response('Unauthorized', { status: 401 })
    }
    const token = auth.slice(7).trim()
    const tokenHash = await sha256(token)

    // Look up token in D1
    const row = await env.MEMORY_DB.prepare(
      'SELECT agent_id, label FROM runner_tokens WHERE token_hash = ?'
    ).bind(tokenHash).first<{ agent_id: string; label: string }>()

    if (!row) {
      return new Response('Invalid runner token', { status: 403 })
    }

    // Update last_seen_at (fire-and-forget)
    ctx.waitUntil(
      env.MEMORY_DB.prepare(
        'UPDATE runner_tokens SET last_seen_at = ? WHERE token_hash = ?'
      ).bind(Date.now(), tokenHash).run()
    )

    // Forward to RunnerHub DO (keyed by agent_id)
    const hubId = env.RUNNER_HUB.idFromName(row.agent_id)
    const hub = env.RUNNER_HUB.get(hubId)

    // Pass label + tags through query params
    const reqUrl = new URL(request.url)
    const label = reqUrl.searchParams.get('label') || row.label
    const tags = reqUrl.searchParams.get('tags') || ''

    return hub.fetch(`https://runner-hub/connect?label=${encodeURIComponent(label)}&tags=${encodeURIComponent(tags)}`, {
      headers: request.headers,
    })
  }

  // ─── Telegram channel ───
  if (pathname === '/webhook' && request.method === 'POST') {
    if (!env.TELEGRAM_BOT_TOKEN) {
      return new Response('Telegram not configured for this instance', { status: 404 })
    }
    return handleTelegramRoutes(request, env, clients, instanceId, ctx)
  }

  // Handle Telegram hook variations for path-based routing  
  if ((pathname === '/hook/telegram' || pathname === '/telegram') && request.method === 'POST') {
    if (!env.TELEGRAM_BOT_TOKEN) {
      return new Response('Telegram not configured for this instance', { status: 404 })
    }
    return handleTelegramRoutes(request, env, clients, instanceId, ctx)
  }

  // ─── Dynamic manifest.json (per-agent) ───
  if (pathname === '/manifest.json' && request.method === 'GET') {
    const agentDisplayName = routingInfo?.agentId || instanceId
    const ownerSlug = routingInfo?.ownerSlug || ''
    return new Response(
      getManifestJSON(ownerSlug, instanceId, agentDisplayName),
      { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' } },
    )
  }

  // ─── New auth-based API routes (JWT cookie auth) ───
  // These routes use the new auth system (Passkey/MagicLink/Google OAuth)
  // and are independent of the legacy web channel
  if (pathname === '/api/chat' && request.method === 'POST') {
    // Authenticate via JWT cookie or Bearer token
    const { extractUserIdFromRequest } = await import('./auth.js')
    const userId = await extractUserIdFromRequest(request, env)
    if (!userId) {
      return new Response(JSON.stringify({ error: '未登录，请先登录' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      })
    }

    const { sigil, llm, chatStore, soul, memory } = clients
    const body = await request.json() as { message?: string }
    const userMessage = body.message?.trim()
    if (!userMessage) {
      return new Response(JSON.stringify({ error: 'message required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      })
    }

    try {
      const chatId = `web:${userId}`
      let messages = await chatStore.load(chatId)
      const { messages: compressed } = chatStore.maybeCompress(messages)
      messages = compressed
      messages.push({ role: 'user' as const, content: userMessage })

      const memorySessionId = `${instanceId}:${userId}`
      const { reply, updatedMessages } = await llm.agentLoop(
        messages, sigil, soul, memory, memorySessionId,
      )

      await chatStore.save(chatId, updatedMessages)
      Promise.allSettled([
        memory.store(userMessage, 'user', memorySessionId),
        memory.store(reply, 'assistant', memorySessionId),
      ])

      return new Response(JSON.stringify({ response: reply, timestamp: Date.now() }), {
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (e: any) {
      console.error('[chat] error:', e)
      return new Response(JSON.stringify({ error: '抱歉，遇到了问题，请稍后重试 😥' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  if (pathname === '/api/history' && request.method === 'GET') {
    const { extractUserIdFromRequest } = await import('./auth.js')
    const userId = await extractUserIdFromRequest(request, env)
    if (!userId) {
      return new Response(JSON.stringify({ error: '未登录' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      })
    }

    const { chatStore } = clients
    const chatId = `web:${userId}`
    const messages = await chatStore.load(chatId)
    const history = messages
      .filter(msg => msg.role !== 'system')
      .map(msg => {
        const base = {
          role: msg.role,
          content: msg.content || '',
          timestamp: Date.now(),
        }
        
        // For assistant messages, include tool_calls if present
        if (msg.role === 'assistant' && msg.tool_calls) {
          return { ...base, tool_calls: msg.tool_calls }
        }
        
        // For tool messages, include tool_call_id
        if (msg.role === 'tool' && msg.tool_call_id) {
          return { ...base, tool_call_id: msg.tool_call_id }
        }
        
        return base
      })

    return new Response(JSON.stringify({ history }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ─── Web channel (legacy OAuth + UI + API) ───
  const webEnabled = env.GOOGLE_CLIENT_ID && isWebInstance(env, instanceId)

  // ─── Auth routes: always available (not gated by webEnabled) ───
  if (pathname.startsWith('/auth/')) {
    const authResponse = await handleAuthRoutes(request, env, pathname)
    if (authResponse) return authResponse
  }

  if (pathname.startsWith('/api/')) {
    if (!webEnabled) {
      return new Response('Web channel not configured for this instance', { status: 404 })
    }
    const webResponse = await handleWebRoutes(request, env, clients, instanceId)
    if (webResponse) return webResponse
    // Fall through to common routes if web didn't handle it
  }

  // ─── Agent chat page: serve SPA for GET / ───
  if (pathname === '/' && request.method === 'GET' && routingInfo?.agentId) {
    return env.ASSETS.fetch(new Request(new URL('/', request.url), request))
  }

  // ─── Common routes (soul/chat/memory/baton/image/health/debug) ───
  const commonResponse = await handleCommonRoutes(request, env, clients, instanceId, { webEnabled: !!webEnabled })
  if (commonResponse) return commonResponse

  // ─── SPA fallback for GET requests (react-router handles client-side routing) ───
  if (request.method === 'GET') {
    return env.ASSETS.fetch(new Request(new URL('/', request.url), request))
  }

  return new Response('Not found', { status: 404 })
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    
    // Check for legacy domain redirects first
    const legacyRedirect = handleLegacyRedirect(request)
    if (legacyRedirect) return legacyRedirect
    
    // Handle path-based routing for uncaged.shazhou.work
    if (url.hostname === 'uncaged.shazhou.work') {
      // ─── Static assets: serve directly from ASSETS binding ───
      if (url.pathname.startsWith('/assets/') || url.pathname === '/favicon.ico') {
        return env.ASSETS.fetch(request)
      }

      // ─── Platform root: serve SPA ───
      if (url.pathname === '/' && request.method === 'GET') {
        return env.ASSETS.fetch(request)
      }

      // Check reserved prefixes first - these bypass agent routing
      if (isReservedPrefix(url.pathname)) {
        // Serve SPA for GET /auth/login (React handles this route client-side)
        if (url.pathname === '/auth/login' && request.method === 'GET') {
          return env.ASSETS.fetch(new Request(new URL('/', request.url), request))
        }
        // Handle /auth/* API routes at platform level
        if (url.pathname.startsWith('/auth/')) {
          const authResponse = await handleAuthRoutes(request, env, url.pathname)
          if (authResponse) return authResponse
        }
        return new Response('Reserved path not implemented', { status: 404 })
      }
      
      // Resolve routing using SlugResolver
      const routing = await resolveRouting(env, url.pathname)
      if (!routing) {
        return new Response('Agent not found', { status: 404 })
      }
      
      // Handle redirects
      if (routing.redirect) {
        const redirectUrl = `${url.protocol}//${url.host}${routing.redirect}${url.search}`
        return Response.redirect(redirectUrl, 301)
      }

      // For owner-only routes, don't strip path or build agent clients
      if (routing.ownerOnly) {
        // Strip the owner slug prefix: /scott/api/v1/... → /api/v1/...
        // For /platform/capabilities → /capabilities
        const segments = url.pathname.split('/').filter(Boolean)
        const strippedOwnerPath = '/' + segments.slice(1).join('/')
        
        // Owner-level or platform routes - no instance clients needed
        const dummyClients = buildClients(env, 'dummy') // Minimal clients for API auth
        return await routeRequest(
          request, 
          env, 
          dummyClients, 
          undefined, // no instanceId 
          ctx, 
          strippedOwnerPath,
          { ownerId: routing.ownerId, ownerSlug: routing.ownerSlug }
        )
      }
      
      const instanceId = routing.instanceId!
      const isIdRoute = url.pathname.startsWith('/id/')
      
      // Create a modified URL with the stripped path for downstream handlers
      const strippedPath = stripRoutePrefix(url, isIdRoute)
      const normalizedPath = normalizeApiPath(strippedPath)  // ADD THIS
      
      const modifiedUrl = new URL(request.url)
      modifiedUrl.pathname = normalizedPath
      
      // Create a new request with the modified URL
      const modifiedRequest = new Request(modifiedUrl, {
        method: request.method,
        headers: request.headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      })
      
      const clients = buildClients(env, instanceId)

      // Route to appropriate handler based on normalized path
      return await routeRequest(
        modifiedRequest, 
        env, 
        clients, 
        instanceId, 
        ctx, 
        normalizedPath,
        { ownerId: routing.ownerId, ownerSlug: routing.ownerSlug, agentId: routing.agentId }
      )
    }
    
    // Legacy hostname-based routing for backward compatibility
    const hostname = url.hostname
    
    // Handle legacy domain redirects using SlugResolver
    if (hostname.endsWith('.shazhou.work') && hostname !== 'uncaged.shazhou.work') {
      const agentSlug = hostname.split('.')[0]
      
      // Skip webhook path — must continue working with legacy routing
      if (url.pathname === '/webhook') {
        // Fall through to legacy hostname-based routing
      } else {
        // Use SlugResolver to look up agent's owner
        if (env.MEMORY_DB && env.CHAT_KV) {
          const slugResolver = new SlugResolver(env.MEMORY_DB, env.CHAT_KV)
          const ownerSlug = await slugResolver.resolveOwnerByAgentSlug(agentSlug)
          
          if (ownerSlug) {
            // Redirect to uncaged.shazhou.work/{owner_slug}/{agent_slug}{path}{search}
            const newUrl = `${url.protocol}//uncaged.shazhou.work/${ownerSlug}/${agentSlug}${url.pathname}${url.search}`
            return Response.redirect(newUrl, 301)
          }
          // If agent not found in DB, fall back to legacy hostname-based routing (don't break)
        }
      }
    }
    
    // Legacy hostname-based routing for backward compatibility
    const sub = hostname.split('.')[0]
    const instanceId = sub === 'localhost' || sub === 'uncaged' ? 'doudou' : sub
    
    if (!instanceId) {
      return new Response('Invalid instance', { status: 404 })
    }
    
    const clients = buildClients(env, instanceId)
    return await routeRequest(request, env, clients, instanceId, ctx, normalizeApiPath(url.pathname), {})
  },

  // ─── Baton Queue Consumer ───
  async queue(batch: MessageBatch<BatonEvent>, env: WorkerEnv): Promise<void> {
    if (!env.BATON_DB || !env.BATON_QUEUE) {
      console.error('[Baton Queue] BATON_DB or BATON_QUEUE not configured')
      return
    }
    const store = new BatonStore(env.BATON_DB, env.BATON_QUEUE)

    // Notification callback — route based on baton.channel
    const notifyFn: NotifyFn = async (baton, result, error) => {
      if (!baton.notify || !baton.channel) return

      if (baton.channel.startsWith('telegram:') && env.TELEGRAM_BOT_TOKEN) {
        const chatId = parseInt(baton.channel.split(':')[1])
        if (isNaN(chatId)) return
        const message = error
          ? `⚠️ Task failed: ${error}`
          : result || '(no result)'
        await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, message)
      }
    }

    await handleBatonQueue(batch, env, store, notifyFn)
  },
}
