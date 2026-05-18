import hljs from 'highlight.js/lib/core';

/**
 * 各语言按需动态 import。
 * 首屏只加载 hljs 核心（~10KB），用户打开某条脚本时再拉对应语言的语法包。
 */
const loaders: Record<string, () => Promise<{ default: unknown }>> = {
  bash: () => import('highlight.js/lib/languages/bash'),
  shell: () => import('highlight.js/lib/languages/shell'),
  python: () => import('highlight.js/lib/languages/python'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  go: () => import('highlight.js/lib/languages/go'),
  rust: () => import('highlight.js/lib/languages/rust'),
  java: () => import('highlight.js/lib/languages/java'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  php: () => import('highlight.js/lib/languages/php'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  sql: () => import('highlight.js/lib/languages/sql'),
  json: () => import('highlight.js/lib/languages/json'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  ini: () => import('highlight.js/lib/languages/ini'),
  xml: () => import('highlight.js/lib/languages/xml'),
  css: () => import('highlight.js/lib/languages/css'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  nginx: () => import('highlight.js/lib/languages/nginx'),
  lua: () => import('highlight.js/lib/languages/lua'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  swift: () => import('highlight.js/lib/languages/swift'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  plaintext: () => import('highlight.js/lib/languages/plaintext'),
};

/**
 * 别名 → 规范名。tagged input ("sh") 会映射到对应的 canonical 语言 ("bash") 再注册。
 */
const aliases: Record<string, string> = {
  sh: 'bash',
  zsh: 'bash',
  py: 'python',
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  rs: 'rust',
  'c++': 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  yml: 'yaml',
  toml: 'ini',
  html: 'xml',
  md: 'markdown',
  docker: 'dockerfile',
  kt: 'kotlin',
  ps1: 'powershell',
  text: 'plaintext',
};

const loaded = new Set<string>();
const loadingPromises = new Map<string, Promise<void>>();

function resolveCanonical(lang: string): string | null {
  const normalized = lang.toLowerCase().trim();
  if (!normalized) return null;
  if (normalized in loaders) return normalized;
  if (normalized in aliases) return aliases[normalized];
  return null;
}

/**
 * 异步确保某语言的语法包已加载并注册。返回的 Promise 在加载结束后 resolve；
 * 不识别的语言会立即 resolve 而不报错（fallback 到纯文本）。
 */
export async function ensureLanguage(lang: string): Promise<void> {
  const canonical = resolveCanonical(lang);
  if (!canonical) return;
  if (loaded.has(canonical)) return;
  const existing = loadingPromises.get(canonical);
  if (existing) return existing;

  const promise = loaders[canonical]()
    .then((mod) => {
      const def = mod.default;
      // @ts-expect-error - hljs 期望 LanguageFn，我们动态 import 拿到的是默认导出
      hljs.registerLanguage(canonical, def);
      loaded.add(canonical);
      for (const [alias, target] of Object.entries(aliases)) {
        if (target === canonical && !hljs.getLanguage(alias)) {
          // @ts-expect-error - 同上
          hljs.registerLanguage(alias, def);
        }
      }
    })
    .catch(() => {
      // 加载失败不抛，下一次再尝试
      loadingPromises.delete(canonical);
    });

  loadingPromises.set(canonical, promise);
  return promise;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 同步版本：仅使用已加载的语言，未加载时回退到纯文本。
 * 配合 ensureLanguage 使用：组件中先 await ensureLanguage(lang)，再调用此函数。
 */
export function highlightCode(code: string, language?: string): { html: string; language: string } {
  const lang = (language || '').toLowerCase().trim();
  if (lang && lang !== 'text' && lang !== 'plaintext' && hljs.getLanguage(lang)) {
    try {
      const result = hljs.highlight(code, { language: lang, ignoreIllegals: true });
      return { html: result.value, language: lang };
    } catch {
      // fall through
    }
  }
  return { html: escapeHtml(code), language: lang || 'text' };
}

// ============================================
// 长代码 (>50KB) 走 Web Worker 避免阻塞主线程
// ============================================

const WORKER_THRESHOLD_BYTES = 50_000;

let workerInstance: Worker | null = null;
let workerSetupFailed = false;
let workerCounter = 0;
const workerPending = new Map<number, (result: { html: string; language: string }) => void>();

function getHighlightWorker(): Worker | null {
  if (workerSetupFailed) return null;
  if (workerInstance) return workerInstance;
  try {
    const w = new Worker(new URL('./highlight-worker.ts', import.meta.url), { type: 'module' });
    w.addEventListener('message', (e: MessageEvent) => {
      const data = e.data as { id: number; result: { html: string; language: string } };
      const resolver = workerPending.get(data.id);
      if (resolver) {
        workerPending.delete(data.id);
        resolver(data.result);
      }
    });
    w.addEventListener('error', () => {
      workerSetupFailed = true;
      workerInstance = null;
    });
    workerInstance = w;
    return w;
  } catch {
    workerSetupFailed = true;
    return null;
  }
}

/**
 * 异步高亮：
 *   - 小代码 (<50KB): 走主线程，ensureLanguage + sync highlight
 *   - 长代码 (>=50KB): 调度到 Web Worker 中执行，避免阻塞 UI
 *   - Worker 不可用时优雅退化到主线程
 */
export async function highlightCodeAsync(
  code: string,
  language?: string,
): Promise<{ html: string; language: string }> {
  if (code.length >= WORKER_THRESHOLD_BYTES) {
    const worker = getHighlightWorker();
    if (worker) {
      const id = ++workerCounter;
      return new Promise((resolve) => {
        workerPending.set(id, resolve);
        worker.postMessage({ id, code, language });
      });
    }
  }
  if (language) await ensureLanguage(language);
  return highlightCode(code, language);
}
