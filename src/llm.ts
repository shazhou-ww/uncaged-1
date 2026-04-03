// LLM client — DashScope (OpenAI-compatible)

import { SigilClient } from './sigil.js'

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const MODEL = 'qwen-plus'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export class LlmClient {
  constructor(private apiKey: string) {}

  private async chat(messages: ChatMessage[]): Promise<string> {
    const res = await fetch(`${DASHSCOPE_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.3,
        response_format: { type: 'text' },
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`LLM error: ${res.status} ${body}`)
    }

    const data: any = await res.json()
    return data.choices?.[0]?.message?.content || ''
  }

  private async chatJson(messages: ChatMessage[]): Promise<any> {
    const res = await fetch(`${DASHSCOPE_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`LLM error: ${res.status} ${body}`)
    }

    const data: any = await res.json()
    const content = data.choices?.[0]?.message?.content || '{}'
    return JSON.parse(content)
  }

  /**
   * Plan: understand user intent and decide what to do.
   * Returns a structured plan object.
   */
  async plan(userMessage: string, sigil: SigilClient): Promise<any> {
    // First, get list of available capabilities for context
    let capList: string[] = []
    try {
      const queryResult = await sigil.query('', 20)
      capList = queryResult.items.map(i => {
        const desc = i.description ? ` — ${i.description}` : ''
        return `${i.capability}${desc}`
      })
    } catch { /* ignore */ }

    const systemPrompt = `You are Uncaged, an AI agent with the ability to create and use serverless capabilities (cloud functions) via Sigil.

Available capabilities on Sigil:
${capList.length > 0 ? capList.map(c => `- ${c}`).join('\n') : '(none yet)'}

Given the user's message, decide your action. Reply with a JSON object:

1. If you can answer directly without any capability (casual chat, general knowledge):
   {"action": "direct_answer", "answer": "your response"}

2. If an existing capability can help:
   {"action": "search_and_use", "search_query": "search term", "invoke_params": {"param": "value"}}

3. If no existing capability fits but you can create one:
   {"action": "create_and_use", "capability_name": "short-name", "capability_description": "what it does", "capability_schema": {"type": "object", "properties": {...}, "required": [...]}, "capability_execute": "JavaScript code that processes input and returns result", "invoke_params": {"param": "value"}}

Rules for capability_execute:
- It receives an \`input\` object with the schema properties
- It must return a value (string or object) — this is the function body
- It runs in a Cloudflare Worker (no Node.js APIs, but fetch() is available)
- Keep it simple and focused on one task
- Example: \`return { encoded: btoa(input.text) }\`

Rules for capability_name:
- Lowercase, hyphens, no spaces (e.g., "base64-encode", "currency-convert")
- Descriptive but short`

    return this.chatJson([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ])
  }

  /**
   * Design a capability when search found nothing.
   */
  async designCapability(userMessage: string): Promise<any> {
    const systemPrompt = `You are a capability designer. The user needs something that doesn't exist yet as a cloud function.
Design a minimal serverless capability to fulfill their need. Reply with JSON:
{
  "capability_name": "short-name",
  "capability_description": "what it does",
  "capability_schema": {"type": "object", "properties": {...}, "required": [...]},
  "capability_execute": "JavaScript function body that processes input and returns result",
  "invoke_params": {"param": "value for this specific request"}
}

The execute code runs in a Cloudflare Worker: fetch() available, no Node.js APIs.`

    return this.chatJson([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ])
  }

  /**
   * Summarize a capability's result into a natural language reply.
   */
  async summarize(userMessage: string, capability: string, result: string): Promise<string> {
    return this.chat([
      {
        role: 'system',
        content: `You are Uncaged, an AI agent. You just used a capability called "${capability}" and got a result. Summarize it naturally for the user. Be concise.`,
      },
      {
        role: 'user',
        content: `User asked: "${userMessage}"\n\nCapability result:\n${result}`,
      },
    ])
  }
}
