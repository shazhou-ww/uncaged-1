// Telegram Bot API helpers

import { SigilClient } from './sigil.js'
import { LlmClient } from './llm.js'
import { ChatStore } from './chat-store.js'
import { Soul } from './soul.js'
import { Memory } from './memory.js'
import type { Env } from './index.js'

interface TelegramUpdate {
  message?: {
    message_id: number
    chat: { id: number }
    from?: { id: number; first_name?: string; username?: string }
    text?: string
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
): Promise<Response> {
  const update: TelegramUpdate = await request.json()
  const msg = update.message
  if (!msg?.text) return new Response('ok')

  const chatId = msg.chat.id
  const userText = msg.text.trim()
  const userName = msg.from?.first_name || 'there'

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
      `- Recall past conversations by topic or time\n\n` +
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
  if (userText.startsWith('/')) {
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId,
      `Unknown command. Type /help to see available commands.`)
    return new Response('ok')
  }

  // ─── Normal message ───

  try {
    // Store user message embedding (async, don't block)
    const storeUserPromise = memory.store(userText, 'user', chatId)

    // Load chat history
    let messages = await chatStore.load(chatId)

    // Compress if needed
    const { messages: compressed } = chatStore.maybeCompress(messages)
    messages = compressed

    // Add user message
    messages.push({ role: 'user', content: userText })

    // Run agentic loop
    const { reply, updatedMessages } = await llm.agentLoop(messages, sigil, soul, memory)

    // Store assistant reply embedding (async)
    const storeAssistantPromise = memory.store(reply, 'assistant', chatId)

    // Save chat history
    await chatStore.save(chatId, updatedMessages)

    // Reply
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, reply)

    // Await embedding storage (best effort)
    await Promise.allSettled([storeUserPromise, storeAssistantPromise])
  } catch (e: any) {
    console.error('[uncaged] error:', e)
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId,
      `Oops, something went wrong. Try again?`)
  }

  return new Response('ok')
}

async function sendTelegram(token: string, chatId: number, text: string): Promise<void> {
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
