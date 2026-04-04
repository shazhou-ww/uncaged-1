# D1 Setup Instructions

## Overview

Uncaged now uses Cloudflare D1 for structured memory storage alongside Vectorize. This resolves time-range query issues (Issue #8) where `memory.recall()` had to rely on semantic search with a "neutral" embedding.

## Setup Steps

### 1. Create D1 Database

```bash
wrangler d1 create uncaged-memory
```

This will output something like:
```
[[d1_databases]]
binding = "MEMORY_DB"
database_name = "uncaged-memory"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 2. Update `wrangler.toml`

Add the `[[d1_databases]]` binding output from step 1 to your `wrangler.toml`:

```toml
[[d1_databases]]
binding = "MEMORY_DB"
database_name = "uncaged-memory"
database_id = "YOUR_DATABASE_ID_HERE"  # from wrangler d1 create output
```

### 3. Run Schema Migration

```bash
wrangler d1 execute uncaged-memory --file=schema.sql
```

This creates the `memories` table and indexes.

### 4. Deploy

```bash
wrangler deploy
```

## Architecture

### Dual Storage Strategy

- **D1**: Structured storage for time-range queries, counting, exact lookups
- **Vectorize**: Semantic search via embeddings (unchanged)

### Operations

| Method | D1 | Vectorize | Notes |
|--------|-----|-----------|-------|
| `store()` | INSERT | upsert | Parallel dual-write |
| `recall()` | SELECT with time range | ❌ | Uses D1 index |
| `search()` | ❌ | query | Semantic search (Vectorize strength) |
| `count()` | SELECT COUNT(*) | ❌ | Exact count via D1 |
| `forget()` | DELETE | deleteByIds | Dual-delete |

### Graceful Fallback

If `MEMORY_DB` binding is not configured:
- Falls back to pure Vectorize mode (legacy behavior)
- No crashes, just logs warnings
- Allows gradual rollout

## Local Development

For local testing with D1:

```bash
wrangler dev --remote  # uses remote D1 preview
```

Or create a local D1 database:

```bash
wrangler d1 execute uncaged-memory --local --file=schema.sql
wrangler dev  # uses local D1
```

## Verification

After setup, test the `/memory` API endpoint:

```bash
curl https://your-worker.workers.dev/memory
```

Should return:
```json
{
  "instance": "your-instance-id",
  "count": 0
}
```

The count now comes from D1 instead of an estimated Vectorize query.

## Rollback

If you need to revert to Vectorize-only mode:

1. Remove the `[[d1_databases]]` binding from `wrangler.toml`
2. Deploy: `wrangler deploy`

The code will automatically fall back to legacy behavior.
