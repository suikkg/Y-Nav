/**
 * /api/snippets/* 路由处理器 (Cloudflare Workers)
 *
 * 鉴权:
 *   - 密码哈希支持两种格式 (env.SNIPPETS_PASSWORD_HASH 或 D1 auth_settings)：
 *     · pbkdf2$<iter>$<saltB64>$<hashB64>    新格式 (PBKDF2-SHA256)
 *     · 64 位 hex                              旧格式 (裸 SHA-256，自动升级)
 *   - 旧密码登录成功后会把 PBKDF2 哈希写回 D1.auth_settings.password_hash，用户无感。
 *   - 会话: HMAC-SHA256 签名 token，Cookie 名 `__Host-snippets_session`，HttpOnly/Secure/SameSite=Lax/Path=/.
 *   - 滑动续期: 剩余 < 5 分钟才重发 Set-Cookie，避免每次请求都写 header.
 *   - 限流: 同 IP 15 分钟内失败 5 次 → 锁 15 分钟，返回 429 + Retry-After.
 *   - CSRF 双保险: 所有非 GET 请求必须带 `X-Requested-With: ynav`，否则 403.
 */

interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta?: unknown;
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface SnippetsEnv {
  SNIPPETS_DB: D1Database;
  SNIPPETS_PASSWORD_HASH?: string;
  SNIPPETS_SESSION_SECRET?: string;
}

// ============================================
// 常量
// ============================================

const SESSION_COOKIE_NAME = '__Host-snippets_session';
const LEGACY_SESSION_COOKIE_NAME = 'snippets_session';
const SESSION_TTL_SECONDS = 60 * 10; // 10 分钟
const SESSION_REFRESH_BEFORE_SECONDS = 60 * 5; // 剩余 < 5 分钟才续期
const MAX_CODE_BYTES = 1024 * 1024;

const PBKDF2_ITER = 200_000;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_HASH_BYTES = 32;

const LOGIN_MAX_FAILS = 5;
const LOGIN_BLOCK_SECONDS = 15 * 60;
const LOGIN_ATTEMPTS_WINDOW_SECONDS = 15 * 60;

const CSRF_HEADER = 'X-Requested-With';
const CSRF_HEADER_VALUE = 'ynav';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;

// 列表 / 历史 相关
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const REVISIONS_RETAIN_PER_SNIPPET = 20;

const SORT_KEYS = [
  'updated_desc',
  'updated_asc',
  'created_desc',
  'created_asc',
  'title_asc',
  'title_desc',
] as const;
type SortKey = (typeof SORT_KEYS)[number];

const SORT_TO_SQL: Record<SortKey, { column: string; direction: 'ASC' | 'DESC' }> = {
  updated_desc: { column: 's.updated_at', direction: 'DESC' },
  updated_asc: { column: 's.updated_at', direction: 'ASC' },
  created_desc: { column: 's.created_at', direction: 'DESC' },
  created_asc: { column: 's.created_at', direction: 'ASC' },
  title_asc: { column: 's.title', direction: 'ASC' },
  title_desc: { column: 's.title', direction: 'DESC' },
};

// ============================================
// 响应工具
// ============================================

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { ...init, headers });
}

function errorResponse(
  status: number,
  error: string,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = new Headers(JSON_HEADERS);
  if (extraHeaders) for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  return new Response(JSON.stringify({ success: false, error }), { status, headers });
}

// ============================================
// 编码辅助
// ============================================

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlDecode(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function base64StandardEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=+$/, '');
}
function base64StandardDecode(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function utf8Encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
function utf8Decode(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ============================================
// 密码哈希: PBKDF2 + 兼容 SHA-256
// ============================================

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8Encode(input));
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

async function pbkdf2Hash(password: string, iter = PBKDF2_ITER): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const key = await crypto.subtle.importKey('raw', utf8Encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    key,
    PBKDF2_HASH_BYTES * 8,
  );
  return `pbkdf2$${iter}$${base64StandardEncode(salt)}$${base64StandardEncode(new Uint8Array(bits))}`;
}

async function verifyPbkdf2(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iter = parseInt(parts[1], 10);
  if (!Number.isFinite(iter) || iter < 10_000 || iter > 10_000_000) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = base64StandardDecode(parts[2]);
    expected = base64StandardDecode(parts[3]);
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey('raw', utf8Encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    key,
    expected.length * 8,
  );
  return timingSafeEqualBytes(new Uint8Array(bits), expected);
}

function isPbkdf2Hash(s: string): boolean {
  return s.startsWith('pbkdf2$');
}

// ============================================
// 鉴权配置存储 (D1 优先 / env 兜底)
// ============================================

async function getStoredHash(env: SnippetsEnv): Promise<string | null> {
  try {
    if (env.SNIPPETS_DB) {
      const row = await env.SNIPPETS_DB.prepare('SELECT v FROM auth_settings WHERE k = ?')
        .bind('password_hash')
        .first<{ v: string }>();
      if (row?.v) return row.v;
    }
  } catch {
    // auth_settings 表不存在等情况 — fall through to env
  }
  const envHash = (env.SNIPPETS_PASSWORD_HASH || '').trim();
  return envHash || null;
}

async function persistUpgradedHash(env: SnippetsEnv, newHash: string): Promise<void> {
  if (!env.SNIPPETS_DB) return;
  try {
    await env.SNIPPETS_DB.prepare(
      `INSERT INTO auth_settings (k, v, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at`,
    )
      .bind('password_hash', newHash, new Date().toISOString())
      .run();
  } catch {
    // 升级失败不阻断登录；下次再试
  }
}

