// Telegram Bot API helpers

import { SigilClient } from './sigil.js'
import { LlmClient } from './llm.js'
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
): Promise<Response> {
  const update: TelegramUpdate = await request.json()
  const msg = update.message
  if (!msg?.text) return new Response('ok')

  const chatId = msg.chat.id
  const userText = msg.text

  // /start command
  if (userText === '/start') {
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId,
      '🔓 Hi! I\'m Uncaged — a Sigil-native AI agent.\n\n' +
      'I can search for existing capabilities, create new ones on the fly, and use them to help you.\n\n' +
      'Just tell me what you need!')
    return new Response('ok')
  }

  try {
    // Run the agentic loop — LLM drives tool calls autonomously
    const result = await llm.agentLoop(userText, sigil)
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, result)
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
