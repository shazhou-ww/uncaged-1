-- Uncaged D1 Schema: Structured storage for memory entries
-- Resolves issue #8: time-range queries currently rely on semantic search

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  text TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  chat_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Index for time-range queries: instance + timestamp DESC
CREATE INDEX IF NOT EXISTS idx_memories_instance_time 
  ON memories(instance_id, timestamp DESC);

-- Index for chat-scoped queries: instance + chat + timestamp DESC
CREATE INDEX IF NOT EXISTS idx_memories_instance_chat 
  ON memories(instance_id, chat_id, timestamp DESC);
