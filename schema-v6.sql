-- schema-v6.sql — Runner tokens table
-- Runner MVP: allows registered runner clients to connect via WebSocket

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
