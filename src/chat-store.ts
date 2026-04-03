// Chat history storage — KV-backed, per chat_id

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
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

// Max messages before compression triggers
const COMPRESS_THRESHOLD = 40
// After compression, keep this many recent messages
const COMPRESS_KEEP_RECENT = 10
// KV TTL: 24 hours
const CHAT_TTL = 86400

export class ChatStore {
  constructor(private kv: KVNamespace) {}

  private key(chatId: number): string {
    return `chat:${chatId}`
  }

  async load(chatId: number): Promise<ChatMessage[]> {
    const raw = await this.kv.get(this.key(chatId))
    if (!raw) return []
    try {
      return JSON.parse(raw)
    } catch {
      return []
    }
  }

  async save(chatId: number, messages: ChatMessage[]): Promise<void> {
    // Strip system messages before saving (reconstructed each request)
    const toSave = messages.filter(m => m.role !== 'system')
    await this.kv.put(this.key(chatId), JSON.stringify(toSave), { expirationTtl: CHAT_TTL })
  }

  async clear(chatId: number): Promise<void> {
    await this.kv.delete(this.key(chatId))
  }

  /**
   * Check if compression is needed and perform it.
   * Returns the (possibly compressed) message list.
   */
  maybeCompress(messages: ChatMessage[]): { messages: ChatMessage[]; compressed: boolean } {
    // Only count non-system messages
    const nonSystem = messages.filter(m => m.role !== 'system')
    if (nonSystem.length <= COMPRESS_THRESHOLD) {
      return { messages, compressed: false }
    }

    // Strategy: keep first user message + last N messages
    // This naturally drops old tool call chains (including sigil_query results)
    // which causes the dynamic tools derived from them to be "unloaded"
    const system = messages.filter(m => m.role === 'system')
    const firstUser = nonSystem.find(m => m.role === 'user')
    const recent = nonSystem.slice(-COMPRESS_KEEP_RECENT)

    // Build compressed history
    const compressed: ChatMessage[] = [
      ...system,
    ]

    // Add first user message if it's not in recent
    if (firstUser && !recent.includes(firstUser)) {
      compressed.push(firstUser)
      // Add a compression marker
      compressed.push({
        role: 'assistant',
        content: '[Earlier conversation compressed. Some capabilities may need to be re-queried from Sigil.]',
      })
    }

    compressed.push(...recent)

    // Ensure consistency: if recent starts with a tool result,
    // we need to include the preceding assistant tool_call message
    // Walk backwards from the cut point to find orphaned tool messages
    const cleaned = this.ensureToolConsistency(compressed)

    return { messages: cleaned, compressed: true }
  }

  /**
   * Ensure tool messages always have their parent assistant tool_call.
   * Remove orphaned tool messages that lost their parent during compression.
   */
  private ensureToolConsistency(messages: ChatMessage[]): ChatMessage[] {
    const result: ChatMessage[] = []
    const toolCallIds = new Set<string>()

    // First pass: collect all tool_call ids from assistant messages
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          toolCallIds.add(tc.id)
        }
      }
    }

    // Second pass: keep tool messages only if their parent exists
    for (const msg of messages) {
      if (msg.role === 'tool' && msg.tool_call_id) {
        if (toolCallIds.has(msg.tool_call_id)) {
          result.push(msg)
        }
        // else: orphaned, drop it
      } else {
        result.push(msg)
      }
    }

    return result
  }
}
