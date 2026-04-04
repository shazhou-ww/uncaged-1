// Telegram Bot API helpers

import { SigilClient } from './sigil.js'
import { LlmClient } from './llm.js'
import { ChatStore, type ContentPart } from './chat-store.js'
import { Soul } from './soul.js'
import { Memory } from './memory.js'
import { storeImageForVL } from './utils.js'
import type { Env } from './index.js'

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

export async function handleTelegramWebhook(
  request: Request,
  env: Env,
  sigil: SigilClient,
  llm: LlmClient,
  chatStore: ChatStore,
  soul: Soul,
  memory: Memory,
  ctx?: ExecutionContext,
): Promise<Response> {
  const update: TelegramUpdate = await request.json()
  const msg = update.message

  const hasPhoto = msg?.photo && msg.photo.length > 0
  const hasText = !!msg?.text
  const caption = msg?.caption || ''

  if (!hasText && !hasPhoto) return new Response('ok')

  const chatId = msg.chat.id
  let userText = (msg.text || caption).trim()
  const userName = msg.from?.first_name || 'there'
  const userTag = msg.from?.username || msg.from?.first_name || String(chatId)
  // Memory session tag: identifies who this conversation is with
  const memorySessionId = `telegram:${userTag}`

  // ─── Chat ID whitelist check ───
  const allowedChats = env.ALLOWED_CHAT_IDS
    ? new Set(env.ALLOWED_CHAT_IDS.split(',').map(Number))
    : null  // null = 不限制（开发模式）

  if (allowedChats && !allowedChats.has(chatId)) {
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, '⛔ Unauthorized')
    return new Response('ok')
  }

  // ─── Commands ───

  if (userText === '/start') {
    await chatStore.clear(chatId)
    const soulText = await soul.getSoul()
    // Extract name from soul if possible
    const nameMatch = soulText.match(/You are (.+?)[,\n]/)
    const botName = nameMatch ? nameMatch[1] : 'Uncaged 🔓'
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId,
      `Hey ${userName}! I'm ${botName}\n\n` +
      `I can discover and create capabilities on the fly. Just tell me what you need!\n\n` +
      `Type /help to see what I can do.`)
    return new Response('ok')
  }

  if (userText === '/help') {
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId,
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
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId,
      '🧹 Chat cleared! Long-term memory is still intact.')
    return new Response('ok')
  }

  if (userText === '/soul') {
    const soulText = await soul.getSoul()
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, `👻 My soul:\n\n${soulText}`)
    return new Response('ok')
  }

  // Ignore other / commands gracefully
  if (userText.startsWith('/') && !hasPhoto) {
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId,
      `Unknown command. Type /help to see available commands.`)
    return new Response('ok')
  }

  // ─── Normal message (text or multimodal) ───

  // Return early to avoid Telegram webhook timeout, process in background
  const processPromise = (async () => {
    // Show typing indicator + keep it alive during processing
    const typingInterval = startTypingIndicator(env.TELEGRAM_BOT_TOKEN, chatId, ctx)

    try {
      // Get image URL if photo is present
      let imageUrl: string | undefined
      if (hasPhoto && msg.photo) {
        // Telegram photo array: last element is highest resolution
        const photo = msg.photo[msg.photo.length - 1]
        const fileId = photo.file_id
        
        console.log('[Multimodal] Photo detected, file_id:', fileId)
        
        // 1. Get file path from Telegram
        const fileRes = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`)
        const fileData = await fileRes.json() as any
        
        if (fileData.ok && fileData.result.file_path) {
          const filePath = fileData.result.file_path
          const telegramUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`
          
          // 2. Download image to memory
          const imgResponse = await fetch(telegramUrl)
          if (imgResponse.ok) {
            const arrayBuffer = await imgResponse.arrayBuffer()
            
            // Detect MIME type from file extension
            const ext = filePath.split('.').pop()?.toLowerCase() || 'jpg'
            const mimeType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
            const filename = `tg-${fileId.slice(0,8)}.${ext}`
            
            // 3. Upload to DashScope Files API (with base64 fallback)
            imageUrl = await storeImageForVL(arrayBuffer, mimeType, env.CHAT_KV, 'https://doudou.shazhou.work')
          }
        }
      }

      // Store user message embedding (text only, don't store image URLs)
      const storeUserPromise = memory.store(userText || '[Image]', 'user', memorySessionId)

      // Load chat history
      let messages = await chatStore.load(chatId)

      // Compress if needed
      const { messages: compressed } = chatStore.maybeCompress(messages)
      messages = compressed

      // Add user message (multimodal or text-only)
      if (imageUrl) {
        // Multimodal message
        const content: ContentPart[] = []
        if (userText) content.push({ type: 'text', text: userText })
        content.push({ type: 'image_url', image_url: { url: imageUrl } })
        messages.push({ role: 'user', content })
        console.log('[Multimodal] Added multimodal message with', content.length, 'parts')
      } else {
        messages.push({ role: 'user', content: userText })
      }

      // Run agentic loop
      const { reply, updatedMessages } = await llm.agentLoop(messages, sigil, soul, memory, memorySessionId)

      // Stop typing
      typingInterval.stop()

      // Store assistant reply embedding (async)
      const storeAssistantPromise = memory.store(reply, 'assistant', memorySessionId)

      // Save chat history
      await chatStore.save(chatId, updatedMessages)

      // Reply
      await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, reply)

      // Await embedding storage (best effort)
      await Promise.allSettled([storeUserPromise, storeAssistantPromise])
    } catch (e: any) {
      typingInterval.stop()
      console.error('[uncaged] error:', e)
      await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId,
        `Oops, something went wrong. Try again?`)
    }
  })()

  // Process in background — don't block Telegram webhook response
  if (ctx) {
    ctx.waitUntil(processPromise)
  } else {
    await processPromise
  }

  return new Response('ok')
}

async function sendChatAction(token: string, chatId: number, action: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action }),
  })
}

/**
 * Send typing indicator with throttled refresh.
 * CF Workers don't support setInterval, so we use a polling loop with waitUntil.
 * Typing expires after 5s in Telegram, we refresh every 4s.
 */
function startTypingIndicator(token: string, chatId: number, ctx?: ExecutionContext): { stop: () => void } {
  let stopped = false
  let lastSent = 0

  const send = () => {
    const now = Date.now()
    if (stopped || now - lastSent < 4000) return
    lastSent = now
    // Fire and forget
    sendChatAction(token, chatId, 'typing').catch(() => {})
  }

  // Fire immediately
  send()

  // Refresh via a self-scheduling loop (works in CF Workers via microtasks)
  const loopPromise = (async () => {
    while (!stopped) {
      await new Promise(r => setTimeout(r, 4000))
      send()
    }
  })()

  // Use waitUntil to keep the loop alive
  if (ctx) {
    ctx.waitUntil(loopPromise)
  }

  return {
    stop() { stopped = true },
  }
}

export async function sendTelegram(token: string, chatId: number, text: string): Promise<void> {
  // Try Markdown first, fall back to plain text
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    }),
  })
  if (!res.ok) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    })
  }
}
