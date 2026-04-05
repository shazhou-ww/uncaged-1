-- Uncaged D1 Schema v4: Slug + Short ID Dual Routing
-- Phase 2 expansion — adds slug and short_id support for friendly URLs

-- Add slug + short_id to users
ALTER TABLE users ADD COLUMN slug TEXT;
ALTER TABLE users ADD COLUMN short_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_slug ON users(slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_short_id ON users(short_id);

-- Add slug + short_id to agents
ALTER TABLE agents ADD COLUMN slug TEXT;
ALTER TABLE agents ADD COLUMN short_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_short_id ON agents(short_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_owner_slug ON agents(owner_id, slug);

-- Slug change history (for 301 redirects)
CREATE TABLE IF NOT EXISTS slug_history (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,    -- 'user' | 'agent'
  entity_id TEXT NOT NULL,
  old_slug TEXT NOT NULL,
  new_slug TEXT NOT NULL,
  changed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_slug_history_lookup ON slug_history(entity_type, old_slug);