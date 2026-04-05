/**
 * Identity resolver — Phase 0 of the User Model & Multi-Tenant Architecture (Issue #21).
 *
 * Maps external credentials (Telegram chat_id, Google email, etc.) to a
 * canonical user, resolves their role for a given agent, and ensures the
 * appropriate channel record exists.
 */

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

      await this.db.batch([
        this.db.prepare('INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)').bind(userId, displayName, now),
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
    const stmts: D1PreparedStatement[] = [
      this.db
        .prepare('INSERT OR IGNORE INTO agents (id, owner_id, created_at) VALUES (?, ?, ?)')
        .bind(agentId, ownerId ?? null, now),
    ]
    if (ownerId) {
      stmts.push(
        this.db.prepare('UPDATE agents SET owner_id = ? WHERE id = ? AND owner_id IS NULL').bind(ownerId, agentId),
      )
      stmts.push(
        this.db
          .prepare(
            'INSERT OR IGNORE INTO agent_users (agent_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
          )
          .bind(agentId, ownerId, 'owner', now),
      )
    }
    await this.db.batch(stmts)
  }
}
