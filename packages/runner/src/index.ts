#!/usr/bin/env node
import os from 'node:os'
import { WebSocket } from 'ws'
import { ShellSession } from './session.js'

// ─── Message Types ───────────────────────────────────────────────────────────

interface ExecMessage {
  type: 'exec'
  id: string
  command: string
  cwd?: string
  timeout: number
}

interface KillMessage {
  type: 'kill'
  id: string
}

interface PongMessage {
  type: 'pong'
}

type IncomingMessage = ExecMessage | KillMessage | PongMessage

// ─── CLI / Env Config ────────────────────────────────────────────────────────

function parseArgs(): {
  url: string
  token: string
  label: string
  tags: string
} {
  const args = process.argv.slice(2)
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag)
    return idx !== -1 ? args[idx + 1] : undefined
  }

  const url = get('--url') || process.env.UNCAGED_URL || ''
  const token = get('--token') || process.env.UNCAGED_TOKEN || ''
  const label = get('--label') || process.env.UNCAGED_LABEL || os.hostname()
  const tags = get('--tags') || process.env.UNCAGED_TAGS || ''

  if (!url) {
    console.error('[Runner] Error: --url or UNCAGED_URL is required')
    console.error('Usage: uncaged-runner --url wss://... --token <token> [--label <label>] [--tags tag1,tag2]')
    process.exit(1)
  }

  if (!token) {
    console.error('[Runner] Error: --token or UNCAGED_TOKEN is required')
    console.error('Usage: uncaged-runner --url wss://... --token <token> [--label <label>] [--tags tag1,tag2]')
    process.exit(1)
  }

  return { url, token, label, tags }
}

// ─── Runner ──────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 10_000
const MIN_RECONNECT_MS = 1_000
const MAX_RECONNECT_MS = 30_000

class Runner {
  private ws: WebSocket | null = null
  private sessions = new Map<string, ShellSession>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectDelay = MIN_RECONNECT_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closing = false

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly label: string,
    private readonly tags: string,
  ) {}

  start(): void {
    this.connect()

    process.on('SIGINT', () => this.shutdown('SIGINT'))
    process.on('SIGTERM', () => this.shutdown('SIGTERM'))
  }

  private connect(): void {
    if (this.closing) return

    const connectUrl = new URL(this.url)
    if (this.label) connectUrl.searchParams.set('label', this.label)
    if (this.tags) connectUrl.searchParams.set('tags', this.tags)

    console.log(`[Runner] Connecting to ${connectUrl.toString()}...`)

    this.ws = new WebSocket(connectUrl.toString(), {
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    })

    this.ws.on('open', () => this.onOpen())
    this.ws.on('message', (data) => this.onMessage(data))
    this.ws.on('close', (code, reason) => this.onClose(code, reason.toString()))
    this.ws.on('error', (err) => this.onError(err))
  }

  private onOpen(): void {
    console.log(`[Runner] Connected as '${this.label}'`)
    this.reconnectDelay = MIN_RECONNECT_MS

    // Send info message
    const release = os.release()
    const platform = os.platform()
    this.send({
      type: 'info',
      os: `${platform} ${release}`,
      arch: os.arch(),
      hostname: os.hostname(),
    })

    // Start heartbeat
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping' })
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  private onMessage(raw: unknown): void {
    let msg: IncomingMessage

    try {
      msg = JSON.parse(String(raw)) as IncomingMessage
    } catch {
      console.error('[Runner] Failed to parse message:', raw)
      return
    }

    switch (msg.type) {
      case 'exec':
        this.handleExec(msg)
        break

      case 'kill':
        this.handleKill(msg)
        break

      case 'pong':
        // heartbeat ack, no action needed
        break

      default: {
        const unknown = msg as { type: string }
        console.warn('[Runner] Unknown message type:', unknown.type)
      }
    }
  }

  private handleExec(msg: ExecMessage): void {
    const { id, command, cwd, timeout } = msg
    console.log(`[Runner] exec [${id}]: ${command}`)

    if (this.sessions.has(id)) {
      this.sendError(id, `Session ${id} already exists`)
      return
    }

    const session = new ShellSession()
    this.sessions.set(id, session)

    session.exec(command, cwd, timeout, {
      onStdout: (data) => {
        this.send({ type: 'stdout', id, data })
      },
      onStderr: (data) => {
        this.send({ type: 'stderr', id, data })
      },
      onExit: (code) => {
        console.log(`[Runner] exit [${id}]: code=${code}`)
        this.sessions.delete(id)
        this.send({ type: 'exit', id, code })
      },
      onError: (message) => {
        console.error(`[Runner] error [${id}]: ${message}`)
        this.sessions.delete(id)
        this.send({ type: 'error', id, message })
      },
    })
  }

  private handleKill(msg: KillMessage): void {
    const { id } = msg
    const session = this.sessions.get(id)

    if (session) {
      console.log(`[Runner] kill [${id}]`)
      session.kill()
    } else {
      console.warn(`[Runner] kill [${id}]: session not found`)
    }
  }

  private onClose(code: number, reason: string): void {
    this.stopHeartbeat()
    this.ws = null

    if (this.closing) {
      console.log('[Runner] Disconnected (graceful shutdown)')
      return
    }

    console.log(`[Runner] Disconnected (code=${code}, reason=${reason || 'unknown'}), reconnecting in ${this.reconnectDelay}ms...`)
    this.scheduleReconnect()
  }

  private onError(err: Error): void {
    console.error('[Runner] WebSocket error:', err.message)
    // onClose will be called after error, which handles reconnection
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer) return

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.reconnectDelay)

    // Exponential backoff: double delay, cap at max
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload))
    }
  }

  private sendError(id: string, message: string): void {
    this.send({ type: 'error', id, message })
  }

  private shutdown(signal: string): void {
    console.log(`[Runner] Received ${signal}, shutting down...`)
    this.closing = true

    // Kill all running sessions
    for (const [id, session] of this.sessions) {
      console.log(`[Runner] Killing session ${id}`)
      session.kill()
    }
    this.sessions.clear()

    this.stopHeartbeat()

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
      this.ws.close(1000, 'Shutting down')
    }

    // Give a brief moment for cleanup then exit
    setTimeout(() => process.exit(0), 500)
  }
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

const { url, token, label, tags } = parseArgs()

console.log(`[Runner] Starting uncaged-runner`)
console.log(`[Runner] Label: ${label}`)
if (tags) console.log(`[Runner] Tags: ${tags}`)

const runner = new Runner(url, token, label, tags)
runner.start()
