// Chat history storage — KV-backed, per chat_id

export type MessageContent = string | ContentPart[]

export interface ContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: MessageContent | null
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

/**
 * Helper function to extract text content from multimodal content.
 * For backward compatibility with code that expects string content.
 */
export function getTextContent(content: MessageContent | null | undefined): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content.filter(p => p.type === 'text').map(p => p.text || '').join('\n')
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
  /** Non-system message count in KV when load() ran (for detecting concurrent writes). */
  private readonly kvNonSystemBaselineByChat = new Map<string, number>()
  /**
   * Non-system count after maybeCompress() for this chat (defaults to KV baseline until compress runs).
   * Used to slice out only messages appended since load/compress.
   */
  private readonly sliceNonSystemBaselineByChat = new Map<string, number>()
  /** chatId from the last load(); used by maybeCompress to attribute slice baseline updates. */
  private activeChatId: string | null = null

  constructor(private kv: KVNamespace) {}

  private key(chatId: number | string): string {
    return `chat:${chatId}`
  }

  async load(chatId: number | string): Promise<ChatMessage[]> {
    const key = String(chatId)
    this.activeChatId = key

    const raw = await this.kv.get(this.key(chatId))
    if (!raw) {
      this.kvNonSystemBaselineByChat.set(key, 0)
      this.sliceNonSystemBaselineByChat.set(key, 0)
      return []
    }
    try {
      const parsed: ChatMessage[] = JSON.parse(raw)
      const nonSystem = parsed.filter(m => m.role !== 'system').length
      this.kvNonSystemBaselineByChat.set(key, nonSystem)
      this.sliceNonSystemBaselineByChat.set(key, nonSystem)
      return parsed
    } catch {
      this.kvNonSystemBaselineByChat.set(key, 0)
      this.sliceNonSystemBaselineByChat.set(key, 0)
      return []
    }
  }

  async save(chatId: number | string, messages: ChatMessage[]): Promise<void> {
    // Strip system messages before saving (reconstructed each request)
    const key = String(chatId)
    let toSave = messages.filter(m => m.role !== 'system')
    const kvBaseline = this.kvNonSystemBaselineByChat.get(key) ?? 0
    const sliceBaseline = this.sliceNonSystemBaselineByChat.get(key) ?? kvBaseline

    // Re-read KV immediately before write to shrink the lost-update window.
    // For true serialisation under high concurrency, use Durable Objects (or similar).
    const raw = await this.kv.get(this.key(chatId))
    let fresh: ChatMessage[] = []
    if (raw) {
      try {
        fresh = JSON.parse(raw)
      } catch {
        fresh = []
      }
    }
    const freshNonSystem = fresh.filter(m => m.role !== 'system')

    if (freshNonSystem.length > kvBaseline) {
      const ourNew =
        sliceBaseline <= toSave.length ? toSave.slice(sliceBaseline) : toSave
      toSave = [...freshNonSystem, ...ourNew]
    }

    await this.kv.put(this.key(chatId), JSON.stringify(toSave), { expirationTtl: CHAT_TTL })
  }

  async clear(chatId: number | string): Promise<void> {
    const key = String(chatId)
    this.kvNonSystemBaselineByChat.delete(key)
    this.sliceNonSystemBaselineByChat.delete(key)
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

    if (this.activeChatId != null) {
      this.sliceNonSystemBaselineByChat.set(
        this.activeChatId,
        cleaned.filter(m => m.role !== 'system').length,
      )
    }

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
