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
      '🔮 Hi! I\'m Uncaged — a Sigil-native AI agent.\n\n' +
      'I can search for existing capabilities, create new ones on the fly, and use them to help you.\n\n' +
      'Just tell me what you need!')
    return new Response('ok')
  }

  try {
    // Step 1: Ask LLM to understand intent and decide action
    const plan = await llm.plan(userText, sigil)

    // Step 2: Execute the plan
    const result = await executePlan(plan, userText, sigil, llm)

    // Step 3: Reply
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, result)
  } catch (e: any) {
    console.error('[uncaged] error:', e)
    await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId,
      `⚠️ Something went wrong: ${e.message || 'Unknown error'}`)
  }

  return new Response('ok')
}

interface Plan {
  action: 'direct_answer' | 'search_and_use' | 'create_and_use'
  answer?: string
  search_query?: string
  capability_name?: string
  capability_description?: string
  capability_schema?: any
  capability_execute?: string
  invoke_params?: Record<string, any>
}

async function executePlan(
  plan: Plan,
  userText: string,
  sigil: SigilClient,
  llm: LlmClient,
): Promise<string> {
  // Direct answer — no capability needed
  if (plan.action === 'direct_answer' && plan.answer) {
    return plan.answer
  }

  // Search for existing capability
  if (plan.action === 'search_and_use' && plan.search_query) {
    const results = await sigil.query(plan.search_query)
    if (results.items && results.items.length > 0) {
      const cap = results.items[0]
      // Invoke it
      const invokeResult = await sigil.run(cap.capability, plan.invoke_params || {})
      return await llm.summarize(userText, cap.capability, invokeResult)
    }
    // Nothing found — fall through to create
  }

  // Create new capability
  if (plan.action === 'create_and_use' || plan.action === 'search_and_use') {
    // Ask LLM to design the capability if not already designed
    const design = plan.capability_execute
      ? plan
      : await llm.designCapability(userText)

    if (design.capability_name && design.capability_execute) {
      // Deploy to Sigil
      const deployed = await sigil.deploy({
        name: design.capability_name,
        schema: design.capability_schema,
        execute: design.capability_execute,
        description: design.capability_description || '',
        tags: ['auto-created'],
      })

      // Invoke if we have params, otherwise just confirm creation
      const capName = deployed.capability || design.capability_name
      const params = plan.invoke_params || {}
      const hasParams = Object.keys(params).length > 0 &&
        Object.values(params).some(v => v !== undefined && v !== null && v !== '')

      if (hasParams) {
        const invokeResult = await sigil.run(capName, params)
        return await llm.summarize(userText, capName, invokeResult)
      } else {
        // Describe what was created
        const schema = design.capability_schema
        const paramList = schema?.properties
          ? Object.entries(schema.properties).map(([k, v]: [string, any]) => `\`${k}\` (${v.type}): ${v.description || ''}`)
          : []
        return `🔮 Capability \`${capName}\` created!\n\n${design.capability_description || ''}\n\nParameters:\n${paramList.map(p => `- ${p}`).join('\n')}\n\nTry it! For example: "hash the text hello world"`
      }
    }
  }

  return '🤔 I couldn\'t figure out how to help with that. Try rephrasing?'
}

async function sendTelegram(token: string, chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    }),
  })
}
