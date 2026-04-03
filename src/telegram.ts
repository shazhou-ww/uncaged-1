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
  const userText = msg.text

  // /start command — reset conversation
  if (userText === '/start') {
    await chatStore.clear(chatId)
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId,
      '🔓 Hi! I\'m Uncaged — a Sigil-native AI agent.\n\n' +
      'I can discover capabilities, create new ones, and I remember everything across conversations.\n\n' +
      'Just tell me what you need!\n\n' +
      'Commands:\n/start — reset conversation\n/clear — clear chat history\n/soul — show my personality')
    return new Response('ok')
  }

  // /clear command
  if (userText === '/clear') {
    await chatStore.clear(chatId)
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, '🧹 Conversation cleared! (Long-term memory retained)')
    return new Response('ok')
  }

  // /soul command
  if (userText === '/soul') {
    const soulText = await soul.get()
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, `👻 My soul:\n\n${soulText}`)
    return new Response('ok')
  }

  try {
    // 1. Store user message embedding (async, don't block)
    const storeUserPromise = memory.store(userText, 'user', chatId)

    // 2. Load chat history
    let messages = await chatStore.load(chatId)

    // 3. Compress if needed
    const { messages: compressed } = chatStore.maybeCompress(messages)
    messages = compressed

    // 4. Add user message
    messages.push({ role: 'user', content: userText })

    // 5. Run agentic loop
    const { reply, updatedMessages } = await llm.agentLoop(messages, sigil, soul, memory)

    // 6. Store assistant reply embedding (async)
    const storeAssistantPromise = memory.store(reply, 'assistant', chatId)

    // 7. Save chat history
    await chatStore.save(chatId, updatedMessages)

    // 8. Reply to user
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, reply)

    // 9. Await embedding storage (best effort)
    await Promise.allSettled([storeUserPromise, storeAssistantPromise])
  } catch (e: any) {
    console.error('[uncaged] error:', e)
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId,
      `⚠️ Something went wrong: ${e.message || 'Unknown error'}`)
  }

  return new Response('ok')
}

async function sendTelegram(token: string, chatId: number, text: string): Promise<void> {
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
