-- Forward rules: source/destination chats and optional forum topic IDs (message_thread_id)
CREATE TABLE IF NOT EXISTS forward_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  source_chat_id INTEGER NOT NULL,
  source_thread_id INTEGER,
  dest_chat_id INTEGER NOT NULL,
  dest_thread_id INTEGER,
  delivery_mode TEXT NOT NULL DEFAULT 'copy',
  filter_pipeline TEXT NOT NULL DEFAULT '[]',
  include_edited INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rules_source ON forward_rules (source_chat_id, enabled, priority);

-- Encrypted blobs (API credentials, optional StringSession for future MTProto bridge)
CREATE TABLE IF NOT EXISTS secure_store (
  key TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Bot info cache (speeds up grammY init)
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
