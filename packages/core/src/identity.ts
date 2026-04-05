/**
 * Identity resolver — Phase 0 of the User Model & Multi-Tenant Architecture (Issue #21).
 *
 * Maps external credentials (Telegram chat_id, Google email, etc.) to a
 * canonical user, resolves their role for a given agent, and ensures the
 * appropriate channel record exists.
 */

import { generateShortId } from './short-id.js'

export type AuthType = 'telegram' | 'google' | 'phone' | 'passkey' | 'api'
export type UserRole = 'owner' | 'trusted' | 'guest'

export interface ResolvedIdentity {
  userId: string
  agentId: string
  role: UserRole
  displayName: string
  channelId: string
  isNewUser: boolean
}

/**
 * Generate a URL-friendly slug from a display name
 */
function generateSlug(displayName: string): string {
  return displayName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')           // spaces to hyphens
    .replace(/[^\w\-]/g, '')        // remove non-alphanumeric except hyphens
    .replace(/\-+/g, '-')           // collapse multiple hyphens
    .replace(/^\-+|\-+$/g, '')      // trim leading/trailing hyphens
    .substring(0, 50)               // max length
    || 'user' // fallback if empty
}

/**
 * Generate a unique slug by checking for conflicts and adding suffix
 */
async function generateUniqueSlug(
  db: D1Database, 
  baseSlug: string, 
  table: 'users' | 'agents',
  excludeId?: string
): Promise<string> {
  let slug = baseSlug
  let counter = 0
  
  while (true) {
    // Check if slug exists (excluding current record if updating)
    const query = excludeId 
      ? db.prepare(`SELECT id FROM ${table} WHERE slug = ? AND id != ?`).bind(slug, excludeId)
      : db.prepare(`SELECT id FROM ${table} WHERE slug = ?`).bind(slug)
    
    const existing = await query.first()
    if (!existing) {
      return slug
    }
    
    // Add random suffix to avoid conflicts
    counter++
    const randomSuffix = Math.random().toString(36).substring(2, 5) // 3 random chars
    slug = `${baseSlug}-${randomSuffix}`
    
    // Safety valve
    if (counter > 10) {
      slug = `${baseSlug}-${Date.now()}`
      break
    }
  }
  
  return slug
}

export class IdentityResolver {
  constructor(private db: D1Database) {}

  // ---------------------------------------------------------------------------
  // resolve — main entry point
  // ---------------------------------------------------------------------------

