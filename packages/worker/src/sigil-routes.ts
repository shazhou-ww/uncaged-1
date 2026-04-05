// Sigil execution routes for capability deployment and invocation
// Phase 3b: Merge Sigil engine into Uncaged Worker

import { WorkerPool, type WorkerLoader } from '@uncaged/core/sigil/worker-pool'
import { EmbeddingService } from '@uncaged/core/sigil/embedding'
import type { DeployParams, DeployResult, QueryParams, QueryResult } from '@uncaged/core/sigil/types'
import type { WorkerEnv } from './index.js'
import { SlugResolver } from './slug-resolver.js'

export interface SigilRouteContext {
  env: WorkerEnv
  ownerSlug: string
  agentSlug?: string
}

/** Initialize WorkerPool if Sigil bindings are available */
function createWorkerPool(env: WorkerEnv): WorkerPool | null {
  if (!env.SIGIL_KV || !env.LOADER || !env.AI) {
    console.warn('[Sigil] Missing required bindings: SIGIL_KV, LOADER, or AI')
    return null
  }
  
  const embeddingService = new EmbeddingService(env.AI, env.SIGIL_KV)
  return new WorkerPool(env.SIGIL_KV, env.LOADER as WorkerLoader, embeddingService)
}

/** 
 * Handle capability deployment
 * POST /:owner/api/v1/capabilities/deploy
 */
