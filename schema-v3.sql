-- Uncaged D1 Schema v3: User Model & Multi-Tenant Identity
-- Phase 0 of Issue #21 — unified user identity across channels
-- All timestamps in milliseconds (Date.now())

-- Users: canonical identity, one per human
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Credentials: links external auth to a user (Telegram, Google, passkey, etc.)
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  public_key BLOB,
  metadata TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(type, external_id)
);

-- Agents: each agent instance (doudou, xiaomai, etc.)
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES users(id),
  display_name TEXT,
  created_at INTEGER NOT NULL
);

-- Agent-User relationships: role-based access per agent
CREATE TABLE IF NOT EXISTS agent_users (
  agent_id TEXT NOT NULL REFERENCES agents(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'guest',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, user_id)
);

-- Channels: per-agent, per-user communication endpoints
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  config TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(agent_id, type, external_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_credentials_lookup ON credentials(type, external_id);
CREATE INDEX IF NOT EXISTS idx_agent_users_user ON agent_users(user_id);
CREATE INDEX IF NOT EXISTS idx_channels_agent_user ON channels(agent_id, user_id);
