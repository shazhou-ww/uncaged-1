/**
 * Slug Resolver — Uncaged Phase 2
 * 
 * Resolves slugs and short IDs to canonical route information with KV caching.
 * Handles both /:owner_slug/:agent_slug and /id/:owner_short_id/:agent_short_id routing.
 */

export interface ResolvedRoute {
  ownerId: string       // UUID
  ownerSlug: string
  ownerShortId: string  // u_xxxxx
  agentId: string       // UUID  
  agentSlug: string
  agentShortId: string  // a_xxxxx
}

// Reserved slugs that cannot be used for users/agents
const RESERVED_SLUGS = new Set([
  'auth', 'admin', 'platform', 'id', 'api', 'hook', 
  'static', 'health', 'well-known', 'webhook', 'login',
  'register', 'settings', 'help', 'about', 'docs'
])

export class SlugResolver {
  constructor(private db: D1Database, private kv: KVNamespace) {}

  /**
   * Check if a slug is reserved
   */
  isReservedSlug(slug: string): boolean {
    return RESERVED_SLUGS.has(slug.toLowerCase())
  }

  /**
   * Resolve by slug: /:owner_slug/:agent_slug → ResolvedRoute
   */
  async resolveBySlug(ownerSlug: string, agentSlug: string): Promise<ResolvedRoute | null> {
    const cacheKey = `slug:${ownerSlug}/${agentSlug}`
    
    // 1. Check KV cache first
    const cached = await this.kv.get(cacheKey, 'json')
    if (cached) {
      return cached as ResolvedRoute
    }

    // 2. Query D1: JOIN users + agents
    const result = await this.db
      .prepare(`
        SELECT 
          u.id as owner_id, u.slug as owner_slug, u.short_id as owner_short_id,
          a.id as agent_id, a.slug as agent_slug, a.short_id as agent_short_id
        FROM users u
        JOIN agents a ON a.owner_id = u.id
        WHERE u.slug = ? AND a.slug = ?
      `)
      .bind(ownerSlug, agentSlug)
      .first<{
        owner_id: string
        owner_slug: string
        owner_short_id: string
        agent_id: string
        agent_slug: string
        agent_short_id: string
      }>()

    if (!result) {
      return null
    }

    const resolved: ResolvedRoute = {
      ownerId: result.owner_id,
      ownerSlug: result.owner_slug,
      ownerShortId: result.owner_short_id,
      agentId: result.agent_id,
      agentSlug: result.agent_slug,
      agentShortId: result.agent_short_id
    }

    // 3. Cache result for 1 hour
    await this.kv.put(cacheKey, JSON.stringify(resolved), { expirationTtl: 3600 })

    return resolved
  }

  /**
   * Resolve by short ID: /id/:owner_short_id/:agent_short_id → ResolvedRoute
   */
  async resolveById(ownerShortId: string, agentShortId: string): Promise<ResolvedRoute | null> {
    const cacheKey = `id:${ownerShortId}/${agentShortId}`
    
    // 1. Check KV cache first
    const cached = await this.kv.get(cacheKey, 'json')
    if (cached) {
      return cached as ResolvedRoute
    }

    // 2. Query D1: JOIN users + agents by short_id
    const result = await this.db
      .prepare(`
        SELECT 
          u.id as owner_id, u.slug as owner_slug, u.short_id as owner_short_id,
          a.id as agent_id, a.slug as agent_slug, a.short_id as agent_short_id
        FROM users u
        JOIN agents a ON a.owner_id = u.id
        WHERE u.short_id = ? AND a.short_id = ?
      `)
      .bind(ownerShortId, agentShortId)
      .first<{
        owner_id: string
        owner_slug: string
        owner_short_id: string
        agent_id: string
        agent_slug: string
        agent_short_id: string
      }>()

    if (!result) {
      return null
    }

    const resolved: ResolvedRoute = {
      ownerId: result.owner_id,
      ownerSlug: result.owner_slug,
      ownerShortId: result.owner_short_id,
      agentId: result.agent_id,
      agentSlug: result.agent_slug,
      agentShortId: result.agent_short_id
    }

    // 3. Cache result for 1 hour
    await this.kv.put(cacheKey, JSON.stringify(resolved), { expirationTtl: 3600 })

    return resolved
  }

  /**
   * Check if an old slug should redirect to a new one
   */
  async checkRedirect(entityType: 'user' | 'agent', oldSlug: string): Promise<string | null> {
    const cacheKey = `redirect:${entityType}:${oldSlug}`
    
    // 1. Check KV cache first
    const cached = await this.kv.get(cacheKey)
    if (cached !== null) {
      return cached === '' ? null : cached // Empty string means no redirect
    }

    // 2. Query slug_history for unexpired redirects
    const now = Date.now()
    const result = await this.db
      .prepare(`
        SELECT new_slug 
        FROM slug_history 
        WHERE entity_type = ? AND old_slug = ? AND expires_at > ?
        ORDER BY changed_at DESC 
        LIMIT 1
      `)
      .bind(entityType, oldSlug, now)
      .first<{ new_slug: string }>()

    const newSlug = result?.new_slug || null

    // 3. Cache result (cache null as empty string, with shorter TTL)
    const ttl = newSlug ? 3600 : 300 // 1 hour for redirects, 5 min for no-redirect
    await this.kv.put(cacheKey, newSlug || '', { expirationTtl: ttl })

    return newSlug
  }

  /**
   * Invalidate cache when slug changes
   */
  async invalidateCache(ownerSlug: string, agentSlug: string): Promise<void> {
    await this.kv.delete(`slug:${ownerSlug}/${agentSlug}`)
  }

  /**
   * Invalidate ID cache when short ID changes  
   */
  async invalidateCacheById(ownerShortId: string, agentShortId: string): Promise<void> {
    await this.kv.delete(`id:${ownerShortId}/${agentShortId}`)
  }
}