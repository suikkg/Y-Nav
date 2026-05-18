-- P3: 脚本表扩展（软删除 / 浏览计数）+ FTS5 全文搜索 + 历史版本
-- 兼容旧库：所有 ALTER / CREATE 均 IF NOT EXISTS 或单列添加。

-- ============================================
-- 1. snippets 列扩展（软删除 + 浏览计数）
-- ============================================
-- SQLite 不支持 ALTER ... ADD COLUMN IF NOT EXISTS，
-- 重跑这条迁移会因 duplicate column 报错；执行时遇到 "duplicate column" 可忽略。
ALTER TABLE snippets ADD COLUMN deleted_at TEXT;
ALTER TABLE snippets ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_snippets_deleted_at ON snippets(deleted_at);
CREATE INDEX IF NOT EXISTS idx_snippets_updated_alive
  ON snippets(updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_snippets_favorite_alive
  ON snippets(favorite, updated_at DESC) WHERE deleted_at IS NULL;

-- ============================================
-- 2. FTS5 全文搜索
-- ============================================
-- trigram tokenizer 对中文 / 短词 / 拼写错误都更友好（按 3-gram 滑窗索引）。
-- 若 D1 SQLite 版本不支持 trigram，可改为：
--   tokenize='unicode61 remove_diacritics 2'
CREATE VIRTUAL TABLE IF NOT EXISTS snippets_fts USING fts5(
  id UNINDEXED,
  title,
  description,
  code,
  tags,
  tokenize='trigram'
);

-- 回填已有数据（仅插入 FTS 中尚不存在的 id）
INSERT INTO snippets_fts (id, title, description, code, tags)
SELECT s.id, s.title, COALESCE(s.description, ''), s.code, s.tags
FROM snippets s
WHERE NOT EXISTS (SELECT 1 FROM snippets_fts f WHERE f.id = s.id);

-- 触发器：保持 snippets ↔ snippets_fts 同步
CREATE TRIGGER IF NOT EXISTS snippets_ai AFTER INSERT ON snippets BEGIN
  INSERT INTO snippets_fts (id, title, description, code, tags)
  VALUES (new.id, new.title, COALESCE(new.description, ''), new.code, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS snippets_ad AFTER DELETE ON snippets BEGIN
  DELETE FROM snippets_fts WHERE id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS snippets_au AFTER UPDATE OF title, description, code, tags
ON snippets BEGIN
  DELETE FROM snippets_fts WHERE id = old.id;
  INSERT INTO snippets_fts (id, title, description, code, tags)
  VALUES (new.id, new.title, COALESCE(new.description, ''), new.code, new.tags);
END;

-- ============================================
-- 3. 版本历史
-- ============================================
CREATE TABLE IF NOT EXISTS snippet_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snippet_id TEXT NOT NULL,
  title TEXT NOT NULL,
  language TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT,
  tags TEXT NOT NULL,
  favorite INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snippet_revisions_snippet
  ON snippet_revisions(snippet_id, created_at DESC);
