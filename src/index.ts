import { handleTelegramWebhook } from './telegram.js'
import { SigilClient } from './sigil.js'
import { LlmClient } from './llm.js'
import { ChatStore } from './chat-store.js'
import { Soul } from './soul.js'
import { Memory } from './memory.js'

export interface Env {
  TELEGRAM_BOT_TOKEN: string
  DASHSCOPE_API_KEY: string
  LLM_MODEL: string
  LLM_BASE_URL: string
  SIGIL_DEPLOY_TOKEN: string
  SIGIL_URL: string
  INSTANCE_ID: string
  ALLOWED_CHAT_IDS: string
  CHAT_KV: KVNamespace
  MEMORY_INDEX: VectorizeIndex
  AI: any
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const instanceId = env.INSTANCE_ID || 'default'

    // Health check
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(JSON.stringify({
        name: 'uncaged',
        version: '0.4.0',
        status: 'ok',
        instance: instanceId,
        description: 'Sigil-native AI Agent — soul + vector memory + dynamic tools',
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    // Telegram webhook
    if (url.pathname === '/webhook' && request.method === 'POST') {
      const sigil = new SigilClient(env.SIGIL_URL, env.SIGIL_DEPLOY_TOKEN)
      const llm = new LlmClient(
        env.DASHSCOPE_API_KEY,
        env.LLM_MODEL || undefined,
        env.LLM_BASE_URL || undefined,
      )
      const chatStore = new ChatStore(env.CHAT_KV)
      const soul = new Soul(env.CHAT_KV, instanceId)
      const memory = new Memory(env.MEMORY_INDEX, env.AI, instanceId)
      return handleTelegramWebhook(request, env, sigil, llm, chatStore, soul, memory)
    }

    // Soul management API
    if (url.pathname === '/soul' && request.method === 'GET') {
      const soulObj = new Soul(env.CHAT_KV, instanceId)
      const text = await soulObj.getSoul()
      return new Response(JSON.stringify({ instance: instanceId, soul: text }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/soul' && request.method === 'PUT') {
      const auth = request.headers.get('Authorization')
      if (auth !== `Bearer ${env.SIGIL_DEPLOY_TOKEN}`) {
        return new Response('Unauthorized', { status: 401 })
      }
      const body: any = await request.json()
      const soulObj = new Soul(env.CHAT_KV, instanceId)
      await soulObj.setSoul(body.soul)
      return new Response(JSON.stringify({ ok: true, instance: instanceId }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Instructions management API
    if (url.pathname === '/instructions' && request.method === 'GET') {
      const soulObj = new Soul(env.CHAT_KV, instanceId)
      const text = await soulObj.getInstructions()
      return new Response(JSON.stringify({ instance: instanceId, instructions: text }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname === '/instructions' && request.method === 'PUT') {
      const auth = request.headers.get('Authorization')
      if (auth !== `Bearer ${env.SIGIL_DEPLOY_TOKEN}`) {
        return new Response('Unauthorized', { status: 401 })
      }
      const body: any = await request.json()
      const soulObj = new Soul(env.CHAT_KV, instanceId)
      await soulObj.setInstructions(body.instructions)
      return new Response(JSON.stringify({ ok: true, instance: instanceId }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Memory stats API
    if (url.pathname === '/memory' && request.method === 'GET') {
      const memory = new Memory(env.MEMORY_INDEX, env.AI, instanceId)
      const q = url.searchParams.get('q')
      if (q) {
        const entries = await memory.search(q, 10, 0)
        return new Response(JSON.stringify({ instance: instanceId, query: q, entries }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const count = await memory.count()
      return new Response(JSON.stringify({ instance: instanceId, count }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not found', { status: 404 })
  },
}
