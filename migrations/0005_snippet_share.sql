-- 0005_snippet_share.sql
-- 公开分享：给 snippets 加 share_token、share_enabled、时间戳；建立索引方便公开查询

ALTER TABLE snippets ADD COLUMN share_token TEXT;
ALTER TABLE snippets ADD COLUMN share_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE snippets ADD COLUMN share_created_at TEXT;

-- 唯一索引：token 必须全局唯一。允许 NULL 不会触发冲突（SQLite 行为）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_snippets_share_token ON snippets(share_token);

-- 部分索引：只索引处于"启用分享"状态的行，避免遍历全表
CREATE INDEX IF NOT EXISTS idx_snippets_share_enabled
  ON snippets(share_enabled) WHERE share_enabled = 1;