async function verifyPassword(password: string, env: SnippetsEnv): Promise<boolean> {
  const stored = await getStoredHash(env);
  if (!stored) return false;

  let ok = false;
  if (isPbkdf2Hash(stored)) {
    ok = await verifyPbkdf2(password, stored);
  } else if (/^[a-fA-F0-9]{64}$/.test(stored)) {
    const candidate = await sha256Hex(password);
    ok = timingSafeEqual(candidate, stored.toLowerCase());
  } else {
    // 视作明文密码（最早期的兼容路径）
    ok = timingSafeEqual(password, stored);
  }

  if (ok && !isPbkdf2Hash(stored)) {
    const upgraded = await pbkdf2Hash(password);
    await persistUpgradedHash(env, upgraded);
  }
  return ok;
}

// ============================================
// 登录限流
// ============================================

interface LoginAttemptRow {
  ip: string;
  fail_count: number;
  first_failed_at: number;
  blocked_until: number;
}

function getClientIp(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    '0.0.0.0'
  );
}

async function getLoginAttempt(env: SnippetsEnv, ip: string): Promise<LoginAttemptRow | null> {
  if (!env.SNIPPETS_DB) return null;
  try {
    return await env.SNIPPETS_DB.prepare('SELECT * FROM login_attempts WHERE ip = ?')
      .bind(ip)
      .first<LoginAttemptRow>();
  } catch {
    return null;
  }
}

async function checkLoginBlocked(env: SnippetsEnv, ip: string): Promise<number> {
  const row = await getLoginAttempt(env, ip);
  if (!row) return 0;
  const now = Math.floor(Date.now() / 1000);
  if (row.blocked_until > now) return row.blocked_until - now;
  return 0;
}

async function recordLoginFailure(env: SnippetsEnv, ip: string): Promise<number> {
  if (!env.SNIPPETS_DB) return 0;
  const now = Math.floor(Date.now() / 1000);
  const row = await getLoginAttempt(env, ip);
  let count = 1;
  let firstFailedAt = now;
  if (row && now - row.first_failed_at < LOGIN_ATTEMPTS_WINDOW_SECONDS) {
    count = row.fail_count + 1;
    firstFailedAt = row.first_failed_at;
  }
  const blockedUntil = count >= LOGIN_MAX_FAILS ? now + LOGIN_BLOCK_SECONDS : 0;
  try {
    await env.SNIPPETS_DB.prepare(
      `INSERT INTO login_attempts (ip, fail_count, first_failed_at, blocked_until)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(ip) DO UPDATE SET
         fail_count = excluded.fail_count,
         first_failed_at = excluded.first_failed_at,
         blocked_until = excluded.blocked_until`,
    )
      .bind(ip, count, firstFailedAt, blockedUntil)
      .run();
  } catch {
    // 限流表缺失等情况 — 静默忽略
  }
  return blockedUntil > 0 ? LOGIN_BLOCK_SECONDS : 0;
}

async function clearLoginFailures(env: SnippetsEnv, ip: string): Promise<void> {
  if (!env.SNIPPETS_DB) return;
  try {
    await env.SNIPPETS_DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
  } catch {
    // ignore
  }
}

// ============================================
// 会话 token
// ============================================