  async resolve(opts: {
    agentId: string
    authType: AuthType
    externalId: string
    displayName?: string
    channelType: 'telegram' | 'web' | 'api'
    channelExternalId: string
  }): Promise<ResolvedIdentity> {
    const {
      agentId,
      authType,
      externalId,
      channelType,
      channelExternalId,
    } = opts
    const displayName = opts.displayName || externalId
    const now = Date.now()

    // 1. Look up credential by (type, external_id)
    const cred = await this.db
      .prepare('SELECT id, user_id FROM credentials WHERE type = ? AND external_id = ?')
      .bind(authType, externalId)
      .first<{ id: string; user_id: string }>()

    // ------ NEW USER ------
    if (!cred) {
      const userId = crypto.randomUUID()
      const credentialId = crypto.randomUUID()
      const channelId = crypto.randomUUID()

      // Generate unique slug and short_id for the new user
      const baseSlug = generateSlug(displayName)
      const userSlug = await generateUniqueSlug(this.db, baseSlug, 'users')
      const userShortId = generateShortId('u')

      await this.db.batch([
        this.db.prepare('INSERT INTO users (id, display_name, slug, short_id, created_at) VALUES (?, ?, ?, ?, ?)').bind(userId, displayName, userSlug, userShortId, now),
        this.db.prepare('INSERT INTO credentials (id, user_id, type, external_id, created_at) VALUES (?, ?, ?, ?, ?)').bind(credentialId, userId, authType, externalId, now),
        this.db.prepare('INSERT OR IGNORE INTO agents (id, created_at) VALUES (?, ?)').bind(agentId, now),
        this.db.prepare('INSERT OR IGNORE INTO agent_users (agent_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').bind(agentId, userId, 'guest', now),
        this.db.prepare('INSERT OR IGNORE INTO channels (id, agent_id, user_id, type, external_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(channelId, agentId, userId, channelType, channelExternalId, now),
      ])

      return {
        userId,
        agentId,
        role: 'guest',
        displayName,
        channelId,
        isNewUser: true,
      }
    }

    // ------ EXISTING USER ------
    const userId = cred.user_id

    // Fetch user record
    const user = await this.db
      .prepare('SELECT display_name FROM users WHERE id = ?')
      .bind(userId)
      .first<{ display_name: string }>()

    // Look up agent_users role for this agent
    const agentUser = await this.db
      .prepare('SELECT role FROM agent_users WHERE agent_id = ? AND user_id = ?')
      .bind(agentId, userId)
      .first<{ role: string }>()

    // Look up channel for this agent + channel type
    const channel = await this.db
      .prepare('SELECT id FROM channels WHERE agent_id = ? AND user_id = ? AND type = ?')
      .bind(agentId, userId, channelType)
      .first<{ id: string }>()

    // Build batch of statements needed to fill gaps
    const stmts: D1PreparedStatement[] = []
    let role: UserRole = 'guest'
    let channelId: string

    // Ensure agent exists (idempotent)
    stmts.push(
      this.db.prepare('INSERT OR IGNORE INTO agents (id, created_at) VALUES (?, ?)').bind(agentId, now),
    )

    if (!agentUser) {
      // Edge case: credential exists but user has no relationship with this agent
      stmts.push(
        this.db.prepare('INSERT OR IGNORE INTO agent_users (agent_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').bind(agentId, userId, 'guest', now),
      )
    } else {
      role = agentUser.role as UserRole
    }

    if (!channel) {
      // Edge case: user exists for agent but no channel record for this channel type
      channelId = crypto.randomUUID()
      stmts.push(
        this.db.prepare('INSERT OR IGNORE INTO channels (id, agent_id, user_id, type, external_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(channelId, agentId, userId, channelType, channelExternalId, now),
      )
    } else {
      channelId = channel.id
    }

    if (stmts.length > 0) {
      await this.db.batch(stmts)
    }

    return {
      userId,
      agentId,
      role,
      displayName: user?.display_name ?? displayName,
      channelId: channelId!,
      isNewUser: false,
    }
  }

  // ---------------------------------------------------------------------------
  // Role helpers
  // ---------------------------------------------------------------------------

  async getRole(agentId: string, userId: string): Promise<UserRole> {
    const row = await this.db
      .prepare('SELECT role FROM agent_users WHERE agent_id = ? AND user_id = ?')
      .bind(agentId, userId)
      .first<{ role: string }>()
    return (row?.role as UserRole) ?? 'guest'
  }

  async setRole(agentId: string, userId: string, role: UserRole): Promise<void> {
    await this.db
      .prepare('UPDATE agent_users SET role = ? WHERE agent_id = ? AND user_id = ?')
      .bind(role, agentId, userId)
      .run()
  }

  // ---------------------------------------------------------------------------
  // Agent bootstrap
  // ---------------------------------------------------------------------------

  async ensureAgent(agentId: string, ownerId?: string): Promise<void> {
    const now = Date.now()
    
    // Check if agent already exists
    const existingAgent = await this.db
      .prepare('SELECT id, slug, short_id FROM agents WHERE id = ?')
      .bind(agentId)
      .first<{ id: string; slug: string | null; short_id: string | null }>()
    
    const stmts: D1PreparedStatement[] = []
    
    if (!existingAgent) {
      // New agent - generate slug and short_id
      const baseSlug = generateSlug(agentId)
      const agentSlug = await generateUniqueSlug(this.db, baseSlug, 'agents')
      const agentShortId = generateShortId('a')
      
      stmts.push(
        this.db
          .prepare('INSERT INTO agents (id, owner_id, slug, short_id, created_at) VALUES (?, ?, ?, ?, ?)')
          .bind(agentId, ownerId ?? null, agentSlug, agentShortId, now)
      )
    } else {
      // Existing agent - update slug/short_id if missing
      let needsUpdate = false
      let agentSlug = existingAgent.slug
      let agentShortId = existingAgent.short_id
      
      if (!agentSlug) {
        const baseSlug = generateSlug(agentId)
        agentSlug = await generateUniqueSlug(this.db, baseSlug, 'agents', agentId)
        needsUpdate = true
      }
      
      if (!agentShortId) {
        agentShortId = generateShortId('a')
        needsUpdate = true
      }
      
      if (needsUpdate) {
        stmts.push(
          this.db
            .prepare('UPDATE agents SET slug = ?, short_id = ? WHERE id = ?')
            .bind(agentSlug, agentShortId, agentId)
        )
      }
      
      // Update owner_id if provided and currently null
      if (ownerId) {
        stmts.push(
          this.db.prepare('UPDATE agents SET owner_id = ? WHERE id = ? AND owner_id IS NULL').bind(ownerId, agentId)
        )
      }
    }
    
    if (ownerId) {
      stmts.push(
        this.db
          .prepare(
            'INSERT OR IGNORE INTO agent_users (agent_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
          )
          .bind(agentId, ownerId, 'owner', now),
      )
    }
    
    if (stmts.length > 0) {
      await this.db.batch(stmts)
    }
  }
}
