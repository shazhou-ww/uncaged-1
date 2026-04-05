// RunnerHub Durable Object — WebSocket connection manager for Runner clients
// Uses Hibernatable WebSocket API for efficient long-lived connections

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

interface RunnerConnection {
  ws: WebSocket
  label: string
  tags: string[]
  connectedAt: number
  lastPingAt: number
  os?: string
  arch?: string
  hostname?: string
}

interface PendingExec {
  resolve: (result: ExecResult) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
  stdout: string
  stderr: string
}

export class RunnerHub implements DurableObject {
  private runners = new Map<string, RunnerConnection>()
  private pending = new Map<string, PendingExec>()

  constructor(private state: DurableObjectState, private env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // ─── WebSocket upgrade: /connect?label=xxx&tags=macos,arm64 ───
    if (url.pathname === '/connect') {
      const upgradeHeader = request.headers.get('Upgrade')
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
        return new Response('Expected Upgrade: websocket', { status: 426 })
      }

      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
      const label = url.searchParams.get('label') || 'default'
      const tagsParam = url.searchParams.get('tags') || ''
      const tags = tagsParam.split(',').filter(Boolean)

      // Hibernatable WebSocket API — state persists across hibernation
      this.state.acceptWebSocket(server, [label])

      this.runners.set(label, {
        ws: server,
        label,
        tags,
        connectedAt: Date.now(),
        lastPingAt: Date.now(),
      })

      console.log(`[RunnerHub] Runner '${label}' connected (tags: ${tags.join(',') || 'none'})`)
      return new Response(null, { status: 101, webSocket: client })
    }

    // ─── POST /exec — internal call from Worker ───
    if (url.pathname === '/exec' && request.method === 'POST') {
      const body = await request.json() as {
        command: string
        cwd?: string
        target?: string
        timeout?: number
        requestId: string
      }

      const label = body.target || this.pickRunner()
      if (!label) {
        return Response.json({ error: 'No runner connected' }, { status: 503 })
      }

      const runner = this.runners.get(label)
      if (!runner) {
        return Response.json({ error: `Runner '${label}' not found` }, { status: 404 })
      }

      const timeoutMs = (body.timeout || 60) * 1000

      try {
        const result = await new Promise<ExecResult>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pending.delete(body.requestId)
            try {
              runner.ws.send(JSON.stringify({ type: 'kill', id: body.requestId }))
            } catch { /* ignore send errors on timeout */ }
            reject(new Error(`Timeout after ${body.timeout || 60}s`))
          }, timeoutMs)

          this.pending.set(body.requestId, {
            resolve,
            reject,
            timer,
            stdout: '',
            stderr: '',
          })

          runner.ws.send(JSON.stringify({
            type: 'exec',
            id: body.requestId,
            command: body.command,
            cwd: body.cwd,
            timeout: body.timeout || 60,
          }))
        })

        return Response.json(result)
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error'
        return Response.json({ error: message }, { status: 500 })
      }
    }

    // ─── GET /runners — list connected runners ───
    if (url.pathname === '/runners' && request.method === 'GET') {
      const list = Array.from(this.runners.values()).map(r => ({
        label: r.label,
        tags: r.tags,
        connectedAt: r.connectedAt,
        lastPingAt: r.lastPingAt,
        os: r.os,
        arch: r.arch,
        hostname: r.hostname,
      }))
      return Response.json({ runners: list })
    }

    return new Response('Not found', { status: 404 })
  }

  // ─── Hibernatable WebSocket handlers ───

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let data: Record<string, unknown>
    try {
      data = JSON.parse(message as string) as Record<string, unknown>
    } catch {
      console.error('[RunnerHub] Failed to parse WebSocket message')
      return
    }

    const type = data.type as string

    switch (type) {
      case 'ping': {
        // Find which runner sent this ping and update lastPingAt
        for (const conn of this.runners.values()) {
          if (conn.ws === ws) {
            conn.lastPingAt = Date.now()
            break
          }
        }
        ws.send(JSON.stringify({ type: 'pong' }))
        break
      }

      case 'info': {
        // Runner announces its system info
        for (const conn of this.runners.values()) {
          if (conn.ws === ws) {
            conn.os = data.os as string | undefined
            conn.arch = data.arch as string | undefined
            conn.hostname = data.hostname as string | undefined
            break
          }
        }
        break
      }

      case 'stdout': {
        const id = data.id as string
        const pending = this.pending.get(id)
        if (pending) {
          pending.stdout += data.data as string
        }
        break
      }

      case 'stderr': {
        const id = data.id as string
        const pending = this.pending.get(id)
        if (pending) {
          pending.stderr += data.data as string
        }
        break
      }

      case 'exit': {
        const id = data.id as string
        const pending = this.pending.get(id)
        if (pending) {
          clearTimeout(pending.timer)
          this.pending.delete(id)
          pending.resolve({
            code: (data.code as number) ?? -1,
            stdout: pending.stdout,
            stderr: pending.stderr,
          })
        }
        break
      }

      case 'error': {
        const id = data.id as string
        const pending = this.pending.get(id)
        if (pending) {
          clearTimeout(pending.timer)
          this.pending.delete(id)
          pending.reject(new Error((data.message as string) || 'Runner error'))
        }
        break
      }

      default:
        console.warn(`[RunnerHub] Unknown message type: ${type}`)
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    this.cleanupRunner(ws)
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    this.cleanupRunner(ws)
  }

  private cleanupRunner(ws: WebSocket): void {
    for (const [label, conn] of this.runners) {
      if (conn.ws === ws) {
        this.runners.delete(label)
        console.log(`[RunnerHub] Runner '${label}' disconnected`)
        break
      }
    }
  }

  private pickRunner(): string | null {
    // Simple: pick the first connected runner
    // TODO: tag-based selection, load balancing
    const first = this.runners.keys().next()
    return first.done ? null : first.value
  }
}
