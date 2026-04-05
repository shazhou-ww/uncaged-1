# Runner MVP — Implementation Plan

> Issue #18 Phase 2: Runner MVP
> Author: 小墨 🖊️ (KUMA Team)
> Date: 2026-04-05

## Overview

跳过 E2B Sandbox（暂无账号），直接实现 Runner MVP：让 Agent 通过 WebSocket 在主人的设备上执行命令。

## 文件清单

### 新增文件

| 文件 | 描述 |
|------|------|
| `schema-v6.sql` | Runner tokens 表 |
| `packages/core/src/runner-hub.ts` | RunnerHub Durable Object — WebSocket 连接管理 |
| `packages/core/src/tools/exec.ts` | exec 工具定义 + handler |
| `packages/runner/` | headless Runner 客户端（独立 npm 包） |
| `packages/runner/src/index.ts` | Runner 主入口 |
| `packages/runner/src/session.ts` | Shell session 管理 |
| `packages/runner/package.json` | |

### 修改文件

| 文件 | 变更 |
|------|------|
| `packages/core/src/env.ts` | 添加 RUNNER_HUB DO binding |
| `packages/core/src/llm.ts` | 注册 exec + runner_list 工具，添加 executeTool 分支 |
| `packages/worker/src/index.ts` | 添加 `/runner/ws` 路由，导出 RunnerHub DO |
| `packages/worker/wrangler.toml` | 添加 DO binding |
| `package.json` | workspace 添加 runner 包 |

## 详细设计

### 1. D1 Schema v6 — Runner Tokens

```sql
-- schema-v6.sql
CREATE TABLE IF NOT EXISTS runner_tokens (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  token_hash TEXT NOT NULL,       -- SHA-256 of bearer token
  label TEXT NOT NULL,            -- "scott-mac", "vps-1"
  tags TEXT,                      -- JSON array: ["macos","arm64"]
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  UNIQUE(agent_id, label)
);
CREATE INDEX IF NOT EXISTS idx_runner_tokens_agent ON runner_tokens(agent_id);
CREATE INDEX IF NOT EXISTS idx_runner_tokens_hash ON runner_tokens(token_hash);
```

Token 验证流程：
1. Runner 连接带 Bearer token
2. Worker 对 token 做 SHA-256
3. 查 runner_tokens 表找到 agent_id + label
4. 转发到对应 agent 的 RunnerHub DO

### 2. RunnerHub Durable Object

```typescript
// packages/core/src/runner-hub.ts

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
  timer: number  // setTimeout ID for timeout
  stdout: string
  stderr: string
}

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export class RunnerHub implements DurableObject {
  private runners = new Map<string, RunnerConnection>()
  private pending = new Map<string, PendingExec>()
  
  constructor(private state: DurableObjectState, private env: any) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    
    // WebSocket upgrade: /connect?label=xxx&tags=macos,arm64
    if (url.pathname === '/connect') {
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      const label = url.searchParams.get('label') || 'default'
      const tags = (url.searchParams.get('tags') || '').split(',').filter(Boolean)
      
      this.state.acceptWebSocket(server, [label])
      this.runners.set(label, {
        ws: server,
        label,
        tags,
        connectedAt: Date.now(),
        lastPingAt: Date.now(),
      })
      
      return new Response(null, { status: 101, webSocket: client })
    }
    
    // POST /exec — internal call from Worker
    if (url.pathname === '/exec' && request.method === 'POST') {
      const body = await request.json() as {
        command: string
        cwd?: string
        target?: string  // runner label
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
      
      const result = await new Promise<ExecResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(body.requestId)
          runner.ws.send(JSON.stringify({ type: 'kill', id: body.requestId }))
          reject(new Error(`Timeout after ${body.timeout || 60}s`))
        }, timeoutMs)
        
        this.pending.set(body.requestId, { resolve, reject, timer, stdout: '', stderr: '' })
        
        runner.ws.send(JSON.stringify({
          type: 'exec',
          id: body.requestId,
          command: body.command,
          cwd: body.cwd,
          timeout: body.timeout || 60,
        }))
      })
      
      return Response.json(result)
    }
    
    // GET /runners — list connected runners
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
  
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const data = JSON.parse(message as string)
    
    switch (data.type) {
      case 'ping': {
        // Update lastPingAt for the runner that sent this
        for (const [label, conn] of this.runners) {
          if (conn.ws === ws) {
            conn.lastPingAt = Date.now()
            ws.send(JSON.stringify({ type: 'pong' }))
            break
          }
        }
        break
      }
      
      case 'info': {
        // Runner announces its system info
        for (const [label, conn] of this.runners) {
          if (conn.ws === ws) {
            conn.os = data.os
            conn.arch = data.arch
            conn.hostname = data.hostname
            break
          }
        }
        break
      }
      
      case 'stdout': {
        const pending = this.pending.get(data.id)
        if (pending) pending.stdout += data.data
        break
      }
      
      case 'stderr': {
        const pending = this.pending.get(data.id)
        if (pending) pending.stderr += data.data
        break
      }
      
      case 'exit': {
        const pending = this.pending.get(data.id)
        if (pending) {
          clearTimeout(pending.timer)
          this.pending.delete(data.id)
          pending.resolve({
            code: data.code,
            stdout: pending.stdout,
            stderr: pending.stderr,
          })
        }
        break
      }
      
      case 'error': {
        const pending = this.pending.get(data.id)
        if (pending) {
          clearTimeout(pending.timer)
          this.pending.delete(data.id)
          pending.reject(new Error(data.message || 'Runner error'))
        }
        break
      }
    }
  }
  
  async webSocketClose(ws: WebSocket) {
    for (const [label, conn] of this.runners) {
      if (conn.ws === ws) {
        this.runners.delete(label)
        console.log(`[RunnerHub] Runner '${label}' disconnected`)
        break
      }
    }
  }
  
  async webSocketError(ws: WebSocket, error: unknown) {
    this.webSocketClose(ws)
  }
  
  private pickRunner(): string | null {
    // Simple: pick the first connected runner
    // TODO: tag-based selection, load balancing
    const first = this.runners.keys().next()
    return first.done ? null : first.value
  }
}
```

