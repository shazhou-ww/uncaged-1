// Telegram Bot API helpers

import { SigilClient } from './sigil.js'
import { LlmClient } from './llm.js'
import { ChatStore } from './chat-store.js'
import type { ChatMessage } from './chat-store.js'
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
      'I can discover existing capabilities, create new ones on the fly, and use them to help you.\n\n' +
      'Just tell me what you need!\n\n' +
      'Commands:\n/start — reset conversation\n/clear — clear history')
    return new Response('ok')
  }

  // /clear command
  if (userText === '/clear') {
    await chatStore.clear(chatId)
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, '🧹 Conversation cleared!')
    return new Response('ok')
  }

  try {
    // Load existing history
    let messages = await chatStore.load(chatId)

    // Compress if needed (this is where old tools get "unloaded")
    const { messages: compressed, compressed: didCompress } = chatStore.maybeCompress(messages)
    messages = compressed

    // Add user message
    messages.push({ role: 'user', content: userText })

    // Run agentic loop — tools are derived from history each round
    const { reply, updatedMessages } = await llm.agentLoop(messages, sigil)

    // Save updated history
    await chatStore.save(chatId, updatedMessages)

    // Reply
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, reply)
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
  // If Markdown parse fails, retry without parse_mode
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
