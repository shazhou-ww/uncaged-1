// Runner pairing API routes
// POST /:owner/:agent/api/v1/runners/pair
// Body: { code, label, os, arch, hostname }
// Returns: { ok, token, ws_url, label }

import type { WorkerEnv } from './index.js'

export async function handleRunnerPair(
  request: Request,
  env: WorkerEnv,
  routingInfo: { ownerId?: string; ownerSlug?: string; agentId?: string; agentSlug?: string },
): Promise<Response> {
  const body = await request.json() as {
    code: string
    label?: string
    os?: string
    arch?: string
    hostname?: string
  }

  if (!body.code) {
    return Response.json({ error: 'code is required' }, { status: 400 })
  }

  // Lookup pairing code in KV
  const pairingRaw = await env.CHAT_KV.get(`pairing:${body.code}`)
  if (!pairingRaw) {
    return Response.json({ error: 'Invalid or expired pairing code' }, { status: 404 })
  }

  const pairing = JSON.parse(pairingRaw) as { agentId: string; label: string | null; createdAt: number }

  // Delete the code (one-time use)
  await env.CHAT_KV.delete(`pairing:${body.code}`)

  // Generate a permanent token
  const token = `rt_${crypto.randomUUID().replace(/-/g, '')}`
  const tokenHash = await sha256(token)
  const label = body.label || pairing.label || body.hostname || 'unnamed'
  const tags = JSON.stringify([body.os, body.arch].filter(Boolean))
  const id = crypto.randomUUID()
  const now = Date.now()

  // Insert into runner_tokens
  await env.MEMORY_DB!.prepare(
    'INSERT INTO runner_tokens (id, agent_id, token_hash, label, tags, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, pairing.agentId, tokenHash, label, tags, now, now).run()

  // Build WebSocket URL
  const wsUrl = `wss://uncaged.shazhou.work/${routingInfo.ownerSlug}/${routingInfo.agentSlug || pairing.agentId}/runner/ws`

  return Response.json({
    ok: true,
    token,
    ws_url: wsUrl,
    label,
  })
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}
