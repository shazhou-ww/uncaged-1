// Sigil execution routes for capability deployment and invocation
// Phase 3b: Merge Sigil engine into Uncaged Worker

import { WorkerPool, type WorkerLoader } from '@uncaged/core/sigil/worker-pool'
import { EmbeddingService } from '@uncaged/core/sigil/embedding'
import type { DeployParams, DeployResult, QueryParams, QueryResult } from '@uncaged/core/sigil/types'
import type { WorkerEnv } from './index.js'

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
    if (ctx.env.MEMORY_DB && result.capability) {
      try {
        await ctx.env.MEMORY_DB.prepare(`
          INSERT OR REPLACE INTO capabilities (
            owner_id, slug, name, description, 
            input_schema, example_input, example_output,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `).bind(
          ctx.ownerSlug,
          result.capability, 
          deployParams.name || result.capability,
          deployParams.description || '',
          JSON.stringify(deployParams.schema || {}),
          JSON.stringify(deployParams.examples?.[0] || {}),
          JSON.stringify({})  // No example_output in DeployParams
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
  try {
    const workerPool = createWorkerPool(ctx.env)
    if (!workerPool) {
      return new Response('Sigil execution engine not configured', { status: 503 })
    }

    const query = url.searchParams.get('q') || ''
    const limit = parseInt(url.searchParams.get('limit') || '10')

    const queryParams: QueryParams = {
      q: query,
      limit: Math.min(limit, 50), // Cap at 50
      mode: 'find'
    }

    const result: QueryResult = await workerPool.query(queryParams)

    // Enhance with D1 data if available (ownership, metadata, etc.)
    if (ctx.env.MEMORY_DB && result.items) {
      try {
        const slugs = result.items.map(item => item.capability)
        if (slugs.length > 0) {
          const placeholders = slugs.map(() => '?').join(',')
          const d1Results = await ctx.env.MEMORY_DB.prepare(`
            SELECT slug, name, description, created_at, updated_at
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