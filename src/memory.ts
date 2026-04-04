// Memory — per-instance long-term memory backed by Vectorize + Workers AI embeddings
// Every message gets embedded and stored. Retrieval by semantic similarity or time range.

const EMBEDDING_MODEL = '@cf/baai/bge-m3'

export interface MemoryEntry {
  id: string
  text: string
  role: 'user' | 'assistant'
  timestamp: number
  chatId: number
  instanceId: string
  score?: number
}

// bge-m3: 1024 dims, multilingual (was bge-base-en-v1.5: 768 dims, english-only)
export class Memory {
  constructor(
    private vectorIndex: VectorizeIndex,
    private ai: any, // Workers AI binding
    private instanceId: string,
  ) {}

  /**
   * Store a message in long-term memory with its embedding.
   */
  async store(text: string, role: 'user' | 'assistant', chatId: number | string): Promise<string> {
    const id = `${this.instanceId}:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`
    const timestamp = Date.now()

    // Generate embedding
    const embedding = await this.embed(text)

    // Upsert into Vectorize
    await this.vectorIndex.upsert([{
      id,
      values: embedding,
      metadata: {
        text: text.slice(0, 1000), // Vectorize metadata size limit
        role,
        timestamp,
        chat_id: chatId,
        instance_id: this.instanceId,
      },
    }])

    return id
  }

  /**
   * Semantic search: find memories most similar to the query.
   * Returns top matches + surrounding context messages.
   */
  async search(query: string, topK = 5, contextWindow = 2): Promise<MemoryEntry[]> {
    const queryEmbedding = await this.embed(query)

    const results = await this.vectorIndex.query(queryEmbedding, {
      topK,
      returnMetadata: 'all',
      filter: {
        instance_id: this.instanceId,
      },
    })

    if (!results.matches || results.matches.length === 0) {
      return []
    }

    // Convert matches to MemoryEntry
    const entries: MemoryEntry[] = results.matches.map(m => ({
      id: m.id,
      text: (m.metadata?.text as string) || '',
      role: (m.metadata?.role as 'user' | 'assistant') || 'user',
      timestamp: (m.metadata?.timestamp as number) || 0,
      chatId: (m.metadata?.chat_id as number) || 0,
      instanceId: (m.metadata?.instance_id as string) || this.instanceId,
      score: m.score,
    }))

    if (contextWindow <= 0) return entries

    // For each match, fetch surrounding messages by timestamp
    const expanded = await this.expandContext(entries, contextWindow)
    return expanded
  }

  /**
   * Time-range recall: get messages from a specific time period.
   * Useful for "what did we talk about yesterday?"
   */
  async recall(startTime: number, endTime: number, limit = 20): Promise<MemoryEntry[]> {
    // Use a neutral embedding — but fetch more than needed and sort by time
    const neutralText = 'conversation message recall'
    const embedding = await this.embed(neutralText)

    const results = await this.vectorIndex.query(embedding, {
      topK: Math.min(limit * 5, 100),  // fetch more to compensate for semantic bias
      returnMetadata: 'all',
      filter: {
        instance_id: this.instanceId,
        timestamp: { $gte: startTime, $lte: endTime },
      },
    })

    if (!results.matches) return []

    // Sort by timestamp (not by semantic similarity)
    return results.matches
      .map(m => ({
        id: m.id,
        text: (m.metadata?.text as string) || '',
        role: (m.metadata?.role as 'user' | 'assistant') || 'user',
        timestamp: (m.metadata?.timestamp as number) || 0,
        chatId: (m.metadata?.chat_id as number) || 0,
        instanceId: (m.metadata?.instance_id as string) || this.instanceId,
        score: m.score,
      }))
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, limit)
  }

  /**
   * Get count of stored memories for this instance.
   */
  async count(): Promise<number> {
    try {
      const embedding = await this.embed('memory count')
      const results = await this.vectorIndex.query(embedding, {
        topK: 100,
        returnMetadata: 'none',
        filter: { instance_id: this.instanceId },
      })
      return results.matches?.length || 0
    } catch {
      return 0
    }
  }

  /**
   * Delete a specific memory entry.
   */
  async forget(id: string): Promise<boolean> {
    try {
      await this.vectorIndex.deleteByIds([id])
      return true
    } catch {
      return false
    }
  }

  // ─── Private helpers ───

  private async embed(text: string): Promise<number[]> {
    const result = await this.ai.run(EMBEDDING_MODEL, { text: [text] })
    return result.data[0]
  }

  /**
   * Given seed entries, fetch surrounding messages (by timestamp proximity)
   * to provide conversation context.
   */
  private async expandContext(seeds: MemoryEntry[], windowSize: number): Promise<MemoryEntry[]> {
    if (seeds.length === 0) return []

    // For each seed, query nearby timestamps
    const allEntries = new Map<string, MemoryEntry>()
    for (const seed of seeds) {
      allEntries.set(seed.id, seed)
    }

    // Expand: find messages within a time window around each match
    for (const seed of seeds.slice(0, 3)) { // limit expansion to top 3
      const timeWindowMs = 5 * 60 * 1000 // 5 minute window
      const startTime = seed.timestamp - timeWindowMs
      const endTime = seed.timestamp + timeWindowMs

      try {
        const nearby = await this.recall(startTime, endTime, windowSize * 2 + 1)
        for (const entry of nearby) {
          allEntries.set(entry.id, entry)
        }
      } catch {
        // Vectorize filter might not support range on all plans, degrade gracefully
      }
    }

    // Sort by timestamp
    return Array.from(allEntries.values()).sort((a, b) => a.timestamp - b.timestamp)
  }
}
