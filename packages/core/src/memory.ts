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

export interface KnowledgeEntry {
  id: string
  type: 'profile' | 'event' | 'preference' | 'fact'
  subject: string
  content: string
  confidence: number
  sourceIds?: string[]
  createdAt: number
  updatedAt: number
}

// bge-m3: 1024 dims, multilingual (was bge-base-en-v1.5: 768 dims, english-only)
export class Memory {
  private hasD1: boolean

  constructor(
    private vectorIndex: VectorizeIndex,
    private ai: any, // Workers AI binding
    private instanceId: string,
    private db?: D1Database, // Optional D1 binding for structured storage
  ) {
    this.hasD1 = !!db
    if (!this.hasD1) {
      console.warn('[Memory] D1 binding not found, falling back to Vectorize-only mode')
    }
  }

  hasD1Access(): boolean {
    return this.hasD1
  }

  /**
   * Store a message in long-term memory with its embedding.
   * Dual-write: D1 (structured) + Vectorize (semantic search).
   */
  async store(text: string, role: 'user' | 'assistant', chatId: number | string): Promise<string> {
    const id = `${this.instanceId}:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`
    const timestamp = Date.now()

    // Generate embedding
    const embedding = await this.embed(text)

    // Dual-write: D1 + Vectorize (parallel)
    const writes: Promise<any>[] = [
      // Vectorize upsert
      this.vectorIndex.upsert([{
        id,
        values: embedding,
        metadata: {
          text: text.slice(0, 1000), // Vectorize metadata size limit
          role,
          timestamp,
          chat_id: chatId,
          instance_id: this.instanceId,
        },
      }]),
    ]

    // D1 insert (if available)
    if (this.hasD1 && this.db) {
      writes.push(
        this.db.prepare(`
          INSERT INTO memories (id, instance_id, text, role, chat_id, timestamp)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(id, this.instanceId, text, role, String(chatId), timestamp).run()
      )
    }

    // Wait for both (but don't fail if one fails)
    await Promise.allSettled(writes)

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
   * 
   * Now uses D1 for accurate time-range queries (Issue #8).
   * Falls back to Vectorize if D1 not available (legacy mode).
   */
  async recall(startTime: number, endTime: number, limit = 20): Promise<MemoryEntry[]> {
    // D1 path: per-contact latest + global recent, merged & deduped
    if (this.hasD1 && this.db) {
      try {
        // Step 1: Latest message from each contact (chat_id) in time range
        const perContact = await this.db.prepare(`
          SELECT id, text, role, timestamp, chat_id, instance_id FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY chat_id ORDER BY timestamp DESC) as rn
            FROM memories
            WHERE instance_id = ? AND timestamp BETWEEN ? AND ?
          ) WHERE rn = 1
        `).bind(this.instanceId, startTime, endTime).all()

        // Step 2: Global most recent N messages
        const recent = await this.db.prepare(`
          SELECT id, text, role, timestamp, chat_id, instance_id
          FROM memories
          WHERE instance_id = ? AND timestamp BETWEEN ? AND ?
          ORDER BY timestamp DESC
          LIMIT ?
        `).bind(this.instanceId, startTime, endTime, limit).all()

        // Step 3: Merge + dedupe by id + sort by timestamp
        const merged = new Map<string, MemoryEntry>()
        for (const row of [...(perContact.results || []), ...(recent.results || [])]) {
          const r = row as any
          if (!merged.has(r.id)) {
            merged.set(r.id, {
              id: r.id,
              text: r.text,
              role: r.role as 'user' | 'assistant',
              timestamp: r.timestamp,
              chatId: r.chat_id,
              instanceId: r.instance_id,
            })
          }
        }

        const d1Results = Array.from(merged.values())
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(0, limit)

        // If D1 has enough results, return them
        // Otherwise fall through to Vectorize to supplement (D1 may not have historical data)
        if (d1Results.length >= Math.max(3, limit / 2)) {
          return d1Results
        }

        // D1 results are sparse — supplement with Vectorize fallback below
        // We'll merge D1 + Vectorize results at the end
        console.log(`[Memory] D1 recall returned only ${d1Results.length}/${limit}, supplementing with Vectorize`)

        // Fall through to Vectorize path, but keep d1Results to merge
        const vectorizeResults = await this.recallFromVectorize(startTime, endTime, limit)

        // Merge: D1 results take priority (more accurate), Vectorize fills gaps
        const allResults = new Map<string, MemoryEntry>()
        for (const entry of [...d1Results, ...vectorizeResults]) {
          if (!allResults.has(entry.id)) {
            allResults.set(entry.id, entry)
          }
        }

        return Array.from(allResults.values())
          .sort((a, b) => a.timestamp - b.timestamp)
          .slice(0, limit)

      } catch (e) {
        console.error('[Memory] D1 recall failed, falling back to Vectorize:', e)
      }
    }

    // Vectorize-only path
    return this.recallFromVectorize(startTime, endTime, limit)
  }

  /**
   * Recall messages from Vectorize within a time range.
   * Private method used for fallback and supplementation.
   */
  private async recallFromVectorize(startTime: number, endTime: number, limit: number): Promise<MemoryEntry[]> {
    // Vectorize fallback: use a neutral embedding — but fetch more than needed and sort by time
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
   * Now uses D1 for exact count (Issue #8).
   */
  async count(): Promise<number> {
    // D1 path: exact count
    if (this.hasD1 && this.db) {
      try {
        const result = await this.db.prepare(`
          SELECT COUNT(*) as count FROM memories WHERE instance_id = ?
        `).bind(this.instanceId).first()
        return (result as any)?.count || 0
      } catch (e) {
        console.error('[Memory] D1 count failed, falling back to Vectorize estimate:', e)
      }
    }

    // Vectorize fallback: estimate via high topK query
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
   * Dual-delete: D1 + Vectorize.
   */
  async forget(id: string): Promise<boolean> {
    const deletes: Promise<any>[] = [
      // Vectorize delete
      this.vectorIndex.deleteByIds([id]),
    ]

    // D1 delete (if available)
    if (this.hasD1 && this.db) {
      deletes.push(
        this.db.prepare(`DELETE FROM memories WHERE id = ?`).bind(id).run()
      )
    }

    try {
      await Promise.allSettled(deletes)
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

  // ─── Knowledge Distillation Methods ───

  /**
   * Distill and store structured knowledge from conversations.
   * Updates existing knowledge if same subject+type exists, otherwise creates new.
   */
  async distillKnowledge(
    type: 'profile' | 'event' | 'preference' | 'fact', 
    subject: string, 
    content: string, 
    confidence: number = 0.8, 
    sourceIds?: string[]
  ): Promise<{id: string, updated: boolean}> {
    if (!this.hasD1 || !this.db) {
      throw new Error('Knowledge system requires D1 database')
    }

    console.log(`[Knowledge] Distilling ${type} about "${subject}"`)

    // Normalize subject for consistent matching
    const normalizedSubject = subject.trim().toLowerCase()
    const now = Date.now()
    const sourceIdsJson = sourceIds ? JSON.stringify(sourceIds) : null

    try {
      // Check if knowledge with same subject+type exists
      const existing = await this.db.prepare(`
        SELECT id, content, confidence FROM knowledge 
        WHERE instance_id = ? AND type = ? AND LOWER(subject) = ?
      `).bind(this.instanceId, type, normalizedSubject).first()

      if (existing) {
        // Update existing knowledge
        const existingData = existing as any
        await this.db.prepare(`
          UPDATE knowledge 
          SET content = ?, confidence = ?, source_ids = ?, updated_at = ?
          WHERE id = ?
        `).bind(content, confidence, sourceIdsJson, now, existingData.id).run()

        console.log(`[Knowledge] Updated existing ${type} for "${subject}"`)
        return { id: existingData.id, updated: true }
      } else {
        // Insert new knowledge
        const id = `knowledge_${this.instanceId}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`
        await this.db.prepare(`
          INSERT INTO knowledge (id, instance_id, type, subject, content, confidence, source_ids, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(id, this.instanceId, type, subject, content, confidence, sourceIdsJson, now, now).run()

        console.log(`[Knowledge] Created new ${type} for "${subject}"`)
        return { id, updated: false }
      }
    } catch (e: any) {
      console.error('[Knowledge] Distillation failed:', e.message)
      throw e
    }
  }