### 3. exec 工具

```typescript
// packages/core/src/tools/exec.ts

export const execTool = {
  type: 'function' as const,
  function: {
    name: 'exec',
    description: 'Execute a command on a connected Runner (owner\'s device). Use runner_list first to check available runners.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        cwd: { type: 'string', description: 'Working directory (optional)' },
        target: { type: 'string', description: 'Runner label (optional, auto-selects if omitted)' },
        timeout: { type: 'number', description: 'Timeout in seconds (default 60, max 300)' },
      },
      required: ['command'],
    },
  },
}

export const runnerListTool = {
  type: 'function' as const,
  function: {
    name: 'runner_list',
    description: 'List all connected Runners with their labels, tags, and system info.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
}

export interface ExecArgs {
  command: string
  cwd?: string
  target?: string
  timeout?: number
}

export async function handleExec(
  args: ExecArgs, 
  runnerHub: DurableObjectStub
): Promise<string> {
  const timeout = Math.min(args.timeout || 60, 300)
  const requestId = crypto.randomUUID()
  
  const response = await runnerHub.fetch('https://runner-hub/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: args.command,
      cwd: args.cwd,
      target: args.target,
      timeout,
      requestId,
    }),
  })
  
  if (!response.ok) {
    const error = await response.json() as { error: string }
    return JSON.stringify({ error: error.error })
  }
  
  const result = await response.json()
  return JSON.stringify(result)
}

export async function handleRunnerList(
  runnerHub: DurableObjectStub
): Promise<string> {
  const response = await runnerHub.fetch('https://runner-hub/runners')
  const data = await response.json()
  return JSON.stringify(data)
}
```

### 4. Worker 路由变更

在 `index.ts` 添加：

```typescript
// ─── Runner WebSocket ───
// Route: /:owner/:agent/runner/ws  (stripped to /runner/ws)
if (pathname === '/runner/ws' && request.headers.get('Upgrade') === 'websocket') {
  // Authenticate runner token
  const auth = request.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 })
  }
  const token = auth.slice(7)
  const tokenHash = await sha256(token)
  
  // Lookup in D1
  const row = await env.MEMORY_DB.prepare(
    'SELECT agent_id, label FROM runner_tokens WHERE token_hash = ?'
  ).bind(tokenHash).first()
  
  if (!row) {
    return new Response('Invalid runner token', { status: 403 })
  }
  
  // Forward to RunnerHub DO (keyed by agent_id)
  const hubId = env.RUNNER_HUB.idFromName(row.agent_id)
  const hub = env.RUNNER_HUB.get(hubId)
  
  const label = new URL(request.url).searchParams.get('label') || row.label
  const tags = new URL(request.url).searchParams.get('tags') || ''
  
  return hub.fetch(`https://runner-hub/connect?label=${label}&tags=${tags}`, {
    headers: request.headers,
  })
}
```

### 5. Runner 客户端 (packages/runner)

Headless Node.js 进程，主动 WebSocket 连接 Agent：

```
packages/runner/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts      # CLI 入口 + WebSocket client
    └── session.ts    # Shell session 管理
```

核心逻辑：
- WebSocket 连接 `wss://uncaged.shazhou.work/{owner}/{agent}/runner/ws`
- 收到 `exec` → spawn shell 子进程
- stdout/stderr 流式回传
- 进程退出发 `exit` 消息
- 10s 心跳 ping
- 断线自动重连（指数退避）

### 6. wrangler.toml 变更

```toml
# Runner Hub Durable Object
[[durable_objects.bindings]]
name = "RUNNER_HUB"
class_name = "RunnerHub"

[[migrations]]
tag = "v6"
new_classes = ["RunnerHub"]
```

## 权限对接

exec 执行前查 `agent_users.role`：
- **owner** — 完全访问
- **trusted** — 需要 agent 配置中显式允许
- **guest** — 禁止 exec

当前 MVP 阶段，Runner token 本身就隐含了 owner 授权（只有 owner 能生成 token），所以暂时不做 per-command 权限检查。

## 实施步骤

1. **schema-v6.sql** — runner_tokens 表
2. **RunnerHub DO** — WebSocket 管理 + exec 转发
3. **exec 工具** — 注册到 LLM agentLoop
4. **Worker 路由** — /runner/ws + token 验证
5. **Runner 客户端** — headless Node.js
6. **wrangler.toml** — DO binding

## 不做（MVP scope 外）

- E2B Sandbox 集成
- 多 Runner 负载均衡
- 文件读写工具
- Runner Dashboard
- Runner 自动部署
