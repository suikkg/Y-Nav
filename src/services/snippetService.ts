import {
  PublicSnippet,
  ScriptSnippet,
  ScriptSnippetRevision,
  SnippetListQuery,
  SnippetListResult,
} from '../types';

/**
 * 私有脚本库 API 客户端
 * 所有请求都附带:
 *   - credentials: 'include' 以传递 HttpOnly Cookie
 *   - X-Requested-With: 'ynav'  作为 CSRF 双保险，后端会拒绝缺失该头的非 GET 请求
 */

const API_BASE = '/api/snippets';
const CSRF_HEADER_VALUE = 'ynav';

type ApiOk<T> = { success: true } & Partial<T>;
interface ApiErr {
  success: false;
  error?: string;
}
type ApiResult<T> = ApiOk<T> | ApiErr;

async function request<T = unknown>(input: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(input, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': CSRF_HEADER_VALUE,
      ...(init.headers || {}),
    },
  });

  let data: ApiResult<T> | null = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text) as ApiResult<T>;
    } catch {
      // ignore JSON parse error, will throw below
    }
  }

  if (!res.ok || !data || data.success === false) {
    const message = (data as ApiErr | null)?.error || `请求失败 (${res.status})`;
    const err = new Error(message) as Error & { status?: number; retryAfter?: number };
    err.status = res.status;
    if (res.status === 429) {
      const retry = res.headers.get('Retry-After');
      if (retry) {
        const n = parseInt(retry, 10);
        if (!Number.isNaN(n) && n > 0) err.retryAfter = n;
      }
    }
    throw err;
  }

  return data as T;
}

export interface SessionStatus {
  authenticated: boolean;
  configured: boolean;
  expiresAt?: number | null;
}

export async function getSession(): Promise<SessionStatus> {
  const data = await request<SessionStatus & ApiOk<SessionStatus>>(`${API_BASE}/auth/session`);
  return {
    authenticated: !!data.authenticated,
    configured: !!data.configured,
    expiresAt: data.expiresAt ?? null,
  };
}

export async function login(password: string): Promise<void> {
  await request(`${API_BASE}/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function logout(): Promise<void> {
  await request(`${API_BASE}/auth/logout`, { method: 'POST' });
}

function buildListUrl(query?: SnippetListQuery): string {
  if (!query) return API_BASE;
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.lang) params.set('lang', query.lang);
  if (query.tag) params.set('tag', query.tag);
  if (query.favorite && query.favorite !== 'all') params.set('favorite', query.favorite);
  if (query.trashed && query.trashed !== 'false') params.set('trashed', query.trashed);
  if (query.sort) params.set('sort', query.sort);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString();
  return qs ? `${API_BASE}?${qs}` : API_BASE;
}

/**
 * 列表查询。
 * 兼容旧调用方式 listSnippets() → 直接拿全部活跃脚本数组。
 * 新调用方式 listSnippets({...}) → 带查询参数，返回 { snippets, nextCursor }。
 */
export async function listSnippets(): Promise<ScriptSnippet[]>;
export async function listSnippets(query: SnippetListQuery): Promise<SnippetListResult>;
export async function listSnippets(
  query?: SnippetListQuery,
): Promise<ScriptSnippet[] | SnippetListResult> {
  const data = await request<
    { snippets: ScriptSnippet[]; nextCursor: string | null } & ApiOk<{
      snippets: ScriptSnippet[];
      nextCursor: string | null;
    }>
  >(buildListUrl(query));
  const snippets = data.snippets || [];
  if (query === undefined) return snippets;
  return { snippets, nextCursor: data.nextCursor ?? null };
}

export async function getSnippet(id: string): Promise<ScriptSnippet> {
  const data = await request<{ snippet: ScriptSnippet } & ApiOk<{ snippet: ScriptSnippet }>>(
    `${API_BASE}/${encodeURIComponent(id)}`,
  );
  if (!data.snippet) throw new Error('脚本不存在');
  return data.snippet;
}

export interface SnippetInput {
  title: string;
  language: string;
  code: string;
  description?: string;
  tags?: string[];
  favorite?: boolean;
}

export async function createSnippet(input: SnippetInput): Promise<ScriptSnippet> {
  const data = await request<{ snippet: ScriptSnippet } & ApiOk<{ snippet: ScriptSnippet }>>(
    API_BASE,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return data.snippet as ScriptSnippet;
}

export interface UpdateOptions {
  /** 乐观锁：传入读取时的 updatedAt，不匹配会返回 412 */
  ifMatch?: string;
}

export async function updateSnippet(
  id: string,
  input: Partial<SnippetInput>,
  opts?: UpdateOptions,
): Promise<ScriptSnippet> {
  const headers: Record<string, string> = {};
  if (opts?.ifMatch) headers['If-Match'] = opts.ifMatch;
  const data = await request<{ snippet: ScriptSnippet } & ApiOk<{ snippet: ScriptSnippet }>>(
    `${API_BASE}/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify(input),
    },
  );
  return data.snippet as ScriptSnippet;
}

