-- Uncaged D1 Schema v5: Capabilities Data Layer
-- Phase 3a: Add capabilities table and agent-capability bindings

-- Capabilities: Sigil ability registry with ownership
CREATE TABLE IF NOT EXISTS capabilities (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT '__platform__' REFERENCES users(id),
  slug TEXT NOT NULL,
  display_name TEXT,
  description TEXT,
  tags TEXT,              -- JSON array
  examples TEXT,          -- JSON array
  schema TEXT,            -- JSON: input schema
  execute TEXT,           -- function body (schema+execute mode)
  code TEXT,              -- full Worker code (code mode)
  type TEXT NOT NULL DEFAULT 'normal',  -- 'persistent' | 'normal' | 'ephemeral'
  visibility TEXT NOT NULL DEFAULT 'private',  -- 'platform' | 'private' | 'shared'
  ttl INTEGER,
  access_count INTEGER DEFAULT 0,
  last_access INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(owner_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_capabilities_owner ON capabilities(owner_id);
CREATE INDEX IF NOT EXISTS idx_capabilities_visibility ON capabilities(visibility);

-- Agent-Capability binding: which agent can use which capabilities
CREATE TABLE IF NOT EXISTS agent_capabilities (
  agent_id TEXT NOT NULL REFERENCES agents(id),
  capability_id TEXT NOT NULL REFERENCES capabilities(id),
  enabled_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, capability_id)
);