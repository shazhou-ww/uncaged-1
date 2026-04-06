# Uncaged 🔓

<p align="center">
  <img src="assets/logo.jpg" alt="Uncaged Logo" width="200" />
</p>

**Sigil-native AI Agent** — An AI that discovers, creates, and uses serverless capabilities on the fly.

## What is Uncaged?

Uncaged is a multi-tenant AI agent running on Cloudflare Workers. It uses [Sigil](https://github.com/oc-xiaoju/sigil) as its capability registry — when it encounters a problem, it searches for an existing capability, creates one if needed, and uses it immediately. Available via Telegram bot, web chat, and direct API.

### The Key Insight: Tools = f(Chat History)

Most AI agents have a static tool list. Uncaged's tools are **dynamic** — they're derived from the conversation history:

1. When the LLM calls `create_capability`, the result appears as a callable tool in the next round
2. When context compression drops old query results, the corresponding tools **automatically disappear**
3. Re-querying Sigil **reloads** them

This implements **capability virtual memory**:

| Concept | OS Analogy | Uncaged |
|---------|-----------|---------|
| Load capability | Page fault → swap in | `sigil_query` → tools appear |
| Unload capability | Page eviction | Context compression → tools vanish |
| Active tools | Working set / TLB | Current tools list |
| All capabilities | Disk storage | Sigil KV |

The context window is the "physical memory" — it naturally limits how many tools are active at once.

## Architecture

```
Telegram / Web / API → CF Worker (Uncaged) → LLM (DashScope/Qwen)
                           ↕                       ↕
                     KV (Chat History)     Sigil (Capability Registry)
                     D1 (Memory, Identity) Vectorize (Semantic Search)
                     Durable Objects (RunnerHub)
                     Queues (Baton Tasks)
```

### How It Works

1. User sends a message via Telegram, Web, or API
2. Uncaged loads chat history from KV
3. **Derives dynamic tools** from history (capability results + deploy calls)
4. Sends to LLM with static tools + conditional tools + dynamic tools (`cap_*`)
5. LLM decides: answer directly / create capability / use capability / distill knowledge / spawn tasks
6. Tool results feed back to LLM (agentic loop, max 6 rounds)
7. Final response sent to user, history saved

### Agentic Loop with Error Recovery

If a tool call fails, the error is fed back to the LLM as a tool result. The LLM can then:
- Fix parameters and retry
- Try a different approach
- Explain the issue to the user

No hard crashes on tool errors — the agent adapts.

## Project Structure

Monorepo layout:

```
packages/
├── core/     — Shared business logic (LLM, Sigil, ChatStore, Memory, Pipeline, Tools, Auth)
├── worker/   — CF Worker entry point + channel handlers (Telegram, Web) + routing
├── web/      — React SPA frontend (chat UI, auth flows)
├── runner/   — CLI client for remote code execution (pairs with RunnerHub DO)
└── health/   — Health check dashboard
```

## Channels

| Channel | Domain | Description |
|---------|--------|-------------|
| Telegram | `doudou.shazhou.work` | Bot interface via webhooks |
| Web | `xiaomai.shazhou.work` | React SPA with SSE streaming |
| API | `uncaged.shazhou.work/chat` | Direct chat API (POST) |

Routing is domain-based — the same Worker handles all channels, dispatching by hostname.

## Static vs Dynamic Tools

**Static (always available):**
- `create_capability` — Create new serverless capabilities (self-evolution)
- `distill_knowledge` — Save important information to long-term memory
- `recall_knowledge` — Search long-term memory across all sessions
- `ask_agent` — Collaborate with other AI agents via A2A
- `spawn_task` — Run parallel sub-tasks via Baton queue

**Conditional (available when Runner is connected):**
- `exec` — Execute shell commands on a connected Runner
- `runner_list` — List connected Runner clients

**Dynamic (loaded from conversation context):**
- `cap_{name}` — Capabilities discovered via sigil_query or created via `create_capability`
- Automatically maps to Sigil's local execution engine
- Schema comes directly from capability metadata

## LLM Pipeline

Uncaged uses an adapter pipeline to select the best model per request:

- Image messages → `qwen3-vl-plus` (vision model)
- Code-heavy prompts → `qwen3-coder-plus`
- Simple greetings → `qwen3.5-flash` (fast)
- Default reasoning → `qwen3-max`

## Runner

Runner is a CLI client (`packages/runner/`) that connects to the RunnerHub Durable Object via WebSocket. It lets Uncaged execute shell commands on a remote machine — your laptop, a server, anything with Node.js.

Pairing flow: the agent calls `connect_computer` to generate a short-lived pairing code, then the Runner CLI uses that code to establish a persistent WebSocket session.

## Context Compression

When chat history exceeds 40 messages:
- Keeps the first user message + last 10 messages
- Drops intermediate tool call chains
- Orphaned tool results (without parent assistant message) are cleaned up
- **Side effect**: capabilities from dropped results disappear from tools

This is not a bug — it's the mechanism that implements automatic tool unloading.

## Authentication

Multi-tenant auth system:

- **Google OAuth** — Primary sign-in method
- **Passkey / WebAuthn** — Passwordless biometric authentication
- **JWT sessions** — Short-lived access tokens with refresh token rotation

Identity is stored in D1 (`users`, `credentials`, `agents`, `channels` tables).

## Setup

### Prerequisites

- Cloudflare account (Workers paid plan)
- Telegram Bot (via @BotFather)
- DashScope API key (Alibaba Cloud)
- Google OAuth credentials (for web auth)

### Deploy

```bash
# Clone
git clone https://github.com/oc-xiaoju/uncaged
cd uncaged

# Install (monorepo)
npm install

# Build web frontend
npm run build -w packages/web

# Deploy worker
npx wrangler deploy -c packages/worker/wrangler.toml

# Set secrets
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put DASHSCOPE_API_KEY
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put SESSION_SECRET

# Register Telegram webhook
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://doudou.shazhou.work/webhook"
```

### Environment

**Shared:**

| Variable | Description |
|----------|-------------|
| `DASHSCOPE_API_KEY` | Alibaba DashScope API key |
| `LLM_MODEL` | Override default model (optional) |
| `LLM_BASE_URL` | Override LLM endpoint (optional) |
| `A2A_TOKEN` | A2A authentication token (optional) |
| `DEBUG_ENABLED` | Enable debug logging (optional) |

**Telegram channel:**

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token |
| `ALLOWED_CHAT_IDS` | Comma-separated allowed Telegram chat IDs |

**Web channel:**

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `SESSION_SECRET` | JWT signing secret |

**Bindings (wrangler.toml):**

| Binding | Type | Purpose |
|---------|------|---------|
| `CHAT_KV` | KV | Chat history storage |
| `SIGIL_KV` | KV | Local capability registry |
| `MEMORY_DB` | D1 | Long-term memory + identity tables |
| `BATON_DB` | D1 | Task queue state |
| `MEMORY_INDEX` | Vectorize | Semantic search for knowledge recall |
| `RUNNER_HUB` | Durable Object | WebSocket hub for Runner clients |
| `BATON_QUEUE` | Queue | Async task execution |
| `LOADER` | Worker Loader | Sigil local execution engine |
| `AI` | Workers AI | AI model binding |

## Bot Commands

- `/start` — Reset conversation
- `/clear` — Clear chat history (memory retained)
- `/soul` — Show personality
- `/help` — Show available commands

## Example Interactions

**Discovering and using an existing capability:**
```
User: What's the base64 of "hello world"?
Bot: [queries Sigil → finds "encode" → calls cap_encode → returns result]
     The base64 encoding of "hello world" is: aGVsbG8gd29ybGQ=
```

**Creating a new capability:**
```
User: I need a SHA-256 hash calculator
Bot: [creates capability via create_capability → deploys sha256-hash]
     🔮 Created capability "sha256-hash"! Try asking me to hash something.

User: Hash "hello world"
Bot: [calls cap_sha256_hash directly]
     SHA-256: b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
```

## Part of Uncaged

Uncaged is the capability virtualization project — letting AI agents treat the entire internet as their home. Sigil provides the capability registry, and this agent is the first consumer that brings it to life.

- [Sigil](https://github.com/oc-xiaoju/sigil) — Capability registry
- [Uncaged Vision](https://shazhou-ww.github.io/oc-wiki/shared/uncaged-capability-virtualization/) — Architecture doc

## License

MIT

---

Built by 小橘 🍊 (NEKO Team) | Part of the [oc-forge](https://www.npmjs.com/org/oc-forge) ecosystem
