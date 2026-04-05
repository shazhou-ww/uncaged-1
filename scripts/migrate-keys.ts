/**
 * Migration helper for multi-tenant key format transition (Issue #21).
 *
 * Generates and optionally executes migration from old to new key formats.
 * Handles both D1 (memories table chat_id) and KV (chat history keys).
 *
 * Usage in a Cloudflare Worker context:
 *   import { generateMigrationPlan, executeMigration } from './migrate-keys'
 *   const plan = await generateMigrationPlan(env.MEMORY_DB, env.CHAT_KV)
 *   console.log(plan.sql)                    // review SQL
 *   console.log(plan.memoryUpdates)           // review D1 changes
 *   console.log(plan.kvMigrations)            // review KV changes
 *   const result = await executeMigration(env.MEMORY_DB, env.CHAT_KV, plan)
 */

import { parseLegacyChatKey, parseLegacyMemorySession } from '@uncaged/core/chat-key'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryUpdate {
  instanceId: string
  oldChatId: string
  newChatId: string
  userId: string
}

export interface KvMigration {
  oldKey: string
  newKey: string
}

export interface MigrationPlan {
  /** D1 memories table updates */
  memoryUpdates: MemoryUpdate[]
  /** KV chat-history key renames */
  kvMigrations: KvMigration[]
  /** Human-readable SQL that would be executed */
  sql: string
  /** Session tags that could not be mapped to a user */
  unmapped: Array<{ instanceId: string; chatId: string; reason: string }>
}

