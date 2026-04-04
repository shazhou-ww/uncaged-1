// Unified Uncaged Worker — one codebase, N agent instances
// instanceId derived from hostname: doudou.shazhou.work → "doudou"

import type { Env } from '@uncaged/core/env'
import { SigilClient } from '@uncaged/core/sigil'
import { LlmClient } from '@uncaged/core/llm'
import { ChatStore } from '@uncaged/core/chat-store'
import { Soul } from '@uncaged/core/soul'
import { Memory } from '@uncaged/core/memory'
import { BatonStore, type BatonEvent } from '@uncaged/core/baton'
import { handleBatonQueue, type NotifyFn } from '@uncaged/core/baton-runner'
import { handleCommonRoutes } from './router.js'
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
}

// Session interface (used by web channel)
export interface UserSession {
  email: string
  name: string
  picture: string
  created_at: number
}

/** Extract instanceId from hostname: "doudou.shazhou.work" → "doudou" */
function resolveInstanceId(request: Request): string {
  const hostname = new URL(request.url).hostname
  const sub = hostname.split('.')[0]
  // Fallback for localhost / workers.dev
  return sub === 'localhost' || sub === 'uncaged' ? 'doudou' : sub
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
  return { sigil, llm, chatStore, soul, memory }
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const instanceId = resolveInstanceId(request)
    const clients = buildClients(env, instanceId)

    // ─── Telegram channel ───
    if (url.pathname === '/webhook' && request.method === 'POST') {
      if (!env.TELEGRAM_BOT_TOKEN) {
        return new Response('Telegram not configured for this instance', { status: 404 })
      }
      return handleTelegramRoutes(request, env, clients, instanceId, ctx)
    }

    // ─── Web channel (OAuth + UI + API) ───
    if (
      url.pathname.startsWith('/auth/') ||
      url.pathname.startsWith('/api/') ||
      (url.pathname === '/' && request.method === 'GET' && env.GOOGLE_CLIENT_ID)
    ) {
      if (!env.GOOGLE_CLIENT_ID) {
        return new Response('Web channel not configured for this instance', { status: 404 })
      }
      const webResponse = await handleWebRoutes(request, env, clients, instanceId)
      if (webResponse) return webResponse
      // Fall through to common routes if web didn't handle it
    }

    // ─── Common routes (soul/chat/memory/baton/image/health/debug) ───
    const commonResponse = await handleCommonRoutes(request, env, clients, instanceId)
    if (commonResponse) return commonResponse

    return new Response('Not found', { status: 404 })
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
