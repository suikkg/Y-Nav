/**
 * /api/snippets/* 路由处理器 (Cloudflare Workers)
 *
 * 与原 functions/api/snippets/** 行为完全一致：
 *   POST /api/snippets/auth/login
 *   POST /api/snippets/auth/logout
 *   GET  /api/snippets/auth/session
 *   GET  /api/snippets
 *   POST /api/snippets
 *   GET  /api/snippets/:id
 *   PUT  /api/snippets/:id
 *   DELETE /api/snippets/:id
 *
 * 会话: HMAC-SHA256 签名的紧凑 token
 *   token = base64url(payloadJson) + "." + base64url(signature)
 *   payload: { exp:number(秒), iat:number(秒), sub:'admin' }
 *   Cookie: snippets_session=...; HttpOnly; Secure; SameSite=Lax; Path=/
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

const SESSION_COOKIE_NAME = 'snippets_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 天
const MAX_CODE_BYTES = 1024 * 1024;
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(body), { ...init, headers });
}
function errorResponse(status: number, error: string): Response {
    return new Response(JSON.stringify({ success: false, error }), {
        status,
        headers: JSON_HEADERS,
    });
}

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
function utf8Encode(s: string): Uint8Array { return new TextEncoder().encode(s); }
function utf8Decode(b: Uint8Array): string { return new TextDecoder().decode(b); }

async function hmacKey(secret: string): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'raw',
        utf8Encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify']
    );
}
async function sha256Hex(input: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', utf8Encode(input));
    const bytes = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    return hex;
}
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

async function verifyPassword(password: string, env: SnippetsEnv): Promise<boolean> {
    const expected = (env.SNIPPETS_PASSWORD_HASH || '').trim();
    if (!expected) return false;
    const candidate = await sha256Hex(password);
    const expectedNormalized = /^[a-fA-F0-9]{64}$/.test(expected)
        ? expected.toLowerCase()
        : await sha256Hex(expected);
    return timingSafeEqual(candidate, expectedNormalized);
}

interface SessionPayload { sub: string; iat: number; exp: number; }

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
    try { sigBytes = base64UrlDecode(sigPart); } catch { return null; }
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, utf8Encode(payloadPart));
    if (!ok) return null;
    let payload: SessionPayload;
    try {
        payload = JSON.parse(utf8Decode(base64UrlDecode(payloadPart))) as SessionPayload;
    } catch { return null; }
    if (!payload || typeof payload.exp !== 'number') return null;
    if (Math.floor(Date.now() / 1000) >= payload.exp) return null;
    return payload;
}

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
    return cookies[SESSION_COOKIE_NAME] || null;
}
function buildSessionCookie(token: string): string {
    return [
        `${SESSION_COOKIE_NAME}=${token}`,
        'HttpOnly',
        'Secure',
        'SameSite=Lax',
        'Path=/',
        `Max-Age=${SESSION_TTL_SECONDS}`,
    ].join('; ');
}
function buildClearSessionCookie(): string {
    return [
        `${SESSION_COOKIE_NAME}=`,
        'HttpOnly',
        'Secure',
        'SameSite=Lax',
        'Path=/',
        'Max-Age=0',
    ].join('; ');
}
async function requireSession(request: Request, env: SnippetsEnv): Promise<Response | null> {
    const token = getSessionCookie(request);
    if (!token) return errorResponse(401, '未登录');
    const payload = await verifySessionToken(token, env);
    if (!payload) return errorResponse(401, '会话无效或已过期');
    return null;
}

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
}
function rowToSnippet(row: DBSnippetRow): ApiSnippet {
    let tags: string[] = [];
    try {
        const parsed = JSON.parse(row.tags || '[]');
        if (Array.isArray(parsed)) tags = parsed.filter((t) => typeof t === 'string');
    } catch { tags = []; }
    return {
        id: row.id,
        title: row.title,
        language: row.language || 'text',
        code: row.code,
        description: row.description || undefined,
        tags,
        favorite: !!row.favorite,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
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
// 路由处理
// ============================================

async function handleLogin(request: Request, env: SnippetsEnv): Promise<Response> {
    if (!env.SNIPPETS_PASSWORD_HASH || !env.SNIPPETS_SESSION_SECRET) {
        return errorResponse(500, '服务端未配置 SNIPPETS_PASSWORD_HASH / SNIPPETS_SESSION_SECRET');
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
    if (!ok) return errorResponse(401, '密码错误');

    const token = await createSessionToken(env);
    const headers = new Headers(JSON_HEADERS);
    headers.append('Set-Cookie', buildSessionCookie(token));
    return new Response(JSON.stringify({ success: true }), { headers });
}

async function handleLogout(): Promise<Response> {
    const headers = new Headers(JSON_HEADERS);
    headers.append('Set-Cookie', buildClearSessionCookie());
    return new Response(JSON.stringify({ success: true }), { headers });
}

async function handleSession(request: Request, env: SnippetsEnv): Promise<Response> {
    const configured = !!(env.SNIPPETS_PASSWORD_HASH && env.SNIPPETS_SESSION_SECRET);
    const token = getSessionCookie(request);
    if (!token) return jsonResponse({ success: true, authenticated: false, configured });
    const payload = await verifySessionToken(token, env);
    return jsonResponse({
        success: true,
        authenticated: !!payload,
        configured,
        expiresAt: payload?.exp ?? null,
    });
}

async function handleList(request: Request, env: SnippetsEnv): Promise<Response> {
    const unauthorized = await requireSession(request, env);
    if (unauthorized) return unauthorized;
    if (!env.SNIPPETS_DB) return errorResponse(500, '服务端未绑定 SNIPPETS_DB');
    try {
        const { results } = await env.SNIPPETS_DB
            .prepare('SELECT * FROM snippets ORDER BY updated_at DESC')
            .all<DBSnippetRow>();
        const snippets: ApiSnippet[] = (results || []).map(rowToSnippet);
        return jsonResponse({ success: true, snippets });
    } catch (err: any) {
        return errorResponse(500, err?.message || '读取失败');
    }
}

async function handleCreate(request: Request, env: SnippetsEnv): Promise<Response> {
    const unauthorized = await requireSession(request, env);
    if (unauthorized) return unauthorized;
    if (!env.SNIPPETS_DB) return errorResponse(500, '服务端未绑定 SNIPPETS_DB');

    let body: any;
    try { body = await request.json(); } catch { return errorResponse(400, '请求格式错误'); }

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
        await env.SNIPPETS_DB
            .prepare(
                `INSERT INTO snippets (id, title, language, code, description, tags, favorite, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(id, title, language, code, description || null, JSON.stringify(tags), favorite ? 1 : 0, now, now)
            .run();
    } catch (err: any) {
        return errorResponse(500, err?.message || '写入失败');
    }

    const snippet: ApiSnippet = {
        id, title, language, code,
        description: description || undefined,
        tags, favorite,
        createdAt: now, updatedAt: now,
    };
    return jsonResponse({ success: true, snippet }, { status: 201 });
}

async function fetchById(env: SnippetsEnv, id: string): Promise<DBSnippetRow | null> {
    return env.SNIPPETS_DB
        .prepare('SELECT * FROM snippets WHERE id = ?')
        .bind(id)
        .first<DBSnippetRow>();
}

async function handleGetOne(request: Request, env: SnippetsEnv, id: string): Promise<Response> {
    const unauthorized = await requireSession(request, env);
    if (unauthorized) return unauthorized;
    if (!env.SNIPPETS_DB) return errorResponse(500, '服务端未绑定 SNIPPETS_DB');
    try {
        const row = await fetchById(env, id);
        if (!row) return errorResponse(404, '脚本不存在');
        return jsonResponse({ success: true, snippet: rowToSnippet(row) });
    } catch (err: any) {
        return errorResponse(500, err?.message || '读取失败');
    }
}

async function handleUpdate(request: Request, env: SnippetsEnv, id: string): Promise<Response> {
    const unauthorized = await requireSession(request, env);
    if (unauthorized) return unauthorized;
    if (!env.SNIPPETS_DB) return errorResponse(500, '服务端未绑定 SNIPPETS_DB');

    let body: any;
    try { body = await request.json(); } catch { return errorResponse(400, '请求格式错误'); }

    const existing = await fetchById(env, id);
    if (!existing) return errorResponse(404, '脚本不存在');

    const title = body?.title !== undefined ? validateString(body.title, 200) : existing.title;
    const language = body?.language !== undefined ? (validateString(body.language, 40) || 'text') : existing.language;
    const code = typeof body?.code === 'string' ? body.code : existing.code;
    const description = body?.description !== undefined ? validateString(body.description, 2000) : (existing.description || '');
    const tagsArr = body?.tags !== undefined
        ? normalizeTags(body.tags)
        : (() => { try { const v = JSON.parse(existing.tags || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } })();
    const favorite = body?.favorite !== undefined ? !!body.favorite : !!existing.favorite;

    if (!title) return errorResponse(400, '标题不能为空');
    if (!code) return errorResponse(400, '代码不能为空');
    if (utf8Encode(code).byteLength > MAX_CODE_BYTES) return errorResponse(413, '代码内容过大');

    const updatedAt = new Date().toISOString();

    try {
        await env.SNIPPETS_DB
            .prepare(
                `UPDATE snippets
                 SET title = ?, language = ?, code = ?, description = ?, tags = ?, favorite = ?, updated_at = ?
                 WHERE id = ?`
            )
            .bind(title, language, code, description || null, JSON.stringify(tagsArr), favorite ? 1 : 0, updatedAt, id)
            .run();
    } catch (err: any) {
        return errorResponse(500, err?.message || '更新失败');
    }

    const snippet: ApiSnippet = {
        id, title, language, code,
        description: description || undefined,
        tags: tagsArr, favorite,
        createdAt: existing.created_at, updatedAt,
    };
    return jsonResponse({ success: true, snippet });
}

async function handleDelete(request: Request, env: SnippetsEnv, id: string): Promise<Response> {
    const unauthorized = await requireSession(request, env);
    if (unauthorized) return unauthorized;
    if (!env.SNIPPETS_DB) return errorResponse(500, '服务端未绑定 SNIPPETS_DB');
    try {
        const row = await fetchById(env, id);
        if (!row) return errorResponse(404, '脚本不存在');
        await env.SNIPPETS_DB.prepare('DELETE FROM snippets WHERE id = ?').bind(id).run();
        return jsonResponse({ success: true });
    } catch (err: any) {
        return errorResponse(500, err?.message || '删除失败');
    }
}

/**
 * 主入口: 根据 path + method 分发。
 * 仅在 path 以 /api/snippets 开头时调用。
 */
export async function handleSnippetsRequest(request: Request, env: SnippetsEnv, url: URL): Promise<Response> {
    const method = request.method.toUpperCase();
    const path = url.pathname.replace(/\/+$/, '');

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

    // 单项 /api/snippets/:id  (排除 auth/* 已在上面处理)
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