export async function handleCapabilityDeploy(
  ctx: SigilRouteContext,
  request: Request
): Promise<Response> {
  try {
    const workerPool = createWorkerPool(ctx.env)
    if (!workerPool) {
      return new Response('Sigil execution engine not configured', { status: 503 })
    }

    const deployParams: DeployParams = await request.json()
    
    // Add owner context to the deployment via description and tags
    const enhancedParams: DeployParams = {
      ...deployParams,
      description: deployParams.description || '',
      tags: [...(deployParams.tags || []), `owner:${ctx.ownerSlug}`, `deployed:${Date.now()}`]
    }

    const result: DeployResult = await workerPool.deploy(enhancedParams)

    // Dual-write: Also store/update in D1 capabilities table
    if (ctx.env.MEMORY_DB && result.capability && ctx.env.CHAT_KV) {
      try {
        // Import SlugResolver to resolve owner_id
        const { SlugResolver } = await import('./slug-resolver.js')
        const slugResolver = new SlugResolver(ctx.env.MEMORY_DB, ctx.env.CHAT_KV)
        
        // Resolve owner_id from owner_slug
        const ownerInfo = await slugResolver.resolveOwnerBySlug(ctx.ownerSlug)
        if (!ownerInfo) {
          console.warn(`[Sigil] Failed to resolve owner_id for slug: ${ctx.ownerSlug}`)
          throw new Error(`Owner not found: ${ctx.ownerSlug}`)
        }

        // Generate UUID for capability id (or reuse if re-deploying)
        let capabilityId = crypto.randomUUID()
        let createdAt = Date.now()
        
        // First, try to find existing capability by owner_id + slug
        const existing = await ctx.env.MEMORY_DB.prepare(`
          SELECT id, created_at FROM capabilities WHERE owner_id = ? AND slug = ?
        `).bind(ownerInfo.ownerId, result.capability).first<{ id: string; created_at: number }>()
        
        if (existing) {
          capabilityId = existing.id
          createdAt = existing.created_at
        }

        await ctx.env.MEMORY_DB.prepare(`
          INSERT OR REPLACE INTO capabilities (
            id, owner_id, slug, display_name, description, tags, examples, schema,
            execute, code, type, visibility, ttl, access_count, last_access,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          capabilityId,                                           // id: UUID (reuse if re-deploying)
          ownerInfo.ownerId,                                      // owner_id: resolve from owner slug
          result.capability,                                      // slug: capability name from deploy result
          deployParams.name || deployParams.description || result.capability, // display_name: from deploy params
          deployParams.description || '',                        // description: from deploy params
          JSON.stringify(deployParams.tags || []),               // tags: JSON.stringify(tags array)
          JSON.stringify(deployParams.examples || []),           // examples: JSON.stringify(examples array)
          JSON.stringify(deployParams.schema || {}),             // schema: JSON.stringify(schema object)
          deployParams.execute || null,                          // execute: from deploy params
          deployParams.code || null,                             // code: from deploy params (if code mode)
          deployParams.type || 'normal',                         // type: from deploy params
          'private',                                             // visibility: 'private' (default for user-deployed)
          deployParams.ttl || null,                              // ttl: from deploy params
          0,                                                     // access_count: 0
          null,                                                  // last_access: null
          createdAt,                                             // created_at: preserve if re-deploying
          Date.now()                                             // updated_at: Date.now()
        ).run()
        
        console.log(`[Sigil] Synced capability ${result.capability} to D1`)
      } catch (d1Error) {
        console.warn('[Sigil] Failed to sync to D1:', d1Error)
        // Don't fail the deployment, KV storage is primary
      }
    }

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('[Sigil Deploy]', error)
    return new Response(JSON.stringify({ 
      capability: null, 
      url: '', 
      error: error instanceof Error ? error.message : 'Unknown error'
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

/**
 * Handle capability invocation
 * POST /:owner/:agent/run/:capability
 */
export async function handleCapabilityInvoke(
  ctx: SigilRouteContext,
  capabilitySlug: string,
  request: Request
): Promise<Response> {
  try {
    const workerPool = createWorkerPool(ctx.env)
    if (!workerPool) {
      return new Response('Sigil execution engine not configured', { status: 503 })
    }

    // Parse input parameters
    const inputData = await request.json()

    // Basic permission check: ensure capability belongs to the owner
    // In a more sophisticated setup, we'd check agent-specific permissions
    const capability = await workerPool.inspect(capabilitySlug)
    if (!capability) {
      return new Response(JSON.stringify({ 
        error: 'Capability not found' 
      }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Check ownership via tags (stored in deployment)
    const ownerTag = `owner:${ctx.ownerSlug}`
    if (capability.tags && !capability.tags.includes(ownerTag)) {
      return new Response(JSON.stringify({ 
        error: 'Access denied' 
      }), { 
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Invoke the capability
    const invokeRequest = new Request('https://internal/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputData)
    })
    
    const result = await workerPool.invoke(capabilitySlug, invokeRequest)

    return result  // WorkerPool.invoke already returns a Response

  } catch (error) {
    console.error('[Sigil Invoke]', error)
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error'
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

/**
 * Handle capability query (semantic search)
 * GET /:owner/api/v1/capabilities/query?q=...
 */
export async function handleCapabilityQuery(
  ctx: SigilRouteContext,
  url: URL
): Promise<Response> {
  const query = url.searchParams.get('q') || undefined
  const limit = parseInt(url.searchParams.get('limit') || '20')
  const cappedLimit = Math.min(limit, 50)

  // If no search query, list from D1 (more reliable than KV list)
  if (!query) {
    return handleFullListing(ctx, cappedLimit)
  }

  // With search query, use WorkerPool for semantic search
  try {
    const workerPool = createWorkerPool(ctx.env)
    if (!workerPool) {
      return new Response('Sigil execution engine not configured', { status: 503 })
    }

    const queryParams: QueryParams = {
      q: query,
      limit: cappedLimit,
    }

    const result: QueryResult = await workerPool.query(queryParams)

    // Enhance with D1 data if available (ownership, metadata, etc.)
    if (ctx.env.MEMORY_DB && result.items) {
      try {
        const slugs = result.items.map(item => item.capability)
        if (slugs.length > 0) {
          const placeholders = slugs.map(() => '?').join(',')
          const d1Results = await ctx.env.MEMORY_DB.prepare(`
            SELECT slug, display_name, description, created_at, updated_at
            FROM capabilities 
            WHERE owner_id = ? AND slug IN (${placeholders})
          `).bind(ctx.ownerSlug, ...slugs).all()

          // Merge D1 metadata into KV results
          const d1Map = new Map(d1Results.results?.map(row => [row.slug, row]) || [])
          result.items = result.items.map(item => ({
            ...item,
            d1_metadata: d1Map.get(item.capability) || null
          }))
        }
      } catch (d1Error) {
        console.warn('[Sigil Query] Failed to enhance with D1 data:', d1Error)
        // Continue with KV-only results
      }
    }

    // Filter by owner based on tags
    if (result.items) {
      const ownerTag = `owner:${ctx.ownerSlug}`
      result.items = result.items.filter(item => 
        item.tags && item.tags.includes(ownerTag)
      )
      result.total = result.items.length
    }

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('[Sigil Query]', error)
    return new Response(JSON.stringify({ 
      total: 0,
      items: [],
      error: error instanceof Error ? error.message : 'Unknown error'
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

/**
 * Handle capability search (for frontend Tool search overlay)
 * GET /:owner/api/v1/capabilities/search?q=...&limit=5&user_invocable=true
 */
export async function handleCapabilitySearch(
  ctx: SigilRouteContext,
  url: URL
): Promise<Response> {
  try {
    const query = url.searchParams.get('q') || ''
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '5'), 20)
    
    if (!query.trim()) {
      return Response.json({ results: [] })
    }

    const results: Array<{
      slug: string
      display_name: string
      description: string
      icon: string
      category: string
      schema: any
    }> = []

    // Primary: D1 text search
    if (ctx.env.MEMORY_DB) {
      const likeQuery = `%${query}%`
      const d1Results = await ctx.env.MEMORY_DB.prepare(`
        SELECT slug, display_name, description, tags, schema, type, visibility
        FROM capabilities
        WHERE owner_id = ?
          AND (
            slug LIKE ? COLLATE NOCASE
            OR display_name LIKE ? COLLATE NOCASE
            OR description LIKE ? COLLATE NOCASE
            OR tags LIKE ? COLLATE NOCASE
          )
        ORDER BY access_count DESC, updated_at DESC
        LIMIT ?
      `).bind(ctx.ownerSlug, likeQuery, likeQuery, likeQuery, likeQuery, limit).all()

      for (const row of (d1Results.results || [])) {
        let tags: string[] = []
        try { tags = row.tags ? JSON.parse(row.tags as string) : [] } catch {}
        
        let schema: any = null
        try { schema = row.schema ? JSON.parse(row.schema as string) : null } catch {}

        results.push({
          slug: row.slug as string,
          display_name: (row.display_name as string) || (row.slug as string),
          description: (row.description as string) || '',
          icon: '🔧',
          category: tags.find((t: string) => t.startsWith('category:'))?.slice(9) || 'general',
          schema,
        })
      }
    }

    // Enhancement: If D1 returned few results and Sigil semantic search is available
    if (results.length < limit) {
      const workerPool = createWorkerPool(ctx.env)
      if (workerPool) {
        try {
          const semanticResults = await workerPool.query({
            q: query,
            limit: limit - results.length,
            mode: 'find',
          })

          const existingSlugs = new Set(results.map(r => r.slug))
          for (const item of (semanticResults.items || [])) {
            if (existingSlugs.has(item.capability)) continue
            const ownerTag = `owner:${ctx.ownerSlug}`
            if (item.tags && !item.tags.includes(ownerTag)) continue

            results.push({
              slug: item.capability,
              display_name: item.capability,
              description: item.description || '',
              icon: '🔧',
              category: 'general',
              schema: item.schema || null,
            })
          }
        } catch (e) {
          console.warn('[Capability Search] Semantic search failed:', e)
        }
      }
    }

    return Response.json({ results: results.slice(0, limit) })
  } catch (error) {
    console.error('[Capability Search]', error)
    return Response.json({ results: [], error: 'Search failed' }, { status: 500 })
  }
}

/**
 * Handle direct tool invocation by user (not via LLM)
 * POST /:owner/:agent/api/v1/tools/:slug/invoke
 * Body: { "args": { ... } }
 */
export async function handleToolInvoke(
  ctx: SigilRouteContext,
  toolSlug: string,
  request: Request
): Promise<Response> {
  try {
    const body = await request.json() as { args?: Record<string, any> }
    const args = body.args || {}

    const workerPool = createWorkerPool(ctx.env)
    if (workerPool) {
      const capability = await workerPool.inspect(toolSlug)
      if (!capability) {
        return Response.json({ success: false, error: 'Tool not found' }, { status: 404 })
      }

      const ownerTag = `owner:${ctx.ownerSlug}`
      if (capability.tags && !capability.tags.includes(ownerTag)) {
        return Response.json({ success: false, error: 'Access denied' }, { status: 403 })
      }

      const invokeRequest = new Request('https://internal/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      })

      const result = await workerPool.invoke(toolSlug, invokeRequest)
      const resultBody = await result.text()

      let parsedResult: any
      try { parsedResult = JSON.parse(resultBody) } catch { parsedResult = resultBody }

      // Update access count
      if (ctx.env.MEMORY_DB) {
        ctx.env.MEMORY_DB.prepare(
          `UPDATE capabilities SET access_count = access_count + 1, last_access = ? WHERE owner_id = ? AND slug = ?`
        ).bind(Date.now(), ctx.ownerSlug, toolSlug).run().catch(() => {})
      }

      return Response.json({
        success: result.status >= 200 && result.status < 300,
        result: parsedResult,
      })
    }

    // Fallback: check D1 for existence
    if (ctx.env.MEMORY_DB) {
      const cap = await ctx.env.MEMORY_DB.prepare(
        `SELECT slug FROM capabilities WHERE owner_id = ? AND slug = ?`
      ).bind(ctx.ownerSlug, toolSlug).first()

      if (!cap) {
        return Response.json({ success: false, error: 'Tool not found' }, { status: 404 })
      }

      return Response.json({
        success: false,
        error: 'Sigil execution engine not available',
      }, { status: 503 })
    }

    return Response.json({ success: false, error: 'No execution backend configured' }, { status: 503 })
  } catch (error) {
    console.error('[Tool Invoke]', error)
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 })
  }
}

async function handleFullListing(ctx: SigilRouteContext, limit: number): Promise<Response> {
  if (!ctx.env.MEMORY_DB) {
    return new Response(JSON.stringify({ total: 0, items: [] }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Query D1 capabilities table, filtered by owner
  // For now, show all capabilities (platform + owner's)
  // owner_id comes from resolving the ownerSlug
  const slugResolver = new SlugResolver(ctx.env.MEMORY_DB, ctx.env.CHAT_KV!)
  const owner = await slugResolver.resolveOwnerBySlug(ctx.ownerSlug)
  
  let results
  if (owner) {
    // Show owner's capabilities + platform capabilities
    results = await ctx.env.MEMORY_DB.prepare(`
      SELECT id, slug, display_name, description, tags, type, visibility, access_count, created_at
      FROM capabilities
      WHERE owner_id = ? OR owner_id = '__platform__'
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(owner.ownerId, limit).all()
  } else {
    // Unknown owner — only platform capabilities
    results = await ctx.env.MEMORY_DB.prepare(`
      SELECT id, slug, display_name, description, tags, type, visibility, access_count, created_at
      FROM capabilities
      WHERE owner_id = '__platform__'
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(limit).all()
  }

  const items = (results.results || []).map((row: any) => ({
    capability: row.slug,
    description: row.description || row.display_name || undefined,
    tags: row.tags ? tryParseJson(row.tags) : undefined,
    type: row.type,
    score: 1.0,
    access_count: row.access_count || 0,
  }))

  return new Response(JSON.stringify({ total: items.length, items }), {
    headers: { 'Content-Type': 'application/json' }
  })
}

function tryParseJson(s: string): any {
  try { return JSON.parse(s) } catch { return undefined }
}

/**
 * Handle capability inspection
 * GET /:owner/api/v1/capabilities/:slug/inspect
 */
export async function handleCapabilityInspect(
  ctx: SigilRouteContext,
  capabilitySlug: string
): Promise<Response> {
  try {
    const workerPool = createWorkerPool(ctx.env)
    if (!workerPool) {
      return new Response('Sigil execution engine not configured', { status: 503 })
    }

    const capability = await workerPool.inspect(capabilitySlug)
    if (!capability) {
      return new Response(JSON.stringify({ 
        error: 'Capability not found' 
      }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Check ownership via tags
    const ownerTag = `owner:${ctx.ownerSlug}`
    if (capability.tags && !capability.tags.includes(ownerTag)) {
      return new Response(JSON.stringify({ 
        error: 'Access denied' 
      }), { 
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Get detailed inspection info
    const inspection = await workerPool.inspect(capabilitySlug)

    return new Response(JSON.stringify(inspection), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('[Sigil Inspect]', error)
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error'
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}