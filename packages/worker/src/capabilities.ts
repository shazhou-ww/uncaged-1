/**
 * Capabilities CRUD API Handler — Uncaged Phase 3a
 * 
 * Handles capability management with ownership and visibility controls.
 * Routes:
 *   GET    /:owner/api/v1/capabilities           → list owner's capabilities
 *   POST   /:owner/api/v1/capabilities           → create new capability
 *   GET    /:owner/api/v1/capabilities/:slug     → get capability detail
 *   PUT    /:owner/api/v1/capabilities/:slug     → update capability
 *   DELETE /:owner/api/v1/capabilities/:slug     → delete capability
 *   GET    /platform/capabilities                → list platform capabilities
 */

import type { WorkerEnv } from './index.js'
import { RESERVED_SLUGS } from './constants.js'

interface CreateCapabilityRequest {
  slug: string
  display_name?: string
  description?: string
  tags?: string[]
  examples?: any[]
  schema?: any
  execute?: string
  code?: string
  type?: 'persistent' | 'normal' | 'ephemeral'
  visibility?: 'platform' | 'private' | 'shared'
  ttl?: number
}

interface UpdateCapabilityRequest {
  display_name?: string
  description?: string
  tags?: string[]
  examples?: any[]
  schema?: any
  execute?: string
  code?: string
  type?: 'persistent' | 'normal' | 'ephemeral'
  visibility?: 'platform' | 'private' | 'shared'
  ttl?: number
}

interface CapabilityResponse {
  id: string
  slug: string
  display_name?: string
  description?: string
  tags?: string[]
  examples?: any[]
  schema?: any
  execute?: string
  code?: string
  type: string
  visibility: string
  ttl?: number
  access_count: number
  last_access?: number
  created_at: number
  updated_at: number
}

interface CapabilitiesListResponse {
  capabilities: CapabilityResponse[]
}

/**
 * Generate UUID v4
 */
function generateUUID(): string {
  return crypto.randomUUID()
}

/**
 * Validate slug format and check against reserved list
 */
function validateSlug(slug: string): { valid: boolean; error?: string } {
  if (!slug || typeof slug !== 'string') {
    return { valid: false, error: 'Slug is required and must be a string' }
  }

  if (slug.length < 3 || slug.length > 64) {
    return { valid: false, error: 'Slug must be 3-64 characters long' }
  }

  if (!/^[a-z0-9-_]+$/.test(slug)) {
    return { valid: false, error: 'Slug must contain only lowercase letters, numbers, hyphens, and underscores' }
  }

  if (slug.startsWith('-') || slug.endsWith('-') || slug.startsWith('_') || slug.endsWith('_')) {
    return { valid: false, error: 'Slug cannot start or end with hyphens or underscores' }
  }

  if (RESERVED_SLUGS.has(slug.toLowerCase())) {
    return { valid: false, error: 'This slug is reserved and cannot be used' }
  }

  return { valid: true }
}

/**
 * Check if user is authorized for capability operations
 */
function checkAuth(request: Request, env: WorkerEnv): boolean {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return false
  }
  const token = authHeader.slice(7)
  return token === env.SIGIL_DEPLOY_TOKEN
}

/**
 * Format capability for API response
 */