  /**
   * Search structured knowledge base for information about a person, topic, or event.
   * More accurate than raw memory search for known facts.
   */
  async recallKnowledge(opts: {
    subject?: string, 
    type?: 'profile' | 'event' | 'preference' | 'fact', 
    query?: string
  }): Promise<KnowledgeEntry[]> {
    if (!this.hasD1 || !this.db) {
      throw new Error('Knowledge system requires D1 database')
    }

    console.log(`[Knowledge] Recalling knowledge:`, opts)

    try {
      let sql = `SELECT * FROM knowledge WHERE instance_id = ?`
      const params: any[] = [this.instanceId]

      // Build WHERE conditions
      if (opts.type) {
        sql += ` AND type = ?`
        params.push(opts.type)
      }

      if (opts.subject) {
        sql += ` AND (LOWER(subject) LIKE ? OR LOWER(content) LIKE ?)`
        const subjectPattern = `%${opts.subject.toLowerCase()}%`
        params.push(subjectPattern, subjectPattern)
      }

      if (opts.query) {
        sql += ` AND LOWER(content) LIKE ?`
        params.push(`%${opts.query.toLowerCase()}%`)
      }

      sql += ` ORDER BY updated_at DESC LIMIT 20`

      const results = await this.db.prepare(sql).bind(...params).all()
      
      const entries: KnowledgeEntry[] = (results.results || []).map((row: any) => ({
        id: row.id,
        type: row.type as 'profile' | 'event' | 'preference' | 'fact',
        subject: row.subject,
        content: row.content,
        confidence: row.confidence,
        sourceIds: row.source_ids ? JSON.parse(row.source_ids) : undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }))

      console.log(`[Knowledge] Found ${entries.length} knowledge entries`)
      return entries

    } catch (e: any) {
      console.error('[Knowledge] Recall failed:', e.message)
      return []
    }
  }
}