/** 软删除：移入回收站 */
export async function deleteSnippet(id: string): Promise<void> {
  await request(`${API_BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** 从回收站恢复 */
export async function restoreSnippet(id: string): Promise<ScriptSnippet> {
  const data = await request<{ snippet: ScriptSnippet } & ApiOk<{ snippet: ScriptSnippet }>>(
    `${API_BASE}/${encodeURIComponent(id)}/restore`,
    { method: 'POST' },
  );
  return data.snippet as ScriptSnippet;
}

/** 永久删除（仅当条目已在回收站时允许） */
export async function permanentlyDeleteSnippet(id: string): Promise<void> {
  await request(`${API_BASE}/${encodeURIComponent(id)}/permanent`, { method: 'DELETE' });
}

// ============================================
// 版本历史
// ============================================

export async function listRevisions(id: string): Promise<ScriptSnippetRevision[]> {
  const data = await request<
    { revisions: ScriptSnippetRevision[] } & ApiOk<{ revisions: ScriptSnippetRevision[] }>
  >(`${API_BASE}/${encodeURIComponent(id)}/revisions`);
  return data.revisions || [];
}

export async function getRevision(
  snippetId: string,
  revisionId: number,
): Promise<ScriptSnippetRevision> {
  const data = await request<
    { revision: ScriptSnippetRevision } & ApiOk<{ revision: ScriptSnippetRevision }>
  >(`${API_BASE}/${encodeURIComponent(snippetId)}/revisions/${revisionId}`);
  if (!data.revision) throw new Error('版本不存在');
  return data.revision;
}

export async function restoreRevision(
  snippetId: string,
  revisionId: number,
): Promise<ScriptSnippet> {
  const data = await request<{ snippet: ScriptSnippet } & ApiOk<{ snippet: ScriptSnippet }>>(
    `${API_BASE}/${encodeURIComponent(snippetId)}/revisions/${revisionId}/restore`,
    { method: 'POST' },
  );
  return data.snippet as ScriptSnippet;
}

// ============================================
// 公开分享
// ============================================

/** 开启或重新生成分享 token；旧 URL 会失效 */
export async function shareSnippet(id: string): Promise<ScriptSnippet> {
  const data = await request<{ snippet: ScriptSnippet } & ApiOk<{ snippet: ScriptSnippet }>>(
    `${API_BASE}/${encodeURIComponent(id)}/share`,
    { method: 'POST' },
  );
  return data.snippet as ScriptSnippet;
}

/** 撤销分享：清空 token，公开 URL 永久失效 */
export async function revokeShare(id: string): Promise<ScriptSnippet> {
  const data = await request<{ snippet: ScriptSnippet } & ApiOk<{ snippet: ScriptSnippet }>>(
    `${API_BASE}/${encodeURIComponent(id)}/share`,
    { method: 'DELETE' },
  );
  return data.snippet as ScriptSnippet;
}

/**
 * 公开读：用于 /share/:token 视图。
 * 该端点不要求会话；这里也不带 credentials/CSRF，避免无谓的复杂度。
 */
export async function getPublicSnippet(token: string): Promise<PublicSnippet> {
  const res = await fetch(`${API_BASE}/public/${encodeURIComponent(token)}`, {
    headers: { Accept: 'application/json' },
  });
  const text = await res.text();
  let data: { success?: boolean; snippet?: PublicSnippet; error?: string } | null = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // ignore
    }
  }
  if (!res.ok || !data || data.success === false || !data.snippet) {
    const err = new Error(data?.error || '链接无效或已失效') as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data.snippet;
}
