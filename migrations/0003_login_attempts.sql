-- P1: 登录失败限流 (按 IP 冷却)
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL DEFAULT 0,
  first_failed_at INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_blocked_until
  ON login_attempts(blocked_until);
