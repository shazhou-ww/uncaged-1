// Unified Uncaged Worker — one codebase, N agent instances
// Phase 1: Dual routing support
//   - New path-based: uncaged.shazhou.work/:owner/:agent/... → agent instanceId
//   - Legacy hostname: doudou.shazhou.work/... → doudou instanceId (backward compat)

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

// Unified environment — all channel secrets are optional
export interface WorkerEnv extends Env {
  // Telegram channel (optional)
  TELEGRAM_BOT_TOKEN?: string
  ALLOWED_CHAT_IDS?: string
  // Web channel (optional)
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  SESSION_SECRET?: string
  // Comma-separated list of instanceIds that enable web channel (e.g. "xiaomai,another")
  WEB_INSTANCES?: string
}

// Session interface (used by web channel)
export interface UserSession {
  email: string
  name: string
  picture: string
  created_at: number
}

/** Check if this instance has web channel enabled */
function isWebInstance(env: WorkerEnv, instanceId: string): boolean {
  if (!env.WEB_INSTANCES) return false
  const allowed = new Set(env.WEB_INSTANCES.split(',').map(s => s.trim()))
  return allowed.has(instanceId)
}

/** Extract instanceId from hostname or path based on domain */
function resolveInstanceId(request: Request): string {
  const url = new URL(request.url)
  const hostname = url.hostname
  
  // New path-based routing for uncaged.shazhou.work
  if (hostname === 'uncaged.shazhou.work') {
    // Extract from path: /owner/agent/... → agent
    const pathSegments = url.pathname.split('/').filter(Boolean)
    if (pathSegments.length >= 2) {
      return pathSegments[1] // Return the agent slug
    }
    // If path doesn't match pattern, return empty (will result in 404)
    return ''
  }
  
  // Legacy hostname-based routing for backward compatibility
  const sub = hostname.split('.')[0]
  // Fallback for localhost / workers.dev
  return sub === 'localhost' || sub === 'uncaged' ? 'doudou' : sub
}

/** Remove /:owner/:agent prefix from pathname for path-based routing */
function stripRoutePrefix(url: URL): string {
  if (url.hostname === 'uncaged.shazhou.work') {
    const pathSegments = url.pathname.split('/').filter(Boolean)
    if (pathSegments.length >= 2) {
      // Remove first two segments (/owner/agent) and reconstruct path
      const remainingSegments = pathSegments.slice(2)
      return remainingSegments.length > 0 ? `/${remainingSegments.join('/')}` : '/'
    }
  }
  // For legacy domains or when not path-based, return original pathname
  return url.pathname
}

/** Check if path matches reserved platform prefixes */
function isReservedPrefix(pathname: string): boolean {
  const reservedPrefixes = ['/auth/', '/admin/', '/platform/', '/id/', '/.well-known/']
  return reservedPrefixes.some(prefix => pathname.startsWith(prefix))
}

/** Handle legacy domain redirects */
function handleLegacyRedirect(request: Request): Response | null {
  const url = new URL(request.url)
  const hostname = url.hostname
  
  // Only handle legacy subdomains
  if (hostname.endsWith('.shazhou.work') && hostname !== 'uncaged.shazhou.work') {
    const instanceId = hostname.split('.')[0]
    
    // Skip if it's a known existing endpoint that should continue working
    if (url.pathname === '/webhook') {
      return null // Let it continue to work
    }
    
    // For Phase 1, hardcode owner as "scott"
    const newUrl = `${url.protocol}//uncaged.shazhou.work/scott/${instanceId}${url.pathname}${url.search}`
    return Response.redirect(newUrl, 301)
  }
  
  return null
}

/** Build the 5 core clients that every route needs */
function buildClients(env: WorkerEnv, instanceId: string) {
  const sigil = new SigilClient(env.SIGIL_URL, env.SIGIL_DEPLOY_TOKEN)
  const llm = new LlmClient(
    env.DASHSCOPE_API_KEY,
    env.LLM_MODEL || undefined,
    env.LLM_BASE_URL || undefined,
  )
  llm.a2aToken = env.A2A_TOKEN
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
  instanceId: string,
  ctx: ExecutionContext,
  pathname: string,
): Promise<Response> {
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

  // ─── Web channel (OAuth + UI + API) ───
  const webEnabled = env.GOOGLE_CLIENT_ID && isWebInstance(env, instanceId)
  if (
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/api/') ||
    (pathname === '/' && request.method === 'GET' && webEnabled)
  ) {
    if (!webEnabled) {
      return new Response('Web channel not configured for this instance', { status: 404 })
    }
    const webResponse = await handleWebRoutes(request, env, clients, instanceId)
    if (webResponse) return webResponse
    // Fall through to common routes if web didn't handle it
  }

  // ─── Common routes (soul/chat/memory/baton/image/health/debug) ───
  const commonResponse = await handleCommonRoutes(request, env, clients, instanceId, { webEnabled: !!webEnabled })
  if (commonResponse) return commonResponse

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
      // Check reserved prefixes first - these bypass agent routing
      if (isReservedPrefix(url.pathname)) {
        // Reserved prefixes not implemented in Phase 1
        return new Response('Reserved path not implemented', { status: 404 })
      }
      
      // Parse path for agent routing: /:owner/:agent/...
      const pathSegments = url.pathname.split('/').filter(Boolean)
      if (pathSegments.length < 2) {
        return new Response('Invalid path format. Expected: /:owner/:agent/...', { status: 404 })
      }
      
      // Extract owner and agent from path
      const owner = pathSegments[0]
      const agent = pathSegments[1]
      
      // Create a modified URL with the stripped path for downstream handlers
      const strippedPath = stripRoutePrefix(url)
      const modifiedUrl = new URL(request.url)
      modifiedUrl.pathname = strippedPath
      
      // Create a new request with the modified URL
      const modifiedRequest = new Request(modifiedUrl, {
        method: request.method,
        headers: request.headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      })
      
      const instanceId = agent
      const clients = buildClients(env, instanceId)

      // Route to appropriate handler based on stripped path
      return await routeRequest(modifiedRequest, env, clients, instanceId, ctx, strippedPath)
    }
    
    // Legacy hostname-based routing
    const instanceId = resolveInstanceId(request)
    if (!instanceId) {
      return new Response('Invalid instance', { status: 404 })
    }
    
    const clients = buildClients(env, instanceId)
    return await routeRequest(request, env, clients, instanceId, ctx, url.pathname)
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