interface SessionPayload {
  sub: string;
  iat: number;
  exp: number;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    utf8Encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function createSessionToken(env: SnippetsEnv): Promise<string> {
  const secret = (env.SNIPPETS_SESSION_SECRET || '').trim();
  if (!secret) throw new Error('SNIPPETS_SESSION_SECRET 未配置');
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { sub: 'admin', iat: now, exp: now + SESSION_TTL_SECONDS };
  const payloadPart = base64UrlEncode(utf8Encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, utf8Encode(payloadPart));
  const sigPart = base64UrlEncode(new Uint8Array(sig));
  return `${payloadPart}.${sigPart}`;
}

async function verifySessionToken(token: string, env: SnippetsEnv): Promise<SessionPayload | null> {
  const secret = (env.SNIPPETS_SESSION_SECRET || '').trim();
  if (!secret) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payloadPart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  let sigBytes: Uint8Array;
  try {
    sigBytes = base64UrlDecode(sigPart);
  } catch {
    return null;
  }
  const key = await hmacKey(secret);
  const ok = await crypto.subtle.verify('HMAC', key, sigBytes, utf8Encode(payloadPart));
  if (!ok) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(utf8Decode(base64UrlDecode(payloadPart))) as SessionPayload;
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number') return null;
  if (Math.floor(Date.now() / 1000) >= payload.exp) return null;
  return payload;
}

// ============================================
// Cookie
// ============================================

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}
function getSessionCookie(request: Request): string | null {
  const cookies = parseCookies(request.headers.get('Cookie'));
  // 升级期间兼容旧名字
  return cookies[SESSION_COOKIE_NAME] || cookies[LEGACY_SESSION_COOKIE_NAME] || null;
}
function buildSessionCookie(token: string): string {
  // __Host- 前缀要求 Secure + Path=/ + 无 Domain；会话型 (无 Max-Age) 浏览器关即失效。
  return [`${SESSION_COOKIE_NAME}=${token}`, 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/'].join(
    '; ',
  );
}
function buildClearSessionCookie(name: string): string {
  return [`${name}=`, 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=0'].join('; ');
}

interface SessionGuardOk {
  ok: true;
  refreshCookie: string | null;
}
async function requireSession(
  request: Request,
  env: SnippetsEnv,
): Promise<{ ok: false; response: Response } | SessionGuardOk> {
  const token = getSessionCookie(request);
  if (!token) return { ok: false, response: errorResponse(401, '未登录') };
  const payload = await verifySessionToken(token, env);
  if (!payload) return { ok: false, response: errorResponse(401, '会话无效或已过期') };

  const now = Math.floor(Date.now() / 1000);
  const remaining = payload.exp - now;
  if (remaining < SESSION_REFRESH_BEFORE_SECONDS) {
    const fresh = await createSessionToken(env);
    return { ok: true, refreshCookie: buildSessionCookie(fresh) };
  }
  return { ok: true, refreshCookie: null };
}

function attachCookie(response: Response, cookie: string | null): Response {
  if (!cookie) return response;
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', cookie);
  return new Response(response.body, { status: response.status, headers });
}

// ============================================
// CSRF 守卫
// ============================================

function requireCsrfHeader(request: Request): Response | null {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  const got = request.headers.get(CSRF_HEADER);
  if (got !== CSRF_HEADER_VALUE) {
    return errorResponse(403, '缺失 CSRF 头');
  }
  return null;
}

// ============================================
// Snippet 行 ↔ API 形态
// ============================================

interface DBSnippetRow {
  id: string;
  title: string;
  language: string;
  code: string;
  description: string | null;
  tags: string;
  favorite: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  view_count: number;
  share_token?: string | null;
  share_enabled?: number;
  share_created_at?: string | null;
}
interface ApiSnippet {
  id: string;
  title: string;
  language: string;
  code: string;
  description?: string;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  viewCount?: number;
  shareEnabled?: boolean;
  shareToken?: string | null;
  shareCreatedAt?: string | null;
}

interface DBRevisionRow {
  id: number;
  snippet_id: string;
  title: string;
  language: string;
  code: string;
  description: string | null;
  tags: string;
  favorite: number;
  created_at: string;
}
interface ApiRevision {
  id: number;
  snippetId: string;
  title: string;
  language: string;
  code: string;
  description?: string;
  tags: string[];
  favorite: boolean;
  createdAt: string;
}

function parseTags(input: string | null | undefined): string[] {
  try {
    const v = JSON.parse(input || '[]');
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function rowToSnippet(row: DBSnippetRow): ApiSnippet {
  return {
    id: row.id,
    title: row.title,
    language: row.language || 'text',
    code: row.code,
    description: row.description || undefined,
    tags: parseTags(row.tags),
    favorite: !!row.favorite,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
    viewCount: row.view_count ?? 0,
    shareEnabled: !!row.share_enabled,
    shareToken: row.share_token || null,
    shareCreatedAt: row.share_created_at || null,
  };
}

/**
 * 公开视图：脱敏后的字段。
 * 故意省略：tags, favorite, deletedAt, viewCount, shareToken, shareCreatedAt
 * 也不暴露内部 id（用 token 替代）—— 防止通过分享 URL 反推内部 ID 序列
 */
interface PublicSnippet {
  shareToken: string;
  title: string;
  language: string;
  code: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

function rowToPublicSnippet(row: DBSnippetRow): PublicSnippet {
  return {
    shareToken: row.share_token || '',
    title: row.title,
    language: row.language || 'text',
    code: row.code,
    description: row.description || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRevision(row: DBRevisionRow): ApiRevision {
  return {
    id: row.id,
    snippetId: row.snippet_id,
    title: row.title,
    language: row.language || 'text',
    code: row.code,
    description: row.description || undefined,
    tags: parseTags(row.tags),
    favorite: !!row.favorite,
    createdAt: row.created_at,
  };
}
function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = crypto.getRandomValues(new Uint8Array(10));
  let suffix = '';
  for (let i = 0; i < rand.length; i++) suffix += rand[i].toString(36).padStart(2, '0');
  return `${ts}-${suffix.slice(0, 16)}`;
}
function normalizeTags(input: unknown): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input
      .map((t) => (typeof t === 'string' ? t.trim() : ''))
      .filter((t) => t.length > 0)
      .slice(0, 32);
  }
  if (typeof input === 'string') {
    return input
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .slice(0, 32);
  }
  return [];
}
function validateString(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

// ============================================
// 列表查询: 排序 / 游标 / FTS
// ============================================

interface ListCursor {
  /** 排序列的值 */
  v: string;
  /** 同值时按 id 二级排序 */
  i: string;
}

function encodeCursor(value: string, id: string): string {
  return base64UrlEncode(utf8Encode(JSON.stringify({ v: value, i: id })));
}

function decodeCursor(s: string): ListCursor | null {
  try {
    const payload = JSON.parse(utf8Decode(base64UrlDecode(s)));
    if (typeof payload?.v === 'string' && typeof payload?.i === 'string') {
      return { v: payload.v, i: payload.i };
    }
  } catch {
    // ignore
  }
  return null;
}

function pickSortKey(raw: string | null): SortKey {
  if (raw && (SORT_KEYS as readonly string[]).includes(raw)) return raw as SortKey;
  return 'updated_desc';
}

function pickLimit(raw: string | null): number {
  const n = parseInt(raw || '', 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(n, MAX_LIST_LIMIT);
}

/**
 * 把用户输入转为 FTS5 查询串：按空白拆词，每个词包成 phrase ("..." 内部 " 转义)，AND 连接。
 * 例: `foo "bar"` → `"foo" AND "bar"""`
 */
function escapeFtsQuery(q: string): string {
  return q
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' AND ');
}

// ============================================
// 版本历史写入 + 滚动保留
// ============================================

async function appendRevision(env: SnippetsEnv, row: DBSnippetRow): Promise<void> {
  if (!env.SNIPPETS_DB) return;
  const now = new Date().toISOString();
  try {
    await env.SNIPPETS_DB.prepare(
      `INSERT INTO snippet_revisions
         (snippet_id, title, language, code, description, tags, favorite, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(row.id, row.title, row.language, row.code, row.description, row.tags, row.favorite, now)
      .run();

    // 滚动保留最近 N 条
    await env.SNIPPETS_DB.prepare(
      `DELETE FROM snippet_revisions
       WHERE snippet_id = ?
         AND id NOT IN (
           SELECT id FROM snippet_revisions
           WHERE snippet_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?
         )`,
    )
      .bind(row.id, row.id, REVISIONS_RETAIN_PER_SNIPPET)
      .run();
  } catch {
    // 写历史失败不阻断主操作
  }
}

// ============================================
// 路由处理
// ============================================

async function handleLogin(request: Request, env: SnippetsEnv): Promise<Response> {
  if (!env.SNIPPETS_SESSION_SECRET) {
    return errorResponse(500, '服务端未配置 SNIPPETS_SESSION_SECRET');
  }
  const stored = await getStoredHash(env);
  if (!stored) {
    return errorResponse(500, '服务端未配置 SNIPPETS_PASSWORD_HASH');
  }

  const ip = getClientIp(request);
  const blockedSeconds = await checkLoginBlocked(env, ip);
  if (blockedSeconds > 0) {
    return errorResponse(429, '尝试次数过多，请稍后再试', {
      'Retry-After': String(blockedSeconds),
    });
  }

  let body: { password?: unknown } = {};
  try {
    body = (await request.json()) as { password?: unknown };
  } catch {
    return errorResponse(400, '请求格式错误');
  }
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) return errorResponse(400, '请输入密码');

  const ok = await verifyPassword(password, env);
  if (!ok) {
    await recordLoginFailure(env, ip);
    return errorResponse(401, '密码错误');
  }

  await clearLoginFailures(env, ip);
  const token = await createSessionToken(env);
  const headers = new Headers(JSON_HEADERS);
  headers.append('Set-Cookie', buildSessionCookie(token));
  return new Response(JSON.stringify({ success: true }), { headers });
}

function handleLogout(): Response {
  const headers = new Headers(JSON_HEADERS);
  headers.append('Set-Cookie', buildClearSessionCookie(SESSION_COOKIE_NAME));
  headers.append('Set-Cookie', buildClearSessionCookie(LEGACY_SESSION_COOKIE_NAME));
  return new Response(JSON.stringify({ success: true }), { headers });
}

async function handleSession(request: Request, env: SnippetsEnv): Promise<Response> {
  const stored = await getStoredHash(env);
  const configured = !!(stored && env.SNIPPETS_SESSION_SECRET);
  const token = getSessionCookie(request);
  if (!token) return jsonResponse({ success: true, authenticated: false, configured });
  const payload = await verifySessionToken(token, env);
  if (!payload) return jsonResponse({ success: true, authenticated: false, configured });

  const now = Math.floor(Date.now() / 1000);
  const remaining = payload.exp - now;
  const headers = new Headers(JSON_HEADERS);
  if (remaining < SESSION_REFRESH_BEFORE_SECONDS) {
    const fresh = await createSessionToken(env);
    headers.append('Set-Cookie', buildSessionCookie(fresh));
  }
  return new Response(
    JSON.stringify({
      success: true,
      authenticated: true,
      configured,
      expiresAt: payload.exp,
    }),
    { headers },
  );
}

async function handleList(request: Request, env: SnippetsEnv): Promise<Response> {
  const guard = await requireSession(request, env);
  if (!guard.ok) return guard.response;
  if (!env.SNIPPETS_DB) return errorResponse(500, '服务端未绑定 SNIPPETS_DB');

  const url = new URL(request.url);
  const params = url.searchParams;

  const q = (params.get('q') || '').trim();
  const lang = (params.get('lang') || '').trim();
  const tag = (params.get('tag') || '').trim();
  const favoriteRaw = params.get('favorite') || 'all';
  const trashedRaw = params.get('trashed') || 'false';
  const sort = pickSortKey(params.get('sort'));
  const cursorRaw = params.get('cursor');
  const limit = pickLimit(params.get('limit'));

  const useFts = q.length > 0;
  const sortMeta = SORT_TO_SQL[sort];

  const where: string[] = [];
  const binds: unknown[] = [];

  if (useFts) {
    where.push('snippets_fts MATCH ?');
    binds.push(escapeFtsQuery(q));
  }

  if (trashedRaw === 'false') where.push('s.deleted_at IS NULL');
  else if (trashedRaw === 'true') where.push('s.deleted_at IS NOT NULL');
  // 'all': 不过滤

  if (lang) {
    where.push('s.language = ?');
    binds.push(lang);
  }
  if (favoriteRaw === 'true') where.push('s.favorite = 1');
  else if (favoriteRaw === 'false') where.push('s.favorite = 0');

  if (tag) {
    // tags 存为 JSON 数组字符串 ["a","b"]，按 "tag":值 做 LIKE 匹配
    where.push('s.tags LIKE ?');
    binds.push(`%${JSON.stringify(tag).slice(1, -1)}%`);
  }

  // 游标分页只在非 FTS 路径启用（FTS 走 rank 排序，跨页不稳定）
  let cursor: ListCursor | null = null;
  if (!useFts && cursorRaw) {
    cursor = decodeCursor(cursorRaw);
    if (cursor) {
      const cmp = sortMeta.direction === 'DESC' ? '<' : '>';
      where.push(`(${sortMeta.column} ${cmp} ? OR (${sortMeta.column} = ? AND s.id ${cmp} ?))`);
      binds.push(cursor.v, cursor.v, cursor.i);
    }
  }

  const fromClause = useFts
    ? 'snippets s INNER JOIN snippets_fts ON s.id = snippets_fts.id'
    : 'snippets s';

  const orderClause = useFts
    ? 'ORDER BY snippets_fts.rank'
    : `ORDER BY ${sortMeta.column} ${sortMeta.direction}, s.id ${sortMeta.direction}`;

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // 取 limit + 1 检测是否有下一页
  const fetchLimit = useFts ? limit : limit + 1;
  const sql = `SELECT s.* FROM ${fromClause} ${whereSql} ${orderClause} LIMIT ?`;
  binds.push(fetchLimit);

  try {
    const { results } = await env.SNIPPETS_DB.prepare(sql)
      .bind(...binds)
      .all<DBSnippetRow>();
    const rows = results || [];

    let nextCursor: string | null = null;
    let items = rows;
    if (!useFts && rows.length > limit) {
      items = rows.slice(0, limit);
      const last = items[items.length - 1];
      const sortField = sortMeta.column.replace(/^s\./, '') as keyof DBSnippetRow;
      const lastValue = String(last[sortField] ?? '');
      nextCursor = encodeCursor(lastValue, last.id);
    }

    const snippets = items.map(rowToSnippet);
    return attachCookie(jsonResponse({ success: true, snippets, nextCursor }), guard.refreshCookie);
  } catch (err) {
    return errorResponse(500, (err as Error)?.message || '读取失败');
  }
}

async function handleCreate(request: Request, env: SnippetsEnv): Promise<Response> {
  const guard = await requireSession(request, env);
  if (!guard.ok) return guard.response;
  if (!env.SNIPPETS_DB) return errorResponse(500, '服务端未绑定 SNIPPETS_DB');

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(400, '请求格式错误');
  }

  const title = validateString(body?.title, 200);
  const language = validateString(body?.language, 40) || 'text';
  const code = typeof body?.code === 'string' ? body.code : '';
  const description = validateString(body?.description, 2000);
  const tags = normalizeTags(body?.tags);
  const favorite = !!body?.favorite;

  if (!title) return errorResponse(400, '标题不能为空');
  if (!code) return errorResponse(400, '代码不能为空');
  if (utf8Encode(code).byteLength > MAX_CODE_BYTES) return errorResponse(413, '代码内容过大');

  const id = generateId();
  const now = new Date().toISOString();

  try {
    await env.SNIPPETS_DB.prepare(
      `INSERT INTO snippets (id, title, language, code, description, tags, favorite, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        title,
        language,
        code,
        description || null,
        JSON.stringify(tags),
        favorite ? 1 : 0,
        now,
        now,
      )
      .run();
  } catch (err) {
    return errorResponse(500, (err as Error)?.message || '写入失败');
  }

  const snippet: ApiSnippet = {
    id,
    title,
    language,
    code,
    description: description || undefined,
    tags,
    favorite,
    createdAt: now,
    updatedAt: now,
  };
  return attachCookie(
    jsonResponse({ success: true, snippet }, { status: 201 }),
    guard.refreshCookie,
  );
}

async function fetchById(env: SnippetsEnv, id: string): Promise<DBSnippetRow | null> {
  return env.SNIPPETS_DB.prepare('SELECT * FROM snippets WHERE id = ?')
    .bind(id)
    .first<DBSnippetRow>();
}

async function handleGetOne(request: Request, env: SnippetsEnv, id: string): Promise<Response> {
  const guard = await requireSession(request, env);
  if (!guard.ok) return guard.response;
  if (!env.SNIPPETS_DB) return errorResponse(500, '服务端未绑定 SNIPPETS_DB');
  try {
    const row = await fetchById(env, id);
    if (!row) return errorResponse(404, '脚本不存在');

    // 浏览计数 +1（已删除的不计数；最佳努力，失败忽略）
    if (!row.deleted_at) {
      try {
        await env.SNIPPETS_DB.prepare(
          'UPDATE snippets SET view_count = view_count + 1 WHERE id = ?',
        )
          .bind(id)
          .run();
        row.view_count = (row.view_count ?? 0) + 1;
      } catch {
        // ignore
      }
    }

    return attachCookie(
      jsonResponse({ success: true, snippet: rowToSnippet(row) }),
      guard.refreshCookie,
    );
  } catch (err) {
    return errorResponse(500, (err as Error)?.message || '读取失败');
  }
}

async function handleUpdate(request: Request, env: SnippetsEnv, id: string): Promise<Response> {
  const guard = await requireSession(request, env);
  if (!guard.ok) return guard.response;
  if (!env.SNIPPETS_DB) return errorResponse(500, '服务端未绑定 SNIPPETS_DB');

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(400, '请求格式错误');
  }

  const existing = await fetchById(env, id);
  if (!existing) return errorResponse(404, '脚本不存在');
  if (existing.deleted_at) return errorResponse(409, '脚本已在回收站，请先恢复');

  // If-Match 乐观锁: 客户端通过 header 或 body.ifMatch 传 updated_at 快照
  const ifMatch =
    request.headers.get('If-Match') || (typeof body?.ifMatch === 'string' ? body.ifMatch : '');
  if (ifMatch && ifMatch !== existing.updated_at) {
    return errorResponse(412, '脚本已被其他设备修改，请刷新后重试');
  }

  const title = body?.title !== undefined ? validateString(body.title, 200) : existing.title;
  const language =
    body?.language !== undefined ? validateString(body.language, 40) || 'text' : existing.language;
  const code = typeof body?.code === 'string' ? body.code : existing.code;
  const description =
    body?.description !== undefined
      ? validateString(body.description, 2000)
      : existing.description || '';
  const tagsArr = body?.tags !== undefined ? normalizeTags(body.tags) : parseTags(existing.tags);
  const favorite = body?.favorite !== undefined ? !!body.favorite : !!existing.favorite;

  if (!title) return errorResponse(400, '标题不能为空');
  if (!code) return errorResponse(400, '代码不能为空');
  if (utf8Encode(code).byteLength > MAX_CODE_BYTES) return errorResponse(413, '代码内容过大');

  // 先存历史版本（旧值），再更新主表
  await appendRevision(env, existing);

  const updatedAt = new Date().toISOString();

  try {
    await env.SNIPPETS_DB.prepare(
      `UPDATE snippets
       SET title = ?, language = ?, code = ?, description = ?, tags = ?, favorite = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        title,
        language,
        code,
        description || null,
        JSON.stringify(tagsArr),
        favorite ? 1 : 0,
        updatedAt,
        id,
      )
      .run();
  } catch (err) {
    return errorResponse(500, (err as Error)?.message || '更新失败');
  }

  const snippet: ApiSnippet = {
    id,
    title,
    language,
    code,
    description: description || undefined,
    tags: tagsArr,
    favorite,
    createdAt: existing.created_at,
    updatedAt,
    deletedAt: null,
    viewCount: existing.view_count ?? 0,
  };
  return attachCookie(jsonResponse({ success: true, snippet }), guard.refreshCookie);
}

async function handleDelete(request: Request, env: SnippetsEnv, id: string): Promise<Response> {
  const guard = await requireSession(request, env);
  if (!guard.ok) return guard.response;
  if (!env.SNIPPETS_DB) return errorResponse(500, '服务端未绑定 SNIPPETS_DB');
  try {
    const row = await fetchById(env, id);
    if (!row) return errorResponse(404, '脚本不存在');
    if (row.deleted_at) {
      return attachCookie(jsonResponse({ success: true }), guard.refreshCookie);
    }
    const deletedAt = new Date().toISOString();
    await env.SNIPPETS_DB.prepare('UPDATE snippets SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .bind(deletedAt, deletedAt, id)
      .run();
    return attachCookie(jsonResponse({ success: true }), guard.refreshCookie);
  } catch (err) {
    return errorResponse(500, (err as Error)?.message || '删除失败');
  }
}

async function handleRestore(request: Request, env: SnippetsEnv, id: string): Promise<Response> {
  const guard = await requireSession(request, env);
  if (!guard.ok) return guard.response;
  if (!env.SNIPPETS_DB) return errorResponse(500, '服务端未绑定 SNIPPETS_DB');
  try {
    const row = await fetchById(env, id);
    if (!row) return errorResponse(404, '脚本不存在');
    if (!row.deleted_at) {
      return attachCookie(
        jsonResponse({ success: true, snippet: rowToSnippet(row) }),
        guard.refreshCookie,
      );
    }
    const now = new Date().toISOString();
    await env.SNIPPETS_DB.prepare(
      'UPDATE snippets SET deleted_at = NULL, updated_at = ? WHERE id = ?',
    )
      .bind(now, id)
      .run();
    const fresh = await fetchById(env, id);
    return attachCookie(
      jsonResponse({ success: true, snippet: fresh ? rowToSnippet(fresh) : null }),
      guard.refreshCookie,
    );
  } catch (err) {
    return errorResponse(500, (err as Error)?.message || '恢复失败');
  }
}

async function handlePermanentDelete(
  request: Request,
  env: SnippetsEnv,
  id: string,
): Promise<Response> {
  const guard = await requireSession(request, env);
  if (!guard.ok) return guard.response;
  if (!env.SNIPPETS_DB) return errorResponse(500, '服务端未绑定 SNIPPETS_DB');
  try {
    const row = await fetchById(env, id);
    if (!row) return errorResponse(404, '脚本不存在');
    if (!row.deleted_at) {
      return errorResponse(409, '请先将脚本移入回收站，再执行永久删除');
    }
    await env.SNIPPETS_DB.prepare('DELETE FROM snippets WHERE id = ?').bind(id).run();
    // snippet_revisions 没有外键级联，手动清理
    await env.SNIPPETS_DB.prepare('DELETE FROM snippet_revisions WHERE snippet_id = ?')
      .bind(id)
      .run();
    return attachCookie(jsonResponse({ success: true }), guard.refreshCookie);
  } catch (err) {
    return errorResponse(500, (err as Error)?.message || '删除失败');
  }
}

// ============================================
// 版本历史 API
// ============================================

async function handleListRevisions(
  request: Request,
  env: SnippetsEnv,
  id: string,
): Promise<Response> {
  const guard = await requireSession(request, env);
  if (!guard.ok) return guard.response;
  if (!env.SNIPPETS_DB) return errorResponse(500, '服务端未绑定 SNIPPETS_DB');
  try {
    const row = await fetchById(env, id);
    if (!row) return errorResponse(404, '脚本不存在');
    const { results } = await env.SNIPPETS_DB.prepare(
      `SELECT * FROM snippet_revisions
       WHERE snippet_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
      .bind(id, REVISIONS_RETAIN_PER_SNIPPET)
      .all<DBRevisionRow>();
    const revisions = (results || []).map(rowToRevision);
    return attachCookie(jsonResponse({ success: true, revisions }), guard.refreshCookie);
  } catch (err) {
    return errorResponse(500, (err as Error)?.message || '读取失败');
  }
}

async function fetchRevision(
  env: SnippetsEnv,
  snippetId: string,
  revisionId: number,
): Promise<DBRevisionRow | null> {
  return env.SNIPPETS_DB.prepare('SELECT * FROM snippet_revisions WHERE snippet_id = ? AND id = ?')
    .bind(snippetId, revisionId)
    .first<DBRevisionRow>();
}

async function handleGetRevision(
  request: Request,
  env: SnippetsEnv,
  snippetId: string,
  revisionId: number,
): Promise<Response> {
  const guard = await requireSession(request, env);
  if (!guard.ok) return guard.response;
  if (!env.SNIPPETS_DB) return errorResponse(500, '服务端未绑定 SNIPPETS_DB');
  try {
    const row = await fetchRevision(env, snippetId, revisionId);
    if (!row) return errorResponse(404, '版本不存在');
    return attachCookie(
      jsonResponse({ success: true, revision: rowToRevision(row) }),
      guard.refreshCookie,
    );
  } catch (err) {
    return errorResponse(500, (err as Error)?.message || '读取失败');
  }
}

async function handleRestoreRevision(
  request: Request,
  env: SnippetsEnv,
  snippetId: string,
  revisionId: number,
): Promise<Response> {
  const guard = await requireSession(request, env);
  if (!guard.ok) return guard.response;
  if (!env.SNIPPETS_DB) return errorResponse(500, '服务端未绑定 SNIPPETS_DB');

  const existing = await fetchById(env, snippetId);
  if (!existing) return errorResponse(404, '脚本不存在');
  if (existing.deleted_at) return errorResponse(409, '脚本已在回收站，请先恢复');

  const revision = await fetchRevision(env, snippetId, revisionId);
  if (!revision) return errorResponse(404, '版本不存在');

  // 把当前值存到历史，再把 revision 写回主表
  await appendRevision(env, existing);

  const updatedAt = new Date().toISOString();
  try {
    await env.SNIPPETS_DB.prepare(
      `UPDATE snippets
       SET title = ?, language = ?, code = ?, description = ?, tags = ?, favorite = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        revision.title,
        revision.language,
        revision.code,
        revision.description,
        revision.tags,
        revision.favorite,
        updatedAt,
        snippetId,
      )
      .run();
  } catch (err) {
    return errorResponse(500, (err as Error)?.message || '恢复失败');
  }

  const fresh = await fetchById(env, snippetId);
  return attachCookie(
    jsonResponse({ success: true, snippet: fresh ? rowToSnippet(fresh) : null }),
    guard.refreshCookie,
  );
}

// ============================================
// 公开分享
// ============================================

const SHARE_TOKEN_BYTES = 24;

function generateShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SHARE_TOKEN_BYTES));
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 开启/重生成分享：每次 POST 都会生成新 token（旧 URL 失效）。
 * 想"撤销"调用 DELETE。
 */
async function handleShareEnable(
  request: Request,
  env: SnippetsEnv,
  id: string,
): Promise<Response> {
  const guard = await requireSession(request, env);
  if (!guard.ok) return guard.response;
  if (!env.SNIPPETS_DB) return errorResponse(500, '服务端未绑定 SNIPPETS_DB');

  const existing = await fetchById(env, id);
  if (!existing) return errorResponse(404, '脚本不存在');
  if (existing.deleted_at) return errorResponse(409, '脚本已在回收站，无法分享');

  // 重试几次以避免极少见的 token 冲突
  let token = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateShareToken();
    try {
      await env.SNIPPETS_DB.prepare(
        `UPDATE snippets
         SET share_token = ?, share_enabled = 1, share_created_at = ?
         WHERE id = ?`,
      )
        .bind(candidate, new Date().toISOString(), id)
        .run();
      token = candidate;
      break;
    } catch (err) {
      // UNIQUE 冲突 → 重试；其他错误 → 抛出
      if (!String((err as Error)?.message || '').includes('UNIQUE')) {
        return errorResponse(500, (err as Error)?.message || '开启分享失败');
      }
    }
  }
  if (!token) return errorResponse(500, '无法生成分享 token，请重试');

  const fresh = await fetchById(env, id);
  return attachCookie(
    jsonResponse({ success: true, snippet: fresh ? rowToSnippet(fresh) : null }),
    guard.refreshCookie,
  );
}

async function handleShareRevoke(
  request: Request,
  env: SnippetsEnv,
  id: string,
): Promise<Response> {
  const guard = await requireSession(request, env);
  if (!guard.ok) return guard.response;
  if (!env.SNIPPETS_DB) return errorResponse(500, '服务端未绑定 SNIPPETS_DB');

  const existing = await fetchById(env, id);
  if (!existing) return errorResponse(404, '脚本不存在');

  // 撤销 = 清空 token + disabled。之前的 URL 永久失效。
  await env.SNIPPETS_DB.prepare(
    `UPDATE snippets SET share_token = NULL, share_enabled = 0, share_created_at = NULL WHERE id = ?`,
  )
    .bind(id)
    .run();

  const fresh = await fetchById(env, id);
  return attachCookie(
    jsonResponse({ success: true, snippet: fresh ? rowToSnippet(fresh) : null }),
    guard.refreshCookie,
  );
}

/**
 * 公开读：不需要 session、不需要 CSRF（GET 本就不要求）。
 * 仅返回脱敏字段（PublicSnippet）。
 */
async function handlePublicGet(env: SnippetsEnv, token: string): Promise<Response> {
  if (!env.SNIPPETS_DB) return errorResponse(500, '服务端未绑定 SNIPPETS_DB');
  if (!token || token.length < 16 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return errorResponse(404, '链接无效或已失效');
  }
  const row = await env.SNIPPETS_DB.prepare(
    `SELECT * FROM snippets WHERE share_token = ? AND share_enabled = 1 AND deleted_at IS NULL`,
  )
    .bind(token)
    .first<DBSnippetRow>();
  if (!row) return errorResponse(404, '链接无效或已失效');
  return jsonResponse({ success: true, snippet: rowToPublicSnippet(row) });
}

/**
 * 主入口: 根据 path + method 分发。
 * 仅在 path 以 /api/snippets 开头时调用。
 */
export async function handleSnippetsRequest(
  request: Request,
  env: SnippetsEnv,
  url: URL,
): Promise<Response> {
  const csrfErr = requireCsrfHeader(request);
  if (csrfErr) return csrfErr;

  const method = request.method.toUpperCase();
  const path = url.pathname.replace(/\/+$/, '');

  // 公开分享读：在最前面，不需要 session
  const mPublic = path.match(/^\/api\/snippets\/public\/([A-Za-z0-9_-]+)$/);
  if (mPublic) {
    if (method !== 'GET') return errorResponse(405, 'Method not allowed');
    return handlePublicGet(env, mPublic[1]);
  }

  // 鉴权子路由
  if (path === '/api/snippets/auth/login') {
    if (method !== 'POST') return errorResponse(405, 'Method not allowed');
    return handleLogin(request, env);
  }
  if (path === '/api/snippets/auth/logout') {
    if (method !== 'POST') return errorResponse(405, 'Method not allowed');
    return handleLogout();
  }
  if (path === '/api/snippets/auth/session') {
    if (method !== 'GET') return errorResponse(405, 'Method not allowed');
    return handleSession(request, env);
  }

  // 列表
  if (path === '/api/snippets') {
    if (method === 'GET') return handleList(request, env);
    if (method === 'POST') return handleCreate(request, env);
    return errorResponse(405, 'Method not allowed');
  }

  // /api/snippets/:id/revisions
  const mRevList = path.match(/^\/api\/snippets\/([^/]+)\/revisions$/);
  if (mRevList) {
    const id = decodeURIComponent(mRevList[1]);
    if (method === 'GET') return handleListRevisions(request, env, id);
    return errorResponse(405, 'Method not allowed');
  }

  // /api/snippets/:id/revisions/:revId/restore
  const mRevRestore = path.match(/^\/api\/snippets\/([^/]+)\/revisions\/(\d+)\/restore$/);
  if (mRevRestore) {
    const id = decodeURIComponent(mRevRestore[1]);
    const revId = parseInt(mRevRestore[2], 10);
    if (method !== 'POST') return errorResponse(405, 'Method not allowed');
    return handleRestoreRevision(request, env, id, revId);
  }

  // /api/snippets/:id/revisions/:revId
  const mRevOne = path.match(/^\/api\/snippets\/([^/]+)\/revisions\/(\d+)$/);
  if (mRevOne) {
    const id = decodeURIComponent(mRevOne[1]);
    const revId = parseInt(mRevOne[2], 10);
    if (method !== 'GET') return errorResponse(405, 'Method not allowed');
    return handleGetRevision(request, env, id, revId);
  }

  // /api/snippets/:id/restore
  const mRestore = path.match(/^\/api\/snippets\/([^/]+)\/restore$/);
  if (mRestore) {
    const id = decodeURIComponent(mRestore[1]);
    if (method !== 'POST') return errorResponse(405, 'Method not allowed');
    return handleRestore(request, env, id);
  }

  // /api/snippets/:id/permanent
  const mPerm = path.match(/^\/api\/snippets\/([^/]+)\/permanent$/);
  if (mPerm) {
    const id = decodeURIComponent(mPerm[1]);
    if (method !== 'DELETE') return errorResponse(405, 'Method not allowed');
    return handlePermanentDelete(request, env, id);
  }

  // /api/snippets/:id/share
  const mShare = path.match(/^\/api\/snippets\/([^/]+)\/share$/);
  if (mShare) {
    const id = decodeURIComponent(mShare[1]);
    if (method === 'POST') return handleShareEnable(request, env, id);
    if (method === 'DELETE') return handleShareRevoke(request, env, id);
    return errorResponse(405, 'Method not allowed');
  }

  // 单项 /api/snippets/:id
  const m = path.match(/^\/api\/snippets\/([^/]+)$/);
  if (m) {
    const id = decodeURIComponent(m[1]);
    if (method === 'GET') return handleGetOne(request, env, id);
    if (method === 'PUT') return handleUpdate(request, env, id);
    if (method === 'DELETE') return handleDelete(request, env, id);
    return errorResponse(405, 'Method not allowed');
  }

  return errorResponse(404, 'Not found');
}
