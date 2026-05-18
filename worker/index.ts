/**
 * Y-Nav Cloudflare Worker 入口
 *
 * 功能:
 * 1. 托管静态资源 (SPA)
 * 2. 处理 /api/sync 相关请求
 * 3. 处理 /api/snippets/* 请求 (脚本库)
 * 4. 对所有响应统一注入安全响应头 (CSP / X-Frame-Options / Referrer-Policy 等)
 */

import { getAssetFromKV, NotFoundError, MethodNotAllowedError } from '@cloudflare/kv-asset-handler';
import manifestJSON from '__STATIC_CONTENT_MANIFEST';
import { handleSnippetsRequest, SnippetsEnv } from './snippets';

const assetManifest = JSON.parse(manifestJSON);

// ============================================
// 类型定义
// ============================================

interface KVNamespaceInterface {
  get(key: string, type?: 'text' | 'json' | 'arrayBuffer' | 'stream'): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  list(options?: {
    prefix?: string;
  }): Promise<{ keys: Array<{ name: string; expiration?: number }> }>;
}

interface Env extends SnippetsEnv {
  YNAV_WORKER_KV: KVNamespaceInterface;
  SYNC_PASSWORD?: string;
  __STATIC_CONTENT: KVNamespace;
}

interface SyncMetadata {
  updatedAt: number;
  deviceId: string;
  version: number;
  browser?: string;
  os?: string;
}

interface YNavSyncData {
  links: unknown[];
  categories: unknown[];
  searchConfig?: unknown;
  aiConfig?: unknown;
  siteSettings?: unknown;
  privateVault?: string;
  meta: SyncMetadata;
}

// ============================================
// 常量
// ============================================

const KV_MAIN_DATA_KEY = 'ynav:data';
const KV_BACKUP_PREFIX = 'ynav:backup:';
const BACKUP_TTL_SECONDS = 30 * 24 * 60 * 60;

// ============================================
// 安全响应头
// ============================================

/**
 * 应用于所有响应的基础安全头 (不依赖内容类型)。
 */
const BASELINE_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy':
    'geolocation=(), microphone=(), camera=(), payment=(), usb=(), accelerometer=(), gyroscope=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

/**
 * 应用于 HTML 文档的 CSP。
 *   - 内联脚本: index.html 的暗色模式 flash 防抖；用 'unsafe-inline' 简化 (后续可改 hash)
 *   - 内联样式: Tailwind / 各组件需要；'unsafe-inline'
 *   - img:     允许 data:/https: 以兼容 favicon CDN
 *   - connect: self + Gemini + faviconextractor
 *   - frame-ancestors: 禁止任何嵌入
 */
const HTML_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://generativelanguage.googleapis.com https://www.faviconextractor.com",
  "object-src 'none'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join('; ');

function applySecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(BASELINE_SECURITY_HEADERS)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  const contentType = headers.get('Content-Type') || '';
  if (contentType.startsWith('text/html')) {
    if (!headers.has('Content-Security-Policy')) headers.set('Content-Security-Policy', HTML_CSP);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ============================================
// 辅助函数
// ============================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Password',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

function isAuthenticated(request: Request, env: Env): boolean {
  if (!env.SYNC_PASSWORD || env.SYNC_PASSWORD.trim() === '') {
    return true;
  }
  const authHeader = request.headers.get('X-Sync-Password');
  return authHeader === env.SYNC_PASSWORD;
}

// ============================================
// API 处理函数
// ============================================

async function handleApiSync(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // 鉴权检查
  if (!isAuthenticated(request, env)) {
    return jsonResponse(
      {
        success: false,
        error: 'Unauthorized: 密码错误或未配置',
      },
      401,
    );
  }

  try {
    if (request.method === 'GET') {
      if (action === 'backups') {
        return await handleListBackups(env);
      }
      return await handleGet(env);
    }

    if (request.method === 'POST') {
      if (action === 'backup') {
        return await handleBackup(request, env);
      }
      if (action === 'restore') {
        return await handleRestore(request, env);
      }
      return await handlePost(request, env);
    }

    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  } catch (error) {
    return jsonResponse({ success: false, error: (error as Error)?.message || '服务器错误' }, 500);
  }
}

async function handleGet(env: Env): Promise<Response> {
  const data = await env.YNAV_WORKER_KV.get(KV_MAIN_DATA_KEY, 'json');
  if (!data) {
    return jsonResponse({ success: true, data: null, message: '云端暂无数据' });
  }
  return jsonResponse({ success: true, data });
}

async function handlePost(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { data: YNavSyncData; expectedVersion?: number };

  if (!body.data) {
    return jsonResponse({ success: false, error: '缺少 data 字段' }, 400);
  }

  const existingData = (await env.YNAV_WORKER_KV.get(
    KV_MAIN_DATA_KEY,
    'json',
  )) as YNavSyncData | null;

  // 版本冲突检测
  if (existingData && body.expectedVersion !== undefined) {
    if (existingData.meta.version !== body.expectedVersion) {
      return jsonResponse(
        {
          success: false,
          conflict: true,
          data: existingData,
          error: '版本冲突，云端数据已被其他设备更新',
        },
        409,
      );
    }
  }

  const newVersion = existingData ? existingData.meta.version + 1 : 1;
  const dataToSave: YNavSyncData = {
    ...body.data,
    meta: {
      ...body.data.meta,
      updatedAt: Date.now(),
      version: newVersion,
    },
  };

  await env.YNAV_WORKER_KV.put(KV_MAIN_DATA_KEY, JSON.stringify(dataToSave));
  return jsonResponse({ success: true, data: dataToSave, message: '同步成功' });
}

async function handleBackup(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { data: YNavSyncData };
  if (!body.data) {
    return jsonResponse({ success: false, error: '缺少 data 字段' }, 400);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
  const backupKey = `${KV_BACKUP_PREFIX}${timestamp}`;

  await env.YNAV_WORKER_KV.put(backupKey, JSON.stringify(body.data), {
    expirationTtl: BACKUP_TTL_SECONDS,
  });

  return jsonResponse({ success: true, backupKey, message: `备份成功: ${backupKey}` });
}

async function handleRestore(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { backupKey?: string; deviceId?: string };
  const backupKey = body.backupKey;

  if (!backupKey || !backupKey.startsWith(KV_BACKUP_PREFIX)) {
    return jsonResponse({ success: false, error: '无效的备份 key' }, 400);
  }

  const backupData = (await env.YNAV_WORKER_KV.get(backupKey, 'json')) as YNavSyncData | null;
  if (!backupData) {
    return jsonResponse({ success: false, error: '备份不存在或已过期' }, 404);
  }

  const existingData = (await env.YNAV_WORKER_KV.get(
    KV_MAIN_DATA_KEY,
    'json',
  )) as YNavSyncData | null;
  const now = Date.now();
  let rollbackKey: string | null = null;

  // 创建回滚点
  if (existingData) {
    const rollbackTimestamp = new Date(now).toISOString().replace(/[:.]/g, '-').split('.')[0];
    rollbackKey = `${KV_BACKUP_PREFIX}rollback-${rollbackTimestamp}`;
    await env.YNAV_WORKER_KV.put(
      rollbackKey,
      JSON.stringify({
        ...existingData,
        meta: {
          ...existingData.meta,
          updatedAt: now,
          deviceId: body.deviceId || existingData.meta.deviceId,
        },
      }),
      { expirationTtl: BACKUP_TTL_SECONDS },
    );
  }

  const newVersion = (existingData?.meta?.version ?? 0) + 1;
  const restoredData: YNavSyncData = {
    ...backupData,
    meta: {
      ...(backupData.meta || {}),
      updatedAt: now,
      deviceId: body.deviceId || backupData.meta?.deviceId || 'unknown',
      version: newVersion,
    },
  };

  await env.YNAV_WORKER_KV.put(KV_MAIN_DATA_KEY, JSON.stringify(restoredData));
  return jsonResponse({ success: true, data: restoredData, rollbackKey });
}

async function handleListBackups(env: Env): Promise<Response> {
  const list = await env.YNAV_WORKER_KV.list({ prefix: KV_BACKUP_PREFIX });

  const backups = await Promise.all(
    list.keys.map(async (key) => {
      let meta: SyncMetadata | null = null;
      try {
        const data = (await env.YNAV_WORKER_KV.get(key.name, 'json')) as YNavSyncData | null;
        meta = data?.meta || null;
      } catch {
        meta = null;
      }
      return {
        key: key.name,
        timestamp: key.name.replace(KV_BACKUP_PREFIX, ''),
        expiration: key.expiration,
        deviceId: meta?.deviceId,
        updatedAt: meta?.updatedAt,
        version: meta?.version,
        browser: meta?.browser,
        os: meta?.os,
      };
    }),
  );

  return jsonResponse({ success: true, backups });
}

// ============================================
// 静态资源处理
// ============================================

async function handleStaticAssets(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  try {
    return await getAssetFromKV(
      {
        request,
        waitUntil: ctx.waitUntil.bind(ctx),
      },
      {
        ASSET_NAMESPACE: env.__STATIC_CONTENT,
        ASSET_MANIFEST: assetManifest,
      },
    );
  } catch (e) {
    if (e instanceof NotFoundError) {
      // SPA fallback: 返回 index.html
      const notFoundRequest = new Request(new URL('/index.html', request.url).toString(), request);
      return await getAssetFromKV(
        {
          request: notFoundRequest,
          waitUntil: ctx.waitUntil.bind(ctx),
        },
        {
          ASSET_NAMESPACE: env.__STATIC_CONTENT,
          ASSET_MANIFEST: assetManifest,
        },
      );
    } else if (e instanceof MethodNotAllowedError) {
      return new Response('Method Not Allowed', { status: 405 });
    }
    return new Response('Internal Error', { status: 500 });
  }
}

// ============================================
// 主入口
// ============================================

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/snippets')) {
    return handleSnippetsRequest(request, env, url);
  }
  if (url.pathname.startsWith('/api/sync')) {
    return handleApiSync(request, env);
  }
  return handleStaticAssets(request, env, ctx);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const response = await route(request, env, ctx);
    return applySecurityHeaders(response);
  },
};