function formatCapability(row: any): CapabilityResponse {
  return {
    id: row.id,
    slug: row.slug,
    display_name: row.display_name || undefined,
    description: row.description || undefined,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    examples: row.examples ? JSON.parse(row.examples) : undefined,
    schema: row.schema ? JSON.parse(row.schema) : undefined,
    execute: row.execute || undefined,
    code: row.code || undefined,
    type: row.type,
    visibility: row.visibility,
    ttl: row.ttl || undefined,
    access_count: row.access_count || 0,
    last_access: row.last_access || undefined,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

/**
 * List capabilities for an owner
 */
async function listCapabilities(
  db: D1Database,
  ownerId: string,
  visibility?: string
): Promise<CapabilitiesListResponse> {
  let query = `
    SELECT * FROM capabilities 
    WHERE owner_id = ?
  `
  const params: any[] = [ownerId]

  if (visibility) {
    query += ` AND visibility = ?`
    params.push(visibility)
  }

  query += ` ORDER BY created_at DESC`

  const result = await db.prepare(query).bind(...params).all()
  
  return {
    capabilities: result.results?.map(formatCapability) || []
  }
}

/**
 * List platform capabilities (no auth required)
 */
async function listPlatformCapabilities(db: D1Database): Promise<CapabilitiesListResponse> {
  const result = await db
    .prepare(`
      SELECT * FROM capabilities 
      WHERE owner_id = '__platform__' AND visibility = 'platform'
      ORDER BY created_at DESC
    `)
    .all()
  
  return {
    capabilities: result.results?.map(formatCapability) || []
  }
}

/**
 * Get a single capability by slug
 */
async function getCapability(
  db: D1Database,
  ownerId: string,
  slug: string
): Promise<CapabilityResponse | null> {
  const result = await db
    .prepare(`SELECT * FROM capabilities WHERE owner_id = ? AND slug = ?`)
    .bind(ownerId, slug)
    .first()

  return result ? formatCapability(result) : null
}

/**
 * Create a new capability
 */
async function createCapability(
  db: D1Database,
  ownerId: string,
  data: CreateCapabilityRequest
): Promise<{ success: boolean; capability?: CapabilityResponse; error?: string }> {
  // Validate slug
  const slugValidation = validateSlug(data.slug)
  if (!slugValidation.valid) {
    return { success: false, error: slugValidation.error }
  }

  // Check for existing capability with same slug
  const existing = await db
    .prepare(`SELECT id FROM capabilities WHERE owner_id = ? AND slug = ?`)
    .bind(ownerId, data.slug)
    .first()

  if (existing) {
    return { success: false, error: 'A capability with this slug already exists' }
  }

  // Validate that either code or execute is provided, but not both
  if (data.code && data.execute) {
    return { success: false, error: 'Cannot specify both code and execute - choose one approach' }
  }

  if (!data.code && !data.execute) {
    return { success: false, error: 'Must specify either code (full Worker) or execute (function body)' }
  }

  const now = Date.now()
  const id = generateUUID()

  try {
    const result = await db
      .prepare(`
        INSERT INTO capabilities (
          id, owner_id, slug, display_name, description, tags, examples, 
          schema, execute, code, type, visibility, ttl, access_count, 
          last_access, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        id, ownerId, data.slug,
        data.display_name || null,
        data.description || null,
        data.tags ? JSON.stringify(data.tags) : null,
        data.examples ? JSON.stringify(data.examples) : null,
        data.schema ? JSON.stringify(data.schema) : null,
        data.execute || null,
        data.code || null,
        data.type || 'normal',
        data.visibility || 'private',
        data.ttl || null,
        0, // access_count
        null, // last_access
        now, // created_at
        now  // updated_at
      )
      .run()

    if (!result.success) {
      return { success: false, error: 'Failed to create capability' }
    }

    // Fetch the created capability
    const created = await db
      .prepare(`SELECT * FROM capabilities WHERE id = ?`)
      .bind(id)
      .first()

    return {
      success: true,
      capability: created ? formatCapability(created) : undefined
    }
  } catch (error: any) {
    return { success: false, error: `Database error: ${error.message}` }
  }
}

/**
 * Update an existing capability
 */
async function updateCapability(
  db: D1Database,
  ownerId: string,
  slug: string,
  data: UpdateCapabilityRequest
): Promise<{ success: boolean; capability?: CapabilityResponse; error?: string }> {
  // Check if capability exists and is owned by user
  const existing = await db
    .prepare(`SELECT * FROM capabilities WHERE owner_id = ? AND slug = ?`)
    .bind(ownerId, slug)
    .first()

  if (!existing) {
    return { success: false, error: 'Capability not found' }
  }

  // Validate that code/execute update makes sense
  if (data.code && data.execute) {
    return { success: false, error: 'Cannot specify both code and execute - choose one approach' }
  }

  const updates: string[] = []
  const params: any[] = []

  if (data.display_name !== undefined) {
    updates.push('display_name = ?')
    params.push(data.display_name || null)
  }

  if (data.description !== undefined) {
    updates.push('description = ?')
    params.push(data.description || null)
  }

  if (data.tags !== undefined) {
    updates.push('tags = ?')
    params.push(data.tags ? JSON.stringify(data.tags) : null)
  }

  if (data.examples !== undefined) {
    updates.push('examples = ?')
    params.push(data.examples ? JSON.stringify(data.examples) : null)
  }

  if (data.schema !== undefined) {
    updates.push('schema = ?')
    params.push(data.schema ? JSON.stringify(data.schema) : null)
  }

  if (data.execute !== undefined) {
    updates.push('execute = ?')
    params.push(data.execute || null)
    // Clear code if setting execute
    updates.push('code = ?')
    params.push(null)
  }

  if (data.code !== undefined) {
    updates.push('code = ?')
    params.push(data.code || null)
    // Clear execute if setting code
    updates.push('execute = ?')
    params.push(null)
  }

  if (data.type !== undefined) {
    updates.push('type = ?')
    params.push(data.type)
  }

  if (data.visibility !== undefined) {
    updates.push('visibility = ?')
    params.push(data.visibility)
  }

  if (data.ttl !== undefined) {
    updates.push('ttl = ?')
    params.push(data.ttl || null)
  }

  if (updates.length === 0) {
    return { success: false, error: 'No fields to update' }
  }

  // Always update the timestamp
  updates.push('updated_at = ?')
  params.push(Date.now())

  // Add WHERE clause params
  params.push(ownerId, slug)

  try {
    const result = await db
      .prepare(`
        UPDATE capabilities 
        SET ${updates.join(', ')}
        WHERE owner_id = ? AND slug = ?
      `)
      .bind(...params)
      .run()

    if (!result.success) {
      return { success: false, error: 'Failed to update capability' }
    }

    // Fetch the updated capability
    const updated = await db
      .prepare(`SELECT * FROM capabilities WHERE owner_id = ? AND slug = ?`)
      .bind(ownerId, slug)
      .first()

    return {
      success: true,
      capability: updated ? formatCapability(updated) : undefined
    }
  } catch (error: any) {
    return { success: false, error: `Database error: ${error.message}` }
  }
}

/**
 * Delete a capability
 */
async function deleteCapability(
  db: D1Database,
  ownerId: string,
  slug: string
): Promise<{ success: boolean; error?: string }> {
  // Check if capability exists and is owned by user
  const existing = await db
    .prepare(`SELECT id FROM capabilities WHERE owner_id = ? AND slug = ?`)
    .bind(ownerId, slug)
    .first()

  if (!existing) {
    return { success: false, error: 'Capability not found' }
  }

  try {
    // First delete agent_capabilities bindings
    await db
      .prepare(`DELETE FROM agent_capabilities WHERE capability_id = ?`)
      .bind(existing.id)
      .run()

    // Then delete the capability
    const result = await db
      .prepare(`DELETE FROM capabilities WHERE owner_id = ? AND slug = ?`)
      .bind(ownerId, slug)
      .run()

    return { success: result.success }
  } catch (error: any) {
    return { success: false, error: `Database error: ${error.message}` }
  }
}

/**
 * Main capabilities route handler
 */
export async function handleCapabilitiesRoutes(
  request: Request,
  env: WorkerEnv,
  ownerSlug: string,
  ownerId: string,
): Promise<Response | null> {
  if (!env.MEMORY_DB) {
    return new Response('Database not configured', { status: 500 })
  }

  const url = new URL(request.url)
  const pathParts = url.pathname.split('/').filter(Boolean)

  // Handle platform capabilities route: /platform/capabilities
  if (ownerSlug === 'platform' && pathParts[1] === 'capabilities') {
    if (request.method === 'GET') {
      try {
        const result = await listPlatformCapabilities(env.MEMORY_DB)
        return Response.json(result)
      } catch (error: any) {
        return Response.json({ error: error.message }, { status: 500 })
      }
    }
    return new Response('Method not allowed', { status: 405 })
  }

  // Handle owner capabilities routes: /:owner/api/v1/capabilities/...
  if (pathParts[1] === 'api' && pathParts[2] === 'v1' && pathParts[3] === 'capabilities') {
    const slug = pathParts[4] // Optional capability slug

    // Check auth for all non-GET operations on specific capabilities
    if (request.method !== 'GET' || slug) {
      if (!checkAuth(request, env)) {
        return new Response('Unauthorized', { status: 401 })
      }
    }

    try {
      switch (request.method) {
        case 'GET':
          if (slug) {
            // GET /:owner/api/v1/capabilities/:slug
            const capability = await getCapability(env.MEMORY_DB, ownerId, slug)
            if (!capability) {
              return new Response('Capability not found', { status: 404 })
            }
            return Response.json({ capability })
          } else {
            // GET /:owner/api/v1/capabilities
            const visibility = url.searchParams.get('visibility') || undefined
            const result = await listCapabilities(env.MEMORY_DB, ownerId, visibility)
            return Response.json(result)
          }

        case 'POST':
          if (slug) {
            return new Response('Method not allowed', { status: 405 })
          }
          // POST /:owner/api/v1/capabilities
          const createData = await request.json() as CreateCapabilityRequest
          const createResult = await createCapability(env.MEMORY_DB, ownerId, createData)
          
          if (!createResult.success) {
            return Response.json({ error: createResult.error }, { status: 400 })
          }
          return Response.json({ capability: createResult.capability }, { status: 201 })

        case 'PUT':
          if (!slug) {
            return new Response('Capability slug required', { status: 400 })
          }
          // PUT /:owner/api/v1/capabilities/:slug
          const updateData = await request.json() as UpdateCapabilityRequest
          const updateResult = await updateCapability(env.MEMORY_DB, ownerId, slug, updateData)
          
          if (!updateResult.success) {
            const status = updateResult.error === 'Capability not found' ? 404 : 400
            return Response.json({ error: updateResult.error }, { status })
          }
          return Response.json({ capability: updateResult.capability })

        case 'DELETE':
          if (!slug) {
            return new Response('Capability slug required', { status: 400 })
          }
          // DELETE /:owner/api/v1/capabilities/:slug
          const deleteResult = await deleteCapability(env.MEMORY_DB, ownerId, slug)
          
          if (!deleteResult.success) {
            const status = deleteResult.error === 'Capability not found' ? 404 : 400
            return Response.json({ error: deleteResult.error }, { status })
          }
          return new Response('', { status: 204 })

        default:
          return new Response('Method not allowed', { status: 405 })
      }
    } catch (error: any) {
      console.error('[Capabilities API] Error:', error)
      return Response.json({ error: 'Internal server error' }, { status: 500 })
    }
  }

  return null // Not a capabilities route
}