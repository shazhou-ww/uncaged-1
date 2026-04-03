import { handleTelegramWebhook } from './telegram.js'
import { SigilClient } from './sigil.js'
import { LlmClient } from './llm.js'

export interface Env {
  TELEGRAM_BOT_TOKEN: string
  DASHSCOPE_API_KEY: string
  SIGIL_DEPLOY_TOKEN: string
  SIGIL_URL: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Health check
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(JSON.stringify({
        name: 'uncaged',
        version: '0.1.0',
        status: 'ok',
        description: 'Sigil-native AI Agent',
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    // Telegram webhook
    if (url.pathname === '/webhook' && request.method === 'POST') {
      const sigil = new SigilClient(env.SIGIL_URL, env.SIGIL_DEPLOY_TOKEN)
      const llm = new LlmClient(env.DASHSCOPE_API_KEY)
      return handleTelegramWebhook(request, env, sigil, llm)
    }

    return new Response('Not found', { status: 404 })
  },
}
