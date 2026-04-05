import { authedFetch } from './auth'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string | ContentPart[]
  timestamp?: number
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ContentPart {
  type: 'text' | 'tool_use' | 'tool_result' | 'image_url'
  text?: string
  name?: string
  input?: Record<string, unknown>
  content?: string
  image_url?: { url: string }
}

export async function sendMessage(
  basePath: string,
  message: string,
): Promise<{ response: string; timestamp: number }> {
  const r = await authedFetch(`${basePath}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  if (!r.ok) throw new Error('Chat request failed')
  return r.json()
}

export async function loadHistory(
  basePath: string,
): Promise<{ history: ChatMessage[] }> {
  const r = await authedFetch(`${basePath}/api/history`)
  if (!r.ok) throw new Error('History request failed')
  return r.json()
}

export async function clearHistory(basePath: string): Promise<void> {
  await authedFetch(`${basePath}/api/clear`, { method: 'POST' })
}
