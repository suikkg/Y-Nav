/**
 * 共享类型与会话工具 (Pages Functions)
 *
 * 会话格式: HMAC-SHA256 签名的紧凑 token
 *   token = base64url(payloadJson) + "." + base64url(signature)
 * payload: { exp: number(秒), iat: number(秒), sub: 'admin' }
 *
 * Cookie 名: snippets_session
 *   HttpOnly; Secure; SameSite=Lax; Path=/
 */

export interface D1Result<T = unknown> {
    results: T[];
    success: boolean;
    meta?: unknown;
}

export interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = unknown>(): Promise<T | null>;
    all<T = unknown>(): Promise<D1Result<T>>;
    run(): Promise<D1Result>;
}

export interface D1Database {
    prepare(query: string): D1PreparedStatement;
}

export interface SnippetsEnv {
    SNIPPETS_DB: D1Database;
    SNIPPETS_PASSWORD_HASH?: string;
    SNIPPETS_SESSION_SECRET?: string;
}

export const SESSION_COOKIE_NAME = 'snippets_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 天

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' } as const;

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
    const headers = new Headers(init.headers);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(body), { ...init, headers });
}

export function errorResponse(status: number, error: string): Response {
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

function utf8Encode(s: string): Uint8Array {
    return new TextEncoder().encode(s);
}

function utf8Decode(b: Uint8Array): string {
    return new TextDecoder().decode(b);
}

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

/**
 * 校验明文密码是否匹配 SNIPPETS_PASSWORD_HASH。
 * 支持两种格式: 64 位 sha256(hex)，或直接明文（仅当未配置 hash 时不接受）。
 */
export async function verifyPassword(password: string, env: SnippetsEnv): Promise<boolean> {
    const expected = (env.SNIPPETS_PASSWORD_HASH || '').trim();
    if (!expected) return false;
    const candidate = await sha256Hex(password);
    // 同时允许把明文直接放在变量里 (不推荐但常见)
    const expectedNormalized = /^[a-fA-F0-9]{64}$/.test(expected)
        ? expected.toLowerCase()
        : await sha256Hex(expected);
    return timingSafeEqual(candidate, expectedNormalized);
}

export interface SessionPayload {
    sub: string;
    iat: number;
    exp: number;
}

export async function createSessionToken(env: SnippetsEnv): Promise<string> {
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

export async function verifySessionToken(token: string, env: SnippetsEnv): Promise<SessionPayload | null> {
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

export function getSessionCookie(request: Request): string | null {
    const cookies = parseCookies(request.headers.get('Cookie'));
    return cookies[SESSION_COOKIE_NAME] || null;
}

export async function requireSession(request: Request, env: SnippetsEnv): Promise<Response | null> {
    const token = getSessionCookie(request);
    if (!token) return errorResponse(401, '未登录');
    const payload = await verifySessionToken(token, env);
    if (!payload) return errorResponse(401, '会话无效或已过期');
    return null;
}

export function buildSessionCookie(token: string, maxAgeSeconds: number = SESSION_TTL_SECONDS): string {
    return [
        `${SESSION_COOKIE_NAME}=${token}`,
        'HttpOnly',
        'Secure',
        'SameSite=Lax',
        'Path=/',
        `Max-Age=${maxAgeSeconds}`,
    ].join('; ');
}

export function buildClearSessionCookie(): string {
    return [
        `${SESSION_COOKIE_NAME}=`,
        'HttpOnly',
        'Secure',
        'SameSite=Lax',
        'Path=/',
        'Max-Age=0',
    ].join('; ');
}

export interface DBSnippetRow {
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

export interface ApiSnippet {
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

export function rowToSnippet(row: DBSnippetRow): ApiSnippet {
    let tags: string[] = [];
    try {
        const parsed = JSON.parse(row.tags || '[]');
        if (Array.isArray(parsed)) tags = parsed.filter((t) => typeof t === 'string');
    } catch {
        tags = [];
    }
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

export function generateId(): string {
    // 26 字符的 ULID 风格 id (时间前缀 + 随机)
    const ts = Date.now().toString(36);
    const rand = crypto.getRandomValues(new Uint8Array(10));
    let suffix = '';
    for (let i = 0; i < rand.length; i++) suffix += rand[i].toString(36).padStart(2, '0');
    return `${ts}-${suffix.slice(0, 16)}`;
}

export function normalizeTags(input: unknown): string[] {
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
