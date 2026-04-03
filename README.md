# Uncaged 🔓

**Sigil-native AI Agent** — An AI that discovers, creates, and uses serverless capabilities on the fly.

## What is Uncaged?

Uncaged is an AI agent running on Cloudflare Workers. It uses [Sigil](https://github.com/oc-xiaoju/sigil) as its capability registry — when it encounters a problem, it searches for an existing capability, creates one if needed, and uses it immediately. All through a Telegram bot interface.

### The Key Insight: Tools = f(Chat History)

Most AI agents have a static tool list. Uncaged's tools are **dynamic** — they're derived from the conversation history:

1. When the LLM calls `sigil_query`, the results appear as callable tools in the next round
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
Telegram → Webhook → CF Worker (Uncaged) → LLM (DashScope/Qwen)
                         ↕                       ↕
                     Chat KV              Sigil (Capability Registry)
                   (history)              (query/deploy/run)
```

### How It Works

1. User sends a message via Telegram
2. Uncaged loads chat history from KV
3. **Derives dynamic tools** from history (sigil_query results + deploy calls)
4. Sends to LLM with static tools (`sigil_query`, `sigil_deploy`) + dynamic tools (`cap_*`)
5. LLM decides: answer directly / query Sigil / create capability / use capability
6. Tool results feed back to LLM (agentic loop, max 6 rounds)
7. Final response sent to user, history saved

### Agentic Loop with Error Recovery

If a tool call fails, the error is fed back to the LLM as a tool result. The LLM can then:
- Fix parameters and retry
- Try a different approach
- Explain the issue to the user

No hard crashes on tool errors — the agent adapts.

## Static vs Dynamic Tools

**Static (always available):**
- `sigil_query` — Search for capabilities
- `sigil_deploy` — Create new capabilities

**Dynamic (loaded from history):**
- `cap_{name}` — Any capability discovered via `sigil_query` or created via `sigil_deploy`
- Automatically maps to `sigil.run(name, params)`
- Schema comes directly from Sigil's capability metadata

## Context Compression

When chat history exceeds 40 messages:
- Keeps the first user message + last 10 messages
- Drops intermediate tool call chains
- Orphaned tool results (without parent assistant message) are cleaned up
- **Side effect**: capabilities from dropped `sigil_query` results disappear from tools

This is not a bug — it's the mechanism that implements automatic tool unloading.

## Setup

### Prerequisites

- Cloudflare account (Workers paid plan, $5/mo)
- Telegram Bot (via @BotFather)
- DashScope API key (Alibaba Cloud)
- Sigil instance deployed

### Deploy

```bash
# Clone
git clone https://github.com/oc-xiaoju/uncaged
cd uncaged

# Install
npm install

# Deploy via CF API (or wrangler deploy if auth is configured)
# See deploy script or use wrangler

# Set secrets
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put DASHSCOPE_API_KEY
wrangler secret put SIGIL_DEPLOY_TOKEN

# Register Telegram webhook
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://uncaged.<subdomain>.workers.dev/webhook"
```

### Environment

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token |
| `DASHSCOPE_API_KEY` | Alibaba DashScope API key |
| `SIGIL_DEPLOY_TOKEN` | Sigil deploy auth token |
| `SIGIL_URL` | Sigil base URL (use custom domain to avoid CF 1042) |
| `CHAT_KV` | KV namespace for chat history |

### CF 1042 Note

If Uncaged and Sigil are on the same Cloudflare account, you **must** use a custom domain for Sigil (e.g., `sigil.yourdomain.com`), not `*.workers.dev`. CF Workers cannot fetch each other via `.workers.dev` subdomains (error 1042).

## Bot Commands

- `/start` — Reset conversation
- `/clear` — Clear chat history

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
Bot: [queries Sigil → not found → deploys sha256-hash → confirms]
     🔮 Created capability "sha256-hash"! Try asking me to hash something.

User: Hash "hello world"
Bot: [calls cap_sha256_hash directly]
     SHA-256: b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
```

## Project Structure

```
src/
├── index.ts        — CF Worker entry point
├── telegram.ts     — Telegram webhook handler
├── llm.ts          — LLM client with dynamic tool loading + agentic loop
├── sigil.ts        — Sigil API client
└── chat-store.ts   — KV-backed chat history with compression
```

## Part of Uncaged

Uncaged is the capability virtualization project — letting AI agents treat the entire internet as their home. Sigil provides the capability registry, and this agent is the first consumer that brings it to life.

- [Sigil](https://github.com/oc-xiaoju/sigil) — Capability registry
- [Uncaged Vision](https://shazhou-ww.github.io/oc-wiki/shared/uncaged-capability-virtualization/) — Architecture doc

## License

MIT

---

Built by 小橘 🍊 (NEKO Team) | Part of the [oc-forge](https://www.npmjs.com/org/oc-forge) ecosystem
