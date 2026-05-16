import { ScriptSnippet } from '../types';

/**
 * 私有脚本库 API 客户端
 * 所有请求都附带 credentials: 'include' 以传递 HttpOnly Cookie。
 */

const API_BASE = '/api/snippets';

interface ApiOk<T> extends Partial<T> {
  success: true;
}
interface ApiErr {
  success: false;
  error?: string;
}
type ApiResult<T> = ApiOk<T> | ApiErr;

async function request<T = any>(input: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(input, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    ...init,
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
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
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

export async function listSnippets(): Promise<ScriptSnippet[]> {
  const data = await request<{ snippets: ScriptSnippet[] } & ApiOk<{ snippets: ScriptSnippet[] }>>(API_BASE);
  return data.snippets || [];
}

export async function getSnippet(id: string): Promise<ScriptSnippet> {
  const data = await request<{ snippet: ScriptSnippet } & ApiOk<{ snippet: ScriptSnippet }>>(
    `${API_BASE}/${encodeURIComponent(id)}`
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
    }
  );
  return data.snippet as ScriptSnippet;
}

export async function updateSnippet(id: string, input: Partial<SnippetInput>): Promise<ScriptSnippet> {
  const data = await request<{ snippet: ScriptSnippet } & ApiOk<{ snippet: ScriptSnippet }>>(
    `${API_BASE}/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    }
  );
  return data.snippet as ScriptSnippet;
}

export async function deleteSnippet(id: string): Promise<void> {
  await request(`${API_BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
