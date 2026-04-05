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

export type StreamEvent =
  | { type: 'tool_start'; name: string; arguments: string }
  | { type: 'tool_result'; name: string; content: string }
  | { type: 'token'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

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

export async function sendMessageStream(
  basePath: string,
  message: string,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const r = await authedFetch(`${basePath}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  if (!r.ok) throw new Error('Stream request failed')

  const reader = r.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (data === '[DONE]') return
        try {
          const event = JSON.parse(data) as StreamEvent
          onEvent(event)
        } catch { /* skip malformed */ }
      }
    }
  }
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

// ── Unified Tool Interaction ──────────────────────────────────────────

export interface ToolSearchResult {
  slug: string
  name: string
  description: string
  icon?: string
  agentSlug: string
  agentName: string
  inputSchema?: Record<string, unknown>
}

export async function searchCapabilities(
  ownerPath: string,
  query: string,
  limit: number = 5,
): Promise<ToolSearchResult[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) })
  const r = await authedFetch(`${ownerPath}/api/v1/capabilities/search?${params}`)
  if (!r.ok) return []
  const data = await r.json()
  return data.results ?? data ?? []
}

export async function invokeToolDirect(
  basePath: string,
  toolSlug: string,
  args: Record<string, unknown>,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const r = await authedFetch(`${basePath}/api/v1/tools/${toolSlug}/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args }),
  })
  const data = await r.json()
  if (!r.ok) return { success: false, error: data.error ?? 'Invoke failed' }
  return { success: true, ...data }
}