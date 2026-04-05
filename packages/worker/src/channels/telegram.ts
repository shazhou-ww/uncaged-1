// Telegram channel adapter
// Handles /webhook route for Telegram Bot API

import { type ContentPart } from '@uncaged/core/chat-store'
import { storeImageForVL } from '@uncaged/core/utils'
import { unifiedChatKey, unifiedMemorySession } from '@uncaged/core/chat-key'
import type { WorkerEnv } from '../index.js'
import type { CoreClients } from '../router.js'

interface TelegramUpdate {
  message?: {
    message_id: number
    chat: { id: number }
    from?: { id: number; first_name?: string; username?: string }
    text?: string
    caption?: string
    photo?: Array<{
      file_id: string
      file_unique_id: string
      width: number
      height: number
      file_size?: number
    }>
  }
}

export async function handleTelegramRoutes(
  request: Request,
  env: WorkerEnv,
  clients: CoreClients,
  instanceId: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  const { sigil, llm, chatStore, soul, memory, identity } = clients
  const botToken = env.TELEGRAM_BOT_TOKEN!

  const update: TelegramUpdate = await request.json()
  const msg = update.message

  const hasPhoto = msg?.photo && msg.photo.length > 0
  const hasText = !!msg?.text
  const caption = msg?.caption || ''

  if (!hasText && !hasPhoto) return new Response('ok')

  const rawChatId = msg!.chat.id
  const userText = (msg!.text || caption).trim()
  const userName = msg!.from?.first_name || 'there'
  const userTag = msg!.from?.username || msg!.from?.first_name || String(rawChatId)

  // ─── Chat ID whitelist ───
  const allowedChats = env.ALLOWED_CHAT_IDS
    ? new Set(env.ALLOWED_CHAT_IDS.split(',').map(Number))
    : null

  if (allowedChats && !allowedChats.has(rawChatId)) {
    await sendTelegram(botToken, rawChatId, '⛔ Unauthorized')
    return new Response('ok')
  }

  // Note: msg.from can be undefined for channel posts. Fallback to rawChatId means
  // all messages from a channel would map to the same "user". Currently only private
  // chats are supported (ALLOWED_CHAT_IDS whitelist), so this is acceptable.

  // ─── Resolve identity (with fallback to legacy keys) ───
  let chatId: string | number = rawChatId
  let memorySessionId = `telegram:${userTag}`

  if (identity) {
    try {
      const resolved = await identity.resolve({
        agentId: instanceId,
        authType: 'telegram',
        externalId: String(msg!.from?.id ?? rawChatId),
        displayName: msg!.from?.first_name,
        channelType: 'telegram',
        channelExternalId: String(rawChatId),
      })
      chatId = unifiedChatKey(resolved.agentId, resolved.userId)
      memorySessionId = unifiedMemorySession(resolved.userId)
    } catch (e) {
      console.warn('[identity] Telegram resolve failed, falling back to legacy keys:', e)
      // Fall back to legacy behavior
    }
  }

  // ─── Commands ───
  if (userText === '/start') {
    await chatStore.clear(chatId)
    const soulText = await soul.getSoul()
    const nameMatch = soulText.match(/You are (.+?)[,\n]/)
    const botName = nameMatch ? nameMatch[1] : 'Uncaged 🔓'
    await sendTelegram(botToken, rawChatId,
      `Hey ${userName}! I'm ${botName}\n\n` +
      `I can discover and create capabilities on the fly. Just tell me what you need!\n\n` +
      `Type /help to see what I can do.`)
    return new Response('ok')
  }

  if (userText === '/help') {
    await sendTelegram(botToken, rawChatId,
      `🔓 Commands:\n\n` +
      `/start - Reset conversation\n` +
      `/clear - Clear chat history (memory retained)\n` +
      `/soul - Show my personality\n` +
      `/help - This message\n\n` +
      `💡 Things I can do:\n` +
      `- Search and use existing capabilities\n` +
      `- Create new capabilities on the fly\n` +
      `- Remember things across conversations\n` +
      `- Recall past conversations by topic or time\n` +
      `- See and understand images you send me\n\n` +
      `Just chat naturally!`)
    return new Response('ok')
  }

  if (userText === '/clear') {
    await chatStore.clear(chatId)
    await sendTelegram(botToken, rawChatId, '🧹 Chat cleared! Long-term memory is still intact.')
    return new Response('ok')
  }

  if (userText === '/soul') {
    const soulText = await soul.getSoul()
    await sendTelegram(botToken, rawChatId, `👻 My soul:\n\n${soulText}`)
    return new Response('ok')
  }

  if (userText.startsWith('/') && !hasPhoto) {
    await sendTelegram(botToken, rawChatId, `Unknown command. Type /help to see available commands.`)
    return new Response('ok')
  }

  // ─── Normal message ───
  const publicBaseUrl = `https://${new URL(request.url).hostname}`

  const processPromise = (async () => {
    const typingInterval = startTypingIndicator(botToken, rawChatId, ctx)

    try {
      let imageUrl: string | undefined
      if (hasPhoto && msg!.photo) {
        const photo = msg!.photo[msg!.photo.length - 1]
        const fileRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${photo.file_id}`)
        const fileData = await fileRes.json() as any

        if (fileData.ok && fileData.result.file_path) {
          const filePath = fileData.result.file_path
          const imgResponse = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`)
          if (imgResponse.ok) {
            const arrayBuffer = await imgResponse.arrayBuffer()
            const ext = filePath.split('.').pop()?.toLowerCase() || 'jpg'
            const mimeType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
            imageUrl = await storeImageForVL(arrayBuffer, mimeType, env.CHAT_KV, publicBaseUrl)
          }
        }
      }

      const storeUserPromise = memory.store(userText || '[Image]', 'user', memorySessionId)

      let messages = await chatStore.load(chatId)
      const { messages: compressed } = chatStore.maybeCompress(messages)
      messages = compressed

      if (imageUrl) {
        const content: ContentPart[] = []
        if (userText) content.push({ type: 'text', text: userText })
        content.push({ type: 'image_url', image_url: { url: imageUrl } })
        messages.push({ role: 'user', content })
      } else {
        messages.push({ role: 'user', content: userText })
      }

      const { reply, updatedMessages } = await llm.agentLoop(messages, sigil, soul, memory, memorySessionId)

      typingInterval.stop()

      const storeAssistantPromise = memory.store(reply, 'assistant', memorySessionId)
      await chatStore.save(chatId, updatedMessages)
      await sendTelegram(botToken, rawChatId, reply)
      await Promise.allSettled([storeUserPromise, storeAssistantPromise])
    } catch (e: any) {
      typingInterval.stop()
      console.error('[uncaged] error:', e)
      try {
        await env.CHAT_KV.put('debug:last_error', JSON.stringify({
          error: e.message, stack: e.stack, time: Date.now(),
        }), { expirationTtl: 3600 })
      } catch {}
      await sendTelegram(botToken, rawChatId, `Oops, something went wrong. Try again?`)
    }
  })()

  if (ctx) {
    ctx.waitUntil(processPromise)
  } else {
    await processPromise
  }

  return new Response('ok')
}

// ─── Telegram API helpers ───

async function sendChatAction(token: string, chatId: number, action: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action }),
  })
}

function startTypingIndicator(token: string, chatId: number, ctx?: ExecutionContext): { stop: () => void } {
  let stopped = false
  let lastSent = 0

  const send = () => {
    const now = Date.now()
    if (stopped || now - lastSent < 4000) return
    lastSent = now
    sendChatAction(token, chatId, 'typing').catch(() => {})
  }

  send()

  const loopPromise = (async () => {
    while (!stopped) {
      await new Promise(r => setTimeout(r, 4000))
      send()
    }
  })()

  if (ctx) {
    ctx.waitUntil(loopPromise)
  }

  return { stop() { stopped = true } }
}

export async function sendTelegram(token: string, chatId: number, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  })
  if (!res.ok) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    })
  }
}