export interface MigrationResult {
  success: number
  failed: number
  errors: string[]
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Look up the unified userId for a credential.
 *
 * Queries the `credentials` table which is expected to have:
 *   user_id, type ('telegram' | 'google' | ...), external_id
 * Falls back to matching display_name from the `users` table.
 */
async function resolveUserId(
  db: D1Database,
  type: string,
  identifier: string,
): Promise<string | null> {
  // Try exact external_id match first
  const byExternalId = await db
    .prepare(
      `SELECT user_id FROM credentials WHERE type = ? AND external_id = ? LIMIT 1`,
    )
    .bind(type, identifier)
    .first<{ user_id: string }>()

  if (byExternalId) return byExternalId.user_id

  // Fallback: try display_name match (for "telegram:Scott" where "Scott" is the display name)
  const byName = await db
    .prepare(
      `SELECT c.user_id FROM credentials c JOIN users u ON u.id = c.user_id WHERE c.type = ? AND u.display_name = ? LIMIT 1`,
    )
    .bind(type, identifier)
    .first<{ user_id: string }>()

  if (byName) return byName.user_id

  // Last resort: name-only lookup across all credential types
  const byAnyName = await db
    .prepare(
      `SELECT c.user_id FROM credentials c JOIN users u ON u.id = c.user_id WHERE u.display_name = ? LIMIT 1`,
    )
    .bind(identifier)
    .first<{ user_id: string }>()

  return byAnyName?.user_id ?? null
}

// ---------------------------------------------------------------------------
// Plan generation
// ---------------------------------------------------------------------------

export async function generateMigrationPlan(
  db: D1Database,
  kv: KVNamespace,
): Promise<MigrationPlan> {
  const memoryUpdates: MemoryUpdate[] = []
  const kvMigrations: KvMigration[] = []
  const unmapped: MigrationPlan['unmapped'] = []
  const sqlStatements: string[] = [
    '-- Auto-generated migration SQL',
    `-- Generated at ${new Date().toISOString()}`,
    '',
    'BEGIN TRANSACTION;',
    '',
  ]

  // ─── 1. D1 memories table ─────────────────────────────────────────────

  const distinctSessions = await db
    .prepare(
      `SELECT DISTINCT instance_id, chat_id FROM memories ORDER BY instance_id`,
    )
    .all<{ instance_id: string; chat_id: string }>()

  for (const row of distinctSessions.results ?? []) {
    const { instance_id: instanceId, chat_id: chatId } = row

    // Already migrated?
    if (chatId.startsWith('user:')) continue

    const parsed = parseLegacyMemorySession(chatId)
    if (!parsed) {
      unmapped.push({ instanceId, chatId, reason: 'unrecognized format' })
      continue
    }

    // Determine credential type for lookup
    let credType: string
    let lookupId: string

    switch (parsed.type) {
      case 'telegram':
        credType = 'telegram'
        lookupId = parsed.name
        break
      case 'instance':
        // "{instanceId}:{name}" — try telegram first, then any
        credType = 'telegram'
        lookupId = parsed.name
        break
      case 'unified':
        // Already in unified format (shouldn't reach here due to startsWith check above)
        continue
      default:
        unmapped.push({ instanceId, chatId, reason: `unknown session type: ${parsed.type}` })
        continue
    }

    const userId = await resolveUserId(db, credType, lookupId)

    if (!userId) {
      unmapped.push({ instanceId, chatId, reason: `no credential found for ${credType}:${lookupId}` })
      continue
    }

    const newChatId = `user:${userId}`

    memoryUpdates.push({ instanceId, oldChatId: chatId, newChatId, userId })

    sqlStatements.push(
      `UPDATE memories SET chat_id = '${newChatId}' WHERE instance_id = '${instanceId}' AND chat_id = '${chatId}';`,
    )
  }

  // ─── 2. KV chat history keys ──────────────────────────────────────────

  // List all KV keys with the "chat:" prefix
  let cursor: string | undefined
  const kvKeys: string[] = []

  do {
    const list = await kv.list({ prefix: 'chat:', cursor, limit: 1000 })
    for (const key of list.keys) {
      kvKeys.push(key.name)
    }
    cursor = list.list_complete ? undefined : list.cursor
  } while (cursor)

  for (const fullKey of kvKeys) {
    // fullKey = "chat:{chatId}"
    const chatId = fullKey.slice(5) // remove "chat:" prefix

    // Already migrated? (contains two colons → "chat:{agentId}:{userId}")
    // Heuristic: if it already has the unified format, skip
    const colonCount = chatId.split(':').length - 1
    if (colonCount >= 2) continue // likely already "agentId:userId"

    const parsed = parseLegacyChatKey(chatId)
    if (!parsed) {
      // Could be a non-standard key — skip
      continue
    }

    // For KV migration we need both agentId and userId.
    // agentId = instanceId from the D1 distinct sessions scan
    // userId = resolved from credentials

    let userId: string | null = null
    let agentId: string | null = null

    switch (parsed.type) {
      case 'telegram': {
        // Legacy telegram chat key is just a numeric id
        // Look up credential by external_id (the telegram numeric id)
        const cred = await db
          .prepare(
            `SELECT user_id FROM credentials WHERE type = 'telegram' AND external_id = ? LIMIT 1`,
          )
          .bind(parsed.externalId)
          .first<{ user_id: string }>()
        userId = cred?.user_id ?? null

        // Find which instance this chat belongs to — check memories table
        if (userId) {
          // Try matching by the telegram numeric id as chat_id in memories
          const mem = await db
            .prepare(
              `SELECT DISTINCT instance_id FROM memories WHERE chat_id = ? OR chat_id LIKE ? LIMIT 1`,
            )
            .bind(parsed.externalId, `telegram:%`)
            .first<{ instance_id: string }>()
          agentId = mem?.instance_id ?? null
        }
        break
      }

      case 'web': {
        // "web:email@example.com"
        const cred = await db
          .prepare(
            `SELECT user_id FROM credentials WHERE type = 'google' AND external_id = ? LIMIT 1`,
          )
          .bind(parsed.externalId)
          .first<{ user_id: string }>()
        userId = cred?.user_id ?? null

        if (userId) {
          const mem = await db
            .prepare(
              `SELECT DISTINCT instance_id FROM memories WHERE chat_id LIKE 'web:%' LIMIT 1`,
            )
            .first<{ instance_id: string }>()
          agentId = mem?.instance_id ?? null
        }
        break
      }

      case 'api': {
        // "api" key — skip, this is a shared/anonymous endpoint
        continue
      }
    }

    if (userId && agentId) {
      const newKey = `chat:${agentId}:${userId}`
      kvMigrations.push({ oldKey: fullKey, newKey })
    }
  }

  // ─── 3. Finalize SQL ──────────────────────────────────────────────────

  sqlStatements.push('')
  sqlStatements.push('COMMIT;')

  if (unmapped.length > 0) {
    sqlStatements.push('')
    sqlStatements.push('-- ⚠️  Unmapped session tags (need manual resolution):')
    for (const u of unmapped) {
      sqlStatements.push(`--   ${u.instanceId} / ${u.chatId} — ${u.reason}`)
    }
  }

  return {
    memoryUpdates,
    kvMigrations,
    sql: sqlStatements.join('\n'),
    unmapped,
  }
}

// ---------------------------------------------------------------------------
// Plan execution
// ---------------------------------------------------------------------------

/** D1 batch() limit per call */
const D1_BATCH_SIZE = 100

export async function executeMigration(
  db: D1Database,
  kv: KVNamespace,
  plan: MigrationPlan,
  options?: { deleteOldKeys?: boolean },
): Promise<MigrationResult> {
  let success = 0
  let failed = 0
  const errors: string[] = []
  const deleteOld = options?.deleteOldKeys ?? false

  // ─── 1. D1 memory updates (batched) ───────────────────────────────────

  for (let i = 0; i < plan.memoryUpdates.length; i += D1_BATCH_SIZE) {
    const batch = plan.memoryUpdates.slice(i, i + D1_BATCH_SIZE)
    const statements = batch.map((update) =>
      db
        .prepare(
          `UPDATE memories SET chat_id = ? WHERE instance_id = ? AND chat_id = ?`,
        )
        .bind(update.newChatId, update.instanceId, update.oldChatId),
    )

    try {
      const results = await db.batch(statements)
      for (const r of results) {
        if (r.success) {
          success++
        } else {
          failed++
          errors.push(`D1 batch item failed: ${r.error ?? 'unknown error'}`)
        }
      }
    } catch (e: any) {
      failed += batch.length
      errors.push(`D1 batch error: ${e.message ?? String(e)}`)
    }
  }

  // ─── 2. KV key migrations ────────────────────────────────────────────

  for (const migration of plan.kvMigrations) {
    try {
      // Read old value
      const value = await kv.get(migration.oldKey)
      if (value === null) {
        // Key already gone or expired — skip
        success++
        continue
      }

      // Write to new key (preserve the same TTL behavior — chat keys use 24h TTL)
      await kv.put(migration.newKey, value, { expirationTtl: 86400 })

      // Optionally delete old key
      if (deleteOld) {
        await kv.delete(migration.oldKey)
      }

      success++
    } catch (e: any) {
      failed++
      errors.push(
        `KV migration failed: ${migration.oldKey} → ${migration.newKey}: ${e.message ?? String(e)}`,
      )
    }
  }

  return { success, failed, errors }
}

// ---------------------------------------------------------------------------
// Dry-run / CLI helper
// ---------------------------------------------------------------------------

/**
 * Print a human-readable summary of a migration plan.
 * Useful for review before executing.
 */
export function summarizePlan(plan: MigrationPlan): string {
  const lines: string[] = [
    `=== Migration Plan Summary ===`,
    `D1 memory updates: ${plan.memoryUpdates.length}`,
    `KV key migrations: ${plan.kvMigrations.length}`,
    `Unmapped (need manual attention): ${plan.unmapped.length}`,
    '',
  ]

  if (plan.memoryUpdates.length > 0) {
    lines.push('── D1 Memory Updates ──')
    for (const u of plan.memoryUpdates) {
      lines.push(`  [${u.instanceId}] ${u.oldChatId} → ${u.newChatId}`)
    }
    lines.push('')
  }

  if (plan.kvMigrations.length > 0) {
    lines.push('── KV Key Migrations ──')
    for (const m of plan.kvMigrations) {
      lines.push(`  ${m.oldKey} → ${m.newKey}`)
    }
    lines.push('')
  }

  if (plan.unmapped.length > 0) {
    lines.push('── Unmapped (Manual Resolution Required) ──')
    for (const u of plan.unmapped) {
      lines.push(`  ⚠️  [${u.instanceId}] ${u.chatId} — ${u.reason}`)
    }
    lines.push('')
  }

  lines.push('── SQL ──')
  lines.push(plan.sql)

  return lines.join('\n')
}
