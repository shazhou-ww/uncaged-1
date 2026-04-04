// Baton 🏃 — Serverless task relay system
// A Baton is a self-contained task description (just a prompt).
// Workers are stateless executors that pick up Batons and either
// complete them, fail them, or break them down into sub-Batons.

export type BatonStatus = 'pending' | 'running' | 'completed' | 'failed' | 'spawned'

export interface Baton {
  id: string
  parent_id: string | null
  depth: number

  // Core: a task is just a prompt
  prompt: string
  hints: string[] | null  // suggested tools (not a restriction)

  // State
  status: BatonStatus
  result: string | null
  error: string | null

  // Notification
  channel: string | null  // telegram / api / a2a
  notify: boolean

  // Timestamps
  created_at: number
  updated_at: number
}

export interface BatonEvent {
  baton_id: string
  event: 'created' | 'child_completed' | 'child_failed'
  child_id?: string
}

// ─── D1 Operations ───

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS batons (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  depth INTEGER DEFAULT 0,
  prompt TEXT NOT NULL,
  hints TEXT,
  status TEXT DEFAULT 'pending',
  result TEXT,
  error TEXT,
  channel TEXT,
  notify INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES batons(id)
);
CREATE INDEX IF NOT EXISTS idx_batons_parent ON batons(parent_id);
CREATE INDEX IF NOT EXISTS idx_batons_status ON batons(status);
`

export class BatonStore {
  constructor(private db: D1Database, private queue: Queue<BatonEvent>) {}

  async init(): Promise<void> {
    for (const stmt of INIT_SQL.split(';').filter(s => s.trim())) {
      await this.db.prepare(stmt).run()
    }
  }

  // ── Create ──

  async create(params: {
    prompt: string
    hints?: string[]
    parent_id?: string
    depth?: number
    channel?: string
    notify?: boolean
  }): Promise<Baton> {
    const id = `bt_${crypto.randomUUID().slice(0, 12)}`
    const now = Date.now()
    const baton: Baton = {
      id,
      parent_id: params.parent_id || null,
      depth: params.depth || 0,
      prompt: params.prompt,
      hints: params.hints || null,
      status: 'pending',
      result: null,
      error: null,
      channel: params.channel || null,
      notify: params.notify ?? (params.parent_id ? false : true),
      created_at: now,
      updated_at: now,
    }

    await this.db.prepare(`
      INSERT INTO batons (id, parent_id, depth, prompt, hints, status, result, error, channel, notify, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      baton.id, baton.parent_id, baton.depth,
      baton.prompt, baton.hints ? JSON.stringify(baton.hints) : null,
      baton.status, baton.result, baton.error,
      baton.channel, baton.notify ? 1 : 0,
      baton.created_at, baton.updated_at,
    ).run()

    // Enqueue for execution
    await this.queue.send({ baton_id: baton.id, event: 'created' })
    console.log(`[Baton] Created ${baton.id} (depth=${baton.depth}, parent=${baton.parent_id || 'root'})`)

    return baton
  }

  // ── Read ──

  async load(id: string): Promise<Baton | null> {
    const row = await this.db.prepare('SELECT * FROM batons WHERE id = ?').bind(id).first()
    return row ? this.rowToBaton(row) : null
  }

  async loadChildren(parentId: string): Promise<Baton[]> {
    const { results } = await this.db.prepare(
      'SELECT * FROM batons WHERE parent_id = ?'
    ).bind(parentId).all()
    return results.map(r => this.rowToBaton(r))
  }

  async loadTree(rootId: string): Promise<Baton[]> {
    // Load all batons in the tree via recursive walk
    const all: Baton[] = []
    const queue = [rootId]
    while (queue.length > 0) {
      const id = queue.shift()!
      const baton = await this.load(id)
      if (baton) {
        all.push(baton)
        const children = await this.loadChildren(id)
        for (const child of children) {
          queue.push(child.id)
        }
      }
    }
    return all
  }

  // ── Update ──

  async markRunning(id: string): Promise<void> {
    await this.db.prepare(
      'UPDATE batons SET status = ?, updated_at = ? WHERE id = ?'
    ).bind('running', Date.now(), id).run()
  }

  async complete(id: string, result: string): Promise<void> {
    await this.db.prepare(
      'UPDATE batons SET status = ?, result = ?, updated_at = ? WHERE id = ?'
    ).bind('completed', result, Date.now(), id).run()

    const baton = await this.load(id)
    if (baton?.parent_id) {
      await this.queue.send({
        baton_id: baton.parent_id,
        event: 'child_completed',
        child_id: id,
      })
    }
    console.log(`[Baton] Completed ${id}`)
  }

  async fail(id: string, error: string): Promise<void> {
    await this.db.prepare(
      'UPDATE batons SET status = ?, error = ?, updated_at = ? WHERE id = ?'
    ).bind('failed', error, Date.now(), id).run()

    const baton = await this.load(id)
    if (baton?.parent_id) {
      await this.queue.send({
        baton_id: baton.parent_id,
        event: 'child_failed',
        child_id: id,
      })
    }
    console.log(`[Baton] Failed ${id}: ${error}`)
  }

  async markSpawned(id: string): Promise<void> {
    await this.db.prepare(
      'UPDATE batons SET status = ?, updated_at = ? WHERE id = ?'
    ).bind('spawned', Date.now(), id).run()
    console.log(`[Baton] Spawned children for ${id}`)
  }

  // ── Spawn children ──

  async spawnChildren(parentId: string, children: { prompt: string; hints?: string[] }[]): Promise<Baton[]> {
    const parent = await this.load(parentId)
    if (!parent) throw new Error(`Parent ${parentId} not found`)

    const batons: Baton[] = []
    for (const child of children) {
      const baton = await this.create({
        prompt: child.prompt,
        hints: child.hints,
        parent_id: parentId,
        depth: parent.depth + 1,
        channel: parent.channel || undefined,
        notify: false,  // children don't notify directly
      })
      batons.push(baton)
    }

    await this.markSpawned(parentId)
    return batons
  }

  // ── Helpers ──

  async stats(): Promise<{
    total: number
    by_status: Record<string, number>
    by_depth: Record<number, number>
    recent: Baton[]
    avg_duration_ms: number | null
  }> {
    const [countResult, statusResult, depthResult, recentResult, durationResult] = await Promise.all([
      this.db.prepare('SELECT COUNT(*) as total FROM batons').first(),
      this.db.prepare('SELECT status, COUNT(*) as count FROM batons GROUP BY status').all(),
      this.db.prepare('SELECT depth, COUNT(*) as count FROM batons GROUP BY depth ORDER BY depth').all(),
      this.db.prepare('SELECT * FROM batons ORDER BY created_at DESC LIMIT 10').all(),
      this.db.prepare(`
        SELECT AVG(updated_at - created_at) as avg_ms
        FROM batons WHERE status IN ('completed', 'failed')
      `).first(),
    ])

    const by_status: Record<string, number> = {}
    for (const row of statusResult.results) {
      by_status[row.status as string] = row.count as number
    }

    const by_depth: Record<number, number> = {}
    for (const row of depthResult.results) {
      by_depth[row.depth as number] = row.count as number
    }

    return {
      total: (countResult?.total as number) || 0,
      by_status,
      by_depth,
      recent: recentResult.results.map(r => this.rowToBaton(r)),
      avg_duration_ms: (durationResult?.avg_ms as number) || null,
    }
  }

  private rowToBaton(row: Record<string, unknown>): Baton {
    return {
      id: row.id as string,
      parent_id: row.parent_id as string | null,
      depth: row.depth as number,
      prompt: row.prompt as string,
      hints: row.hints ? JSON.parse(row.hints as string) : null,
      status: row.status as BatonStatus,
      result: row.result as string | null,
      error: row.error as string | null,
      channel: row.channel as string | null,
      notify: (row.notify as number) === 1,
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
    }
  }
}
