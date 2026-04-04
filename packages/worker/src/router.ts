// Common routes shared by all agent instances
// soul / instructions / chat / memory / baton / image / health / debug

import { LlmClient } from '@uncaged/core/llm'
import { ChatStore, type ContentPart } from '@uncaged/core/chat-store'
import { Soul } from '@uncaged/core/soul'
import { Memory } from '@uncaged/core/memory'
import { SigilClient } from '@uncaged/core/sigil'
import { BatonStore } from '@uncaged/core/baton'
import { storeImageForVL } from '@uncaged/core/utils'
import type { WorkerEnv } from './index.js'

export interface CoreClients {
  sigil: SigilClient
  llm: LlmClient
  chatStore: ChatStore
  soul: Soul
  memory: Memory
}

/** Returns Response if handled, null if not matched */
export async function handleCommonRoutes(
  request: Request,
  env: WorkerEnv,
  clients: CoreClients,
  instanceId: string,
  options?: { webEnabled?: boolean },
): Promise<Response | null> {
  const url = new URL(request.url)
  const { sigil, llm, chatStore, soul, memory } = clients

  // ─── Health check ───
  if (url.pathname === '/' && request.method === 'GET') {
    return new Response(JSON.stringify({
      name: 'uncaged',
      version: '0.5.0',
      status: 'ok',
      instance: instanceId,
      description: 'Sigil-native AI Agent — unified worker, strategy-injected instances',
      channels: {
        telegram: !!env.TELEGRAM_BOT_TOKEN,
        web: !!options?.webEnabled,
      },
    }), { headers: { 'Content-Type': 'application/json' } })
  }

  // ─── Soul management ───
  if (url.pathname === '/soul' && request.method === 'GET') {
    const text = await soul.getSoul()
    return new Response(JSON.stringify({ instance: instanceId, soul: text }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (url.pathname === '/soul' && request.method === 'PUT') {
    if (!authCheck(request, env)) return unauthorized()
    const body: any = await request.json()
    await soul.setSoul(body.soul)
    return new Response(JSON.stringify({ ok: true, instance: instanceId }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ─── Instructions management ───
  if (url.pathname === '/instructions' && request.method === 'GET') {
    const text = await soul.getInstructions()
    return new Response(JSON.stringify({ instance: instanceId, instructions: text }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (url.pathname === '/instructions' && request.method === 'PUT') {
    if (!authCheck(request, env)) return unauthorized()
    const body: any = await request.json()
    await soul.setInstructions(body.instructions)
    return new Response(JSON.stringify({ ok: true, instance: instanceId }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // ─── Direct Chat API ───
  if (url.pathname === '/chat' && request.method === 'POST') {
    if (!authCheck(request, env)) return unauthorized()
    const body: any = await request.json()
    if (!body.message) {
      return new Response(JSON.stringify({ error: 'message required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      })
    }

    const chatId = body.chat_id || 'api'
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
      const soulText = await soul.getSoul()
      const nameMatch = soulText.match(/You are (.+?)[,\n]/)
      const botName = nameMatch ? nameMatch[1] : 'Uncaged 🔓'
      return new Response(JSON.stringify({ reply: `Hey! I'm ${botName}. Type /help to see what I can do.`, chat_id: chatId }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (userMessage === '/help') {
      return new Response(JSON.stringify({
        reply: '🔓 Commands:\n/start - Reset conversation\n/clear - Clear chat history\n/soul - Show personality\n/help - This message',
        chat_id: chatId,
      }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (userMessage === '/soul') {
      const soulText = await soul.getSoul()
      return new Response(JSON.stringify({ reply: `👻 My soul:\n\n${soulText}`, chat_id: chatId }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    try {
      const storePromise = memory.store(body.message, 'user', chatId)

      let messages = await chatStore.load(chatId)
      const { messages: compressed } = chatStore.maybeCompress(messages)
      messages = compressed

      // Multimodal support
      if (body.image_url) {
        let finalImageUrl = body.image_url

        if (!finalImageUrl.startsWith('data:') && !finalImageUrl.startsWith('file://')) {
          try {
            const imgRes = await fetch(finalImageUrl)
            if (imgRes.ok) {
              const arrayBuffer = await imgRes.arrayBuffer()
              const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
              const publicBaseUrl = `${url.protocol}//${url.hostname}`
              finalImageUrl = await storeImageForVL(arrayBuffer, contentType, env.CHAT_KV, publicBaseUrl)
            }
          } catch (e) {
            console.error('[Multimodal] Failed to process image for /chat:', e)
          }
        }

        const content: ContentPart[] = [
          { type: 'text', text: body.message },
          { type: 'image_url', image_url: { url: finalImageUrl } },
        ]
        messages.push({ role: 'user', content })
      } else {
        messages.push({ role: 'user', content: body.message })
      }

      const { reply, updatedMessages } = await llm.agentLoop(messages, sigil, soul, memory, chatId)

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

  // ─── Memory ───
  if (url.pathname === '/memory' && request.method === 'GET') {
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

  // ─── Image serving ───
  if (url.pathname.startsWith('/image/') && request.method === 'GET') {
    const imageId = url.pathname.slice(7)
    const imageData = await env.CHAT_KV.get(`img:${imageId}`, 'arrayBuffer')
    if (!imageData) {
      return new Response('Not found', { status: 404 })
    }
    const meta = await env.CHAT_KV.get(`img:${imageId}:meta`, 'text')
    const contentType = meta || 'image/jpeg'
    return new Response(imageData, {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' },
    })
  }

  // ─── Baton: create ───
  if (url.pathname === '/baton' && request.method === 'POST') {
    if (!authCheck(request, env)) return unauthorized()
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

  // ─── Baton: query ───
  if (url.pathname.startsWith('/baton/') && request.method === 'GET') {
    if (!env.BATON_DB || !env.BATON_QUEUE) {
      return new Response(JSON.stringify({ error: 'Baton not configured' }), {
        status: 503, headers: { 'Content-Type': 'application/json' },
      })
    }
    const parts = url.pathname.split('/')
    const batonId = parts[2]
    const action = parts[3]
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

  // ─── Debug: vectorize round-trip ───
  if (url.pathname === '/debug/vectorize' && request.method === 'POST') {
    if (env.DEBUG_ENABLED !== 'true') {
      return new Response(JSON.stringify({ error: 'Debug disabled' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      })
    }
    if (!authCheck(request, env)) return unauthorized()
    try {
      const testText = 'debug vectorize test ' + Date.now()
      const embedding = await env.AI.run('@cf/baai/bge-m3', { text: [testText] })
      const vector = embedding.data[0]

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

      await new Promise(r => setTimeout(r, 3000))

      const noFilterResults = await env.MEMORY_INDEX.query(vector, {
        topK: 10, returnMetadata: 'all',
      })
      const withFilterResults = await env.MEMORY_INDEX.query(vector, {
        topK: 10, returnMetadata: 'all',
        filter: { instance_id: instanceId },
      })

      try { await env.MEMORY_INDEX.deleteByIds([id]) } catch {}

      return new Response(JSON.stringify({
        ok: true,
        storedId: id,
        vectorDims: vector.length,
        upsertResult,
        noFilter: { count: noFilterResults.count, matches: noFilterResults.matches?.length || 0 },
        withFilter: { count: withFilterResults.count, matches: withFilterResults.matches?.length || 0 },
      }), { headers: { 'Content-Type': 'application/json' } })
    } catch (e: any) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  return null
}

// ─── Helpers ───

function authCheck(request: Request, env: WorkerEnv): boolean {
  const auth = request.headers.get('Authorization')
  return auth === `Bearer ${env.SIGIL_DEPLOY_TOKEN}`
}

function unauthorized(): Response {
  return new Response('Unauthorized', { status: 401 })
}
