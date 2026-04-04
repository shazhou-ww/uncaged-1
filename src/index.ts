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

    // Direct chat API (non-Telegram, for agents/CLI)
    // POST /chat { "message": "...", "chat_id": "xiaoju" }
    if (url.pathname === '/chat' && request.method === 'POST') {
      const auth = request.headers.get('Authorization')
      if (auth !== `Bearer ${env.SIGIL_DEPLOY_TOKEN}`) {
        return new Response('Unauthorized', { status: 401 })
      }
      const body: any = await request.json()
      if (!body.message) {
        return new Response(JSON.stringify({ error: 'message required' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        })
      }

      const chatId = body.chat_id || 'api'
      const sigil = new SigilClient(env.SIGIL_URL, env.SIGIL_DEPLOY_TOKEN)
      const llm = new LlmClient(
        env.DASHSCOPE_API_KEY,
        env.LLM_MODEL || undefined,
        env.LLM_BASE_URL || undefined,
      )
      const chatStore = new ChatStore(env.CHAT_KV)
      const soul = new Soul(env.CHAT_KV, instanceId)
      const memory = new Memory(env.MEMORY_INDEX, env.AI, instanceId)

      try {
        // Store user message
        const storePromise = memory.store(body.message, 'user', chatId)

        // Load + compress history
        let messages = await chatStore.load(chatId)
        const { messages: compressed } = chatStore.maybeCompress(messages)
        messages = compressed
        messages.push({ role: 'user', content: body.message })

        // Run agentic loop
        const { reply, updatedMessages } = await llm.agentLoop(messages, sigil, soul, memory)

        // Store reply + save history
        await chatStore.save(chatId, updatedMessages)
        await Promise.allSettled([storePromise, memory.store(reply, 'assistant', chatId)])

        return new Response(JSON.stringify({ reply, chat_id: chatId }), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        })
      }
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

    // Debug: test vectorize round-trip
    if (url.pathname === '/debug/vectorize' && request.method === 'POST') {
      const auth = request.headers.get('Authorization')
      if (auth !== `Bearer ${env.SIGIL_DEPLOY_TOKEN}`) {
        return new Response('Unauthorized', { status: 401 })
      }
      try {
        const memory = new Memory(env.MEMORY_INDEX, env.AI, instanceId)
        
        // 1. Generate embedding
        const testText = 'debug vectorize test ' + Date.now()
        const embedding = await env.AI.run('@cf/baai/bge-m3', { text: [testText] })
        const vector = embedding.data[0]
        
        // 2. Upsert directly
        const id = `debug:${Date.now()}`
        const upsertResult = await env.MEMORY_INDEX.upsert([{
          id,
          values: vector,
          metadata: {
            text: testText,
            role: 'user',
            timestamp: Date.now(),
            instance_id: instanceId,
          },
        }])
        
        // 3. Wait
        await new Promise(r => setTimeout(r, 3000))
        
        // 4. Query WITHOUT filter
        const noFilterResults = await env.MEMORY_INDEX.query(vector, {
          topK: 10,
          returnMetadata: 'all',
        })
        
        // 5. Query WITH filter
        const withFilterResults = await env.MEMORY_INDEX.query(vector, {
          topK: 10,
          returnMetadata: 'all',
          filter: { instance_id: instanceId },
        })
        
        return new Response(JSON.stringify({
          ok: true,
          storedId: id,
          vectorDims: vector.length,
          upsertResult,
          noFilter: { count: noFilterResults.count, matches: noFilterResults.matches?.length || 0 },
          withFilter: { count: withFilterResults.count, matches: withFilterResults.matches?.length || 0 },
        }), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message, stack: e.stack }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    return new Response('Not found', { status: 404 })
  },
}
