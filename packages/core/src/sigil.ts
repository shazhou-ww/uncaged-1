// Sigil API client with D1 fallback support (Phase 3a) and local WorkerPool execution (Phase 3b)

import { WorkerPool, type WorkerLoader } from './sigil/worker-pool.js'
import { EmbeddingService } from './sigil/embedding.js'

export interface DeployParams {
  name: string
  code?: string
  schema?: any
  execute?: string
  description?: string
  tags?: string[]
}

export interface QueryResult {
  items: Array<{
    capability: string
    description?: string
    tags?: string[]
    type: string
    schema?: any
  }>
  total: number
}

export interface D1CapabilityRow {
  id: string
  slug: string
  display_name?: string
  description?: string
  tags?: string  // JSON string
  type: string
  schema?: string  // JSON string
}

export class SigilClient {
  private workerPool?: WorkerPool

  constructor(
    private baseUrl: string,        // remote URL (can be empty string for local-only)
    private deployToken: string,
    private d1db?: D1Database,
  ) {}

  /**
   * Set D1 database for fallback queries (Phase 3a)
   */
  setD1Database(db: D1Database) {
    this.d1db = db
  }

  /** Configure local execution (Phase 3b) */
  setLocalExecution(kv: KVNamespace, loader: WorkerLoader, ai: any): void {
    const embeddingService = new EmbeddingService(ai, kv)
    this.workerPool = new WorkerPool(kv, loader, embeddingService)
  }

  async query(q: string, limit = 5, agentId?: string): Promise<QueryResult> {
    // If local WorkerPool available, use it directly
    if (this.workerPool) {
      const result = await this.workerPool.query({ q, limit })
      // Map WorkerPool's QueryResult to SigilClient's QueryResult format
      return {
        items: result.items.map(item => ({
          capability: item.capability,
          description: item.description,
          tags: item.tags,
          type: item.type,
          schema: item.schema
        })),
        total: result.total
      }
    }

    try {
      // Primary: Remote Sigil Worker
      const url = new URL('/_api/query', this.baseUrl)
      url.searchParams.set('q', q)
      url.searchParams.set('limit', String(limit))
      url.searchParams.set('sort', 'relevance')

      const res = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${this.deployToken}` },
      })
      
      if (res.ok) {
        const remoteResult = await res.json() as QueryResult
        
        // Phase 3a: Augment with D1 capabilities for this agent
        if (this.d1db && agentId) {
          const d1Capabilities = await this.queryD1Capabilities(q, agentId, limit)
          // Merge results - remote first, then D1
          remoteResult.items = [...remoteResult.items, ...d1Capabilities]
          remoteResult.total = remoteResult.items.length
        }
        
        return remoteResult
      }
    } catch (error) {
      console.warn('[Sigil] Remote query failed, falling back to D1:', error)
    }

    // Fallback: D1-only if remote fails and D1 is available
    if (this.d1db && agentId) {
      const d1Capabilities = await this.queryD1Capabilities(q, agentId, limit)
      return {
        items: d1Capabilities,
        total: d1Capabilities.length
      }
    }

    throw new Error(`Sigil query failed and no D1 fallback available`)
  }

  /**
   * Query D1 capabilities enabled for an agent (Phase 3a)
   */
  private async queryD1Capabilities(query: string, agentId: string, limit: number): Promise<QueryResult['items']> {
    if (!this.d1db) return []

    try {
      // Simple text search in D1 capabilities that are enabled for this agent
      const searchTerm = `%${query.toLowerCase()}%`
      const result = await this.d1db
        .prepare(`
          SELECT c.slug, c.display_name, c.description, c.tags, c.type, c.schema
          FROM capabilities c
          JOIN agent_capabilities ac ON c.id = ac.capability_id
          WHERE ac.agent_id = ?
            AND (
              LOWER(c.slug) LIKE ? OR 
              LOWER(c.display_name) LIKE ? OR 
              LOWER(c.description) LIKE ?
            )
          ORDER BY c.access_count DESC
          LIMIT ?
        `)
        .bind(agentId, searchTerm, searchTerm, searchTerm, limit)
        .all()

      return result.results?.map((row: any) => ({
        capability: row.slug,
        description: row.description || row.display_name || undefined,
        tags: row.tags ? JSON.parse(row.tags) : undefined,
        type: row.type,
        schema: row.schema ? JSON.parse(row.schema) : undefined
      })) || []
    } catch (error) {
      console.error('[Sigil] D1 query failed:', error)
      return []
    }
  }

  async inspect(name: string, agentId?: string): Promise<any> {
    if (this.workerPool) {
      return this.workerPool.inspect(name)
    }

    try {
      // Primary: Remote Sigil Worker
      const res = await fetch(`${this.baseUrl}/_api/inspect/${name}`, {
        headers: { 'Authorization': `Bearer ${this.deployToken}` },
      })
      if (res.ok) {
        return res.json()
      }
    } catch (error) {
      console.warn('[Sigil] Remote inspect failed, trying D1:', error)
    }

    // Fallback: D1 lookup if remote fails
    if (this.d1db && agentId) {
      try {
        const result = await this.d1db
          .prepare(`
            SELECT c.* 
            FROM capabilities c
            JOIN agent_capabilities ac ON c.id = ac.capability_id
            WHERE ac.agent_id = ? AND c.slug = ?
          `)
          .bind(agentId, name)
          .first<any>()

        if (result) {
          return {
            name: result.slug,
            code: result.code || undefined,
            execute: result.execute || undefined,
            schema: result.schema ? JSON.parse(result.schema) : undefined,
            description: result.description || undefined,
            tags: result.tags ? JSON.parse(result.tags) : undefined,
            type: result.type
          }
        }
      } catch (error) {
        console.error('[Sigil] D1 inspect failed:', error)
      }
    }

    throw new Error(`Sigil inspect failed: ${name}`)
  }

  async deploy(params: DeployParams): Promise<any> {
    if (this.workerPool) {
      return this.workerPool.deploy({
        name: params.name,
        code: params.code,
        schema: params.schema,
        execute: params.execute,
        type: 'normal',
        description: params.description,
        tags: params.tags,
      })
    }

    const res = await fetch(`${this.baseUrl}/_api/deploy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.deployToken}`,
      },
      body: JSON.stringify({
        name: params.name,
        code: params.code,
        schema: params.schema,
        execute: params.execute,
        type: 'normal',
        description: params.description,
        tags: params.tags,
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Sigil deploy failed: ${res.status} ${body}`)
    }
    return res.json()
  }

  async run(name: string, params: Record<string, any> = {}): Promise<string> {
    if (this.workerPool) {
      // WorkerPool.invoke() takes a Request and returns a Response
      // Need to convert params → Request and Response → string
      const request = new Request('http://localhost/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      const response = await this.workerPool.invoke(name, request)
      return response.text()
    }

    const res = await fetch(`${this.baseUrl}/run/${name}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.deployToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Sigil run failed: ${res.status} ${body}`)
    }
    return res.text()
  }

  async listCapabilities(agentId?: string): Promise<string[]> {
    const result = await this.query('', 50, agentId)
    return result.items.map(i => i.capability)
  }
}
