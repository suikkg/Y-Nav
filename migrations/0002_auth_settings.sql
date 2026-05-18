-- P1: 鉴权配置表（存储自动升级后的 PBKDF2 密码哈希等）
CREATE TABLE IF NOT EXISTS auth_settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
