/**
 * Agent Capabilities Configuration Handler — Uncaged Phase 3a
 * 
 * Handles agent-level capability configuration.
 * Routes:
 *   GET  /:owner/:agent/api/v1/capabilities  → list capabilities enabled for this agent
 *   PUT  /:owner/:agent/api/v1/capabilities  → update which capabilities are enabled
 */

import type { WorkerEnv } from './index.js'

interface AgentCapabilitiesResponse {
  agent_id: string
  capabilities: Array<{
    id: string
    slug: string
    display_name?: string
    description?: string
    type: string
    enabled_at: number
  }>
}

interface UpdateAgentCapabilitiesRequest {
  capability_ids: string[]
}

/**
 * Check if user is authorized for agent capability operations
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
 * List capabilities enabled for an agent
 */
async function listAgentCapabilities(
  db: D1Database,
  agentId: string
): Promise<AgentCapabilitiesResponse> {
  const result = await db
    .prepare(`
      SELECT 
        c.id, c.slug, c.display_name, c.description, c.type,
        ac.enabled_at
      FROM agent_capabilities ac
      JOIN capabilities c ON c.id = ac.capability_id
      WHERE ac.agent_id = ?
      ORDER BY ac.enabled_at DESC
    `)
    .bind(agentId)
    .all()
  
  return {
    agent_id: agentId,
    capabilities: result.results?.map((row: any) => ({
      id: row.id,
      slug: row.slug,
      display_name: row.display_name || undefined,
      description: row.description || undefined,
      type: row.type,
      enabled_at: row.enabled_at
    })) || []
  }
}

/**
 * Update capabilities enabled for an agent
 */
async function updateAgentCapabilities(
  db: D1Database,
  agentId: string,
  capabilityIds: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    // Start transaction
    await db.prepare('BEGIN').run()

    // Validate that all capability IDs exist
    if (capabilityIds.length > 0) {
      const placeholders = capabilityIds.map(() => '?').join(',')
      const existingCount = await db
        .prepare(`SELECT COUNT(*) as count FROM capabilities WHERE id IN (${placeholders})`)
        .bind(...capabilityIds)
        .first<{ count: number }>()

      if (!existingCount || existingCount.count !== capabilityIds.length) {
        await db.prepare('ROLLBACK').run()
        return { success: false, error: 'One or more capability IDs do not exist' }
      }
    }

    // Clear existing bindings for this agent
    await db
      .prepare('DELETE FROM agent_capabilities WHERE agent_id = ?')
      .bind(agentId)
      .run()

    // Add new bindings
    const now = Date.now()
    for (const capabilityId of capabilityIds) {
      await db
        .prepare(`
          INSERT INTO agent_capabilities (agent_id, capability_id, enabled_at)
          VALUES (?, ?, ?)
        `)
        .bind(agentId, capabilityId, now)
        .run()
    }

    await db.prepare('COMMIT').run()
    return { success: true }
  } catch (error: any) {
    await db.prepare('ROLLBACK').run()
    console.error('[Agent Capabilities] Transaction error:', error)
    return { success: false, error: `Database error: ${error.message}` }
  }
}

/**
 * Handle agent capabilities routes
 */
export async function handleAgentCapabilitiesRoutes(
  request: Request,
  env: WorkerEnv,
  agentId: string,
): Promise<Response | null> {
  if (!env.MEMORY_DB) {
    return new Response('Database not configured', { status: 500 })
  }

  const url = new URL(request.url)
  const pathParts = url.pathname.split('/').filter(Boolean)

  // Check if this is an agent capabilities route: /:owner/:agent/api/v1/capabilities
  if (pathParts.length >= 4 && 
      pathParts[pathParts.length - 4] === 'api' && 
      pathParts[pathParts.length - 3] === 'v1' && 
      pathParts[pathParts.length - 2] === 'capabilities') {
    
    // Check auth for all operations
    if (!checkAuth(request, env)) {
      return new Response('Unauthorized', { status: 401 })
    }

    try {
      switch (request.method) {
        case 'GET':
          // GET /:owner/:agent/api/v1/capabilities
          const result = await listAgentCapabilities(env.MEMORY_DB, agentId)
          return Response.json(result)

        case 'PUT':
          // PUT /:owner/:agent/api/v1/capabilities
          const updateData = await request.json() as UpdateAgentCapabilitiesRequest
          
          if (!Array.isArray(updateData.capability_ids)) {
            return Response.json({ error: 'capability_ids must be an array' }, { status: 400 })
          }

          const updateResult = await updateAgentCapabilities(
            env.MEMORY_DB, 
            agentId, 
            updateData.capability_ids
          )
          
          if (!updateResult.success) {
            return Response.json({ error: updateResult.error }, { status: 400 })
          }

          // Return updated list
          const updatedResult = await listAgentCapabilities(env.MEMORY_DB, agentId)
          return Response.json(updatedResult)

        default:
          return new Response('Method not allowed', { status: 405 })
      }
    } catch (error: any) {
      console.error('[Agent Capabilities API] Error:', error)
      return Response.json({ error: 'Internal server error' }, { status: 500 })
    }
  }

  return null // Not an agent capabilities route
}