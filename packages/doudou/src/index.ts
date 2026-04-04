// Doudou instance - Telegram Bot implementation of Uncaged

import { 
  handleBatonQueue, 
  type NotifyFn 
} from '@uncaged/core/baton-runner'
import { 
  SigilClient 
} from '@uncaged/core/sigil'
import { 
  LlmClient 
} from '@uncaged/core/llm'
import { 
  ChatStore, 
  type ContentPart 
} from '@uncaged/core/chat-store'
import { 
  Soul 
} from '@uncaged/core/soul'
import { 
  Memory 
} from '@uncaged/core/memory'
import { 
  BatonStore,
  type BatonEvent 
} from '@uncaged/core/baton'
import { 
  storeImageForVL 
} from '@uncaged/core/utils'
import type { Env } from '@uncaged/core/env'
import { handleTelegramWebhook, sendTelegram } from './telegram.js'

// Doudou-specific environment (extends core Env)
export interface DoudouEnv extends Env {
  TELEGRAM_BOT_TOKEN: string
  ALLOWED_CHAT_IDS: string
}

export default {
  async fetch(request: Request, env: DoudouEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const instanceId = env.INSTANCE_ID || 'doudou'

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
      llm.a2aToken = env.A2A_TOKEN
      const chatStore = new ChatStore(env.CHAT_KV)
      const soul = new Soul(env.CHAT_KV, instanceId)
      const memory = new Memory(env.MEMORY_INDEX, env.AI, instanceId, env.MEMORY_DB)
      return handleTelegramWebhook(request, env, sigil, llm, chatStore, soul, memory, ctx)
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
    // POST /chat { "message": "...", "chat_id": "xiaoju", "image_url": "..." }
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
      llm.a2aToken = env.A2A_TOKEN
      const chatStore = new ChatStore(env.CHAT_KV)
      const soul = new Soul(env.CHAT_KV, instanceId)
      const memory = new Memory(env.MEMORY_INDEX, env.AI, instanceId, env.MEMORY_DB)

      const userMessage = body.message.trim()

      // Handle commands
      if (userMessage === '/clear') {
        await chatStore.clear(chatId)
        return new Response(JSON.stringify({ reply: '🧹 Chat cleared! Long-term memory is still intact.', chat_id: chatId }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (userMessage === '/start') {
        await chatStore.clear(chatId)
        const soulObj = new Soul(env.CHAT_KV, instanceId)
        const soulText = await soulObj.getSoul()
        const nameMatch = soulText.match(/You are (.+?)[,\n]/)
        const botName = nameMatch ? nameMatch[1] : 'Uncaged 🔓'
        return new Response(JSON.stringify({ reply: `Hey! I'm ${botName}. Type /help to see what I can do.`, chat_id: chatId }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (userMessage === '/help') {
        return new Response(JSON.stringify({ 
          reply: '🔓 Commands:\n/start - Reset conversation\n/clear - Clear chat history\n/soul - Show personality\n/help - This message',
          chat_id: chatId 
        }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (userMessage === '/soul') {
        const soulObj = new Soul(env.CHAT_KV, instanceId)
        const soulText = await soulObj.getSoul()
        return new Response(JSON.stringify({ reply: `👻 My soul:\n\n${soulText}`, chat_id: chatId }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      try {
        // Store user message (text only)
        const storePromise = memory.store(body.message, 'user', chatId)

        // Load + compress history
        let messages = await chatStore.load(chatId)
        const { messages: compressed } = chatStore.maybeCompress(messages)
        messages = compressed
        
        // Add user message (multimodal or text-only)
        if (body.image_url) {
          let finalImageUrl = body.image_url
          
          // If not already a data URI or file:// reference, download and upload to DashScope
          if (!finalImageUrl.startsWith('data:') && !finalImageUrl.startsWith('file://')) {
            try {
              const imgRes = await fetch(finalImageUrl)
              if (imgRes.ok) {
                const arrayBuffer = await imgRes.arrayBuffer()
                const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
                
                // Extract filename from URL or use generic name
                const urlPath = new URL(finalImageUrl).pathname
                const filename = urlPath.split('/').pop() || `image.${contentType.split('/')[1] || 'jpg'}`
                
                // Upload to DashScope (with base64 fallback)
                finalImageUrl = await storeImageForVL(arrayBuffer, contentType, env.CHAT_KV, 'https://doudou.shazhou.work')
                console.log(`[Multimodal] /chat API: Processed external image URL`)
              }
            } catch (e) {
              console.error('[Multimodal] Failed to process image for /chat:', e)
            }
          }
          
          const content: ContentPart[] = [
            { type: 'text', text: body.message },
            { type: 'image_url', image_url: { url: finalImageUrl } }
          ]
          messages.push({ role: 'user', content })
          console.log('[Multimodal] /chat API: Added multimodal message')
        } else {
          messages.push({ role: 'user', content: body.message })
        }

        // Run agentic loop
        const { reply, updatedMessages } = await llm.agentLoop(messages, sigil, soul, memory, chatId)

        // Store reply + save history
        await chatStore.save(chatId, updatedMessages)
        await Promise.allSettled([storePromise, memory.store(reply, 'assistant', chatId)])

        return new Response(JSON.stringify({ reply, chat_id: chatId }), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (e: any) {
        console.error('[chat] error:', e)
        return new Response(JSON.stringify({ error: 'Internal error' }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // Memory stats API
    if (url.pathname === '/memory' && request.method === 'GET') {
      const memory = new Memory(env.MEMORY_INDEX, env.AI, instanceId, env.MEMORY_DB)
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

    // Serve uploaded images from KV (for DashScope VL access)
    if (url.pathname.startsWith('/image/') && request.method === 'GET') {
      const imageId = url.pathname.slice(7) // strip '/image/'
      const imageData = await env.CHAT_KV.get(`img:${imageId}`, 'arrayBuffer')
      if (!imageData) {
        return new Response('Not found', { status: 404 })
      }
      // Detect content type from stored metadata or default to jpeg
      const meta = await env.CHAT_KV.get(`img:${imageId}:meta`, 'text')
      const contentType = meta || 'image/jpeg'
      return new Response(imageData, {
        headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' },
      })
    }

    // ─── Baton endpoints ───

    if (url.pathname === '/baton' && request.method === 'POST') {
      const auth = request.headers.get('Authorization')
      if (auth !== `Bearer ${env.SIGIL_DEPLOY_TOKEN}`) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { 'Content-Type': 'application/json' },
        })
      }
      if (!env.BATON_DB || !env.BATON_QUEUE) {
        return new Response(JSON.stringify({ error: 'Baton not configured' }), {
          status: 503, headers: { 'Content-Type': 'application/json' },
        })
      }
      const body = await request.json() as any
      if (!body.prompt) {
        return new Response(JSON.stringify({ error: 'prompt is required' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        })
      }
      const store = new BatonStore(env.BATON_DB, env.BATON_QUEUE)
      const baton = await store.create({
        prompt: body.prompt,
        hints: body.hints,
        channel: body.channel,
        notify: body.notify,
      })
      return new Response(JSON.stringify({ created: true, baton }), {
        status: 201, headers: { 'Content-Type': 'application/json' },
      })
    }

    if (url.pathname.startsWith('/baton/') && request.method === 'GET') {
      if (!env.BATON_DB || !env.BATON_QUEUE) {
        return new Response(JSON.stringify({ error: 'Baton not configured' }), {
          status: 503, headers: { 'Content-Type': 'application/json' },
        })
      }
      const parts = url.pathname.split('/')
      const batonId = parts[2]
      const action = parts[3]  // 'tree' or 'stats' or undefined
      const store = new BatonStore(env.BATON_DB, env.BATON_QUEUE)

      if (batonId === 'stats') {
        const stats = await store.stats()
        return new Response(JSON.stringify(stats), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (action === 'tree') {
        const tree = await store.loadTree(batonId)
        return new Response(JSON.stringify({ baton_id: batonId, tree }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const baton = await store.load(batonId)
      if (!baton) {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404, headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify(baton), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Debug: test vectorize round-trip
    if (url.pathname === '/debug/vectorize' && request.method === 'POST') {
      if (env.DEBUG_ENABLED !== 'true') {
        return new Response(JSON.stringify({ error: 'Debug disabled' }), {
          status: 403, headers: { 'Content-Type': 'application/json' },
        })
      }
      const auth = request.headers.get('Authorization')
      if (auth !== `Bearer ${env.SIGIL_DEPLOY_TOKEN}`) {
        return new Response('Unauthorized', { status: 401 })
      }
      try {
        const memory = new Memory(env.MEMORY_INDEX, env.AI, instanceId, env.MEMORY_DB)
        
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
        
        // Clean up test vector
        try {
          await env.MEMORY_INDEX.deleteByIds([id])
        } catch {}
        
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
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    return new Response('Not found', { status: 404 })
  },

  // ─── Baton Queue Consumer ───
  async queue(batch: MessageBatch<BatonEvent>, env: DoudouEnv): Promise<void> {
    if (!env.BATON_DB || !env.BATON_QUEUE) {
      console.error('[Baton Queue] BATON_DB or BATON_QUEUE not configured')
      return
    }
    const store = new BatonStore(env.BATON_DB, env.BATON_QUEUE)
    
    // Define Telegram notification function
    const telegramNotify: NotifyFn = async (baton, result, error) => {
      if (!baton.notify || !baton.channel) return
      
      if (baton.channel.startsWith('telegram:')) {
        const chatId = parseInt(baton.channel.split(':')[1])
        if (isNaN(chatId)) return
        
        const message = error
          ? `⚠️ Task failed: ${error}`
          : result || '(no result)'
        
        await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, message)
      }
    }
    
    await handleBatonQueue(batch, env, store, telegramNotify)
  },
}