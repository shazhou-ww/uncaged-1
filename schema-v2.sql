-- Uncaged D1 Schema v2: Knowledge Distillation System
-- Extends the existing memories table with structured knowledge storage

-- Knowledge table: distilled structured knowledge from conversations
CREATE TABLE IF NOT EXISTS knowledge (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('profile', 'event', 'preference', 'fact')),
  subject TEXT NOT NULL,        -- who/what this is about (e.g. "xiaoju", "Scott", "NEKO team")
  content TEXT NOT NULL,        -- the distilled knowledge in natural language
  confidence REAL DEFAULT 0.8,  -- 0-1, how confident we are
  source_ids TEXT,              -- JSON array of memory IDs that contributed to this
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Index for subject lookups
CREATE INDEX IF NOT EXISTS idx_knowledge_subject 
  ON knowledge(instance_id, subject, type);

-- Index for type lookups
CREATE INDEX IF NOT EXISTS idx_knowledge_type
  ON knowledge(instance_id, type, updated_at DESC);

-- Index for full-text content search
CREATE INDEX IF NOT EXISTS idx_knowledge_content
  ON knowledge(instance_id, updated_at DESC);