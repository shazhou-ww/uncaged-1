// Memory — per-instance long-term knowledge stored in KV
// Exposed as static tools for the LLM to read/write autonomously

export interface MemoryEntry {
  id: string
  content: string
  tags: string[]
  created: number
  updated: number
}

interface MemoryStore {
  entries: MemoryEntry[]
  version: number
}

export class Memory {
  constructor(
    private kv: KVNamespace,
    private instanceId: string,
  ) {}

  private key(): string {
    return `mem:${this.instanceId}`
  }

  private async load(): Promise<MemoryStore> {
    const raw = await this.kv.get(this.key())
    if (!raw) return { entries: [], version: 0 }
    try {
      return JSON.parse(raw)
    } catch {
      return { entries: [], version: 0 }
    }
  }

  private async save(store: MemoryStore): Promise<void> {
    await this.kv.put(this.key(), JSON.stringify(store))
  }

  private generateId(): string {
    return crypto.randomUUID().slice(0, 8)
  }

  /**
   * Search memories by query string (simple substring + tag matching).
   * Returns all if query is empty.
   */
  async search(query?: string, tags?: string[]): Promise<MemoryEntry[]> {
    const store = await this.load()
    let results = store.entries

    if (query) {
      const q = query.toLowerCase()
      results = results.filter(e =>
        e.content.toLowerCase().includes(q) ||
        e.tags.some(t => t.toLowerCase().includes(q))
      )
    }

    if (tags && tags.length > 0) {
      const tagSet = new Set(tags.map(t => t.toLowerCase()))
      results = results.filter(e =>
        e.tags.some(t => tagSet.has(t.toLowerCase()))
      )
    }

    return results
  }

  /**
   * Save a new memory entry or update an existing one by id.
   */
  async save_entry(content: string, tags: string[] = [], id?: string): Promise<MemoryEntry> {
    const store = await this.load()
    const now = Date.now()

    if (id) {
      // Update existing
      const existing = store.entries.find(e => e.id === id)
      if (existing) {
        existing.content = content
        existing.tags = tags
        existing.updated = now
        store.version++
        await this.save(store)
        return existing
      }
    }

    // Create new
    const entry: MemoryEntry = {
      id: id || this.generateId(),
      content,
      tags,
      created: now,
      updated: now,
    }
    store.entries.push(entry)
    store.version++
    await this.save(store)
    return entry
  }

  /**
   * Forget a memory entry by id.
   */
  async forget(id: string): Promise<boolean> {
    const store = await this.load()
    const idx = store.entries.findIndex(e => e.id === id)
    if (idx === -1) return false
    store.entries.splice(idx, 1)
    store.version++
    await this.save(store)
    return true
  }

  /**
   * Get all memories (for injecting into system prompt summary).
   */
  async all(): Promise<MemoryEntry[]> {
    const store = await this.load()
    return store.entries
  }

  /**
   * Count of memories stored.
   */
  async count(): Promise<number> {
    const store = await this.load()
    return store.entries.length
  }
}
