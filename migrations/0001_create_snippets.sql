CREATE TABLE IF NOT EXISTS snippets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'text',
  code TEXT NOT NULL,
  description TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snippets_created_at ON snippets(created_at);
CREATE INDEX IF NOT EXISTS idx_snippets_updated_at ON snippets(updated_at);
CREATE INDEX IF NOT EXISTS idx_snippets_language ON snippets(language);
