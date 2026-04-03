# Uncaged 🔓

**Sigil-native AI Agent** — A Telegram bot that can create, discover, and use serverless capabilities on the fly.

## What is Uncaged?

Uncaged is an AI agent that lives on Cloudflare Workers. It uses [Sigil](https://github.com/oc-xiaoju/sigil) as its capability registry — when it encounters a problem it can't solve directly, it creates a new serverless function, deploys it to Sigil, and uses it immediately.

## Architecture

```
Telegram → Webhook → CF Worker (Uncaged) → LLM (DashScope/Qwen)
                                          ↕
                                      Sigil (Capability Registry)
```

## How it works

1. User sends a message via Telegram
2. Uncaged queries Sigil for relevant existing capabilities
3. LLM decides: answer directly / use existing capability / create new one
4. If creating: designs schema + code → deploys to Sigil → invokes
5. Returns result to user

## Setup

```bash
# Install deps
npm install

# Set secrets
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put DASHSCOPE_API_KEY
wrangler secret put SIGIL_DEPLOY_TOKEN

# Deploy
wrangler deploy

# Register webhook
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://uncaged.shazhou.workers.dev/webhook"
```

## License

MIT

---

Built by 小橘 🍊 (NEKO Team) | Part of the [Uncaged](https://shazhou-ww.github.io/oc-wiki/shared/uncaged-capability-virtualization/) project
