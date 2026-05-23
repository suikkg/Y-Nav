/**
 * Shiki 语法高亮（VS Code 同款 TextMate 引擎，JS Regex 版，免 WASM）
 *
 * 主线程在这里只负责：
 *   1) 解析语言别名 → canonical name
 *   2) 太大 / 太长行的代码直接走 plain fallback —— shiki 对超大 minified bundle
 *      的 tokenize 是秒级，搬进 worker 也救不了，所以预先放行
 *   3) 其余统一 postMessage 给 shiki worker，由 worker 异步返回 HTML
 *
 * 之所以要 worker：shiki 的 JS 正则引擎是 *同步* 跑完所有行，
 * 1000+ 行 Python 主线程要 ~800ms，期间 UI 整个冻住、查找框输入都没反应。
 * 移到 worker 后 plain text 立即上屏，coloring 后台跑完再覆盖。
 */

const THEME_LIGHT = 'vitesse-light';
const THEME_DARK = 'vitesse-dark';

/**
 * shiki worker 实际支持的语言。和 `shiki.worker.ts` 里的 `loaders` 同步维护。
 * 这里只用来做"是否走 worker"的判定；真正的语言模块在 worker 内 import。
 */
const knownLangs = new Set([
  'bash',
  'shell',
  'python',
  'javascript',
  'typescript',
  'go',
  'rust',
  'java',
  'c',
  'cpp',
  'csharp',
  'php',
  'ruby',
  'sql',
  'json',
  'yaml',
  'ini',
  'toml',
  'xml',
  'html',
  'css',
  'markdown',
  'dockerfile',
  'nginx',
  'lua',
  'kotlin',
  'swift',
  'powershell',
]);

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
  docker: 'dockerfile',
  kt: 'kotlin',
  ps1: 'powershell',
  text: 'plaintext',
  plain: 'plaintext',
};

function resolveCanonical(lang: string): string | null {
  const normalized = lang.toLowerCase().trim();
  if (!normalized || normalized === 'plaintext') return null;
  if (knownLangs.has(normalized)) return normalized;
  if (normalized in aliases) {
    const target = aliases[normalized];
    return target !== 'plaintext' && knownLangs.has(target) ? target : null;
  }
  return null;
}

// ============================================
// 太大 / minified 代码跳过 shiki
// ============================================
//
// 实测：一个 994KB / 47 行的 minified bundle，shiki 的 JS 正则引擎要 ~10s 才能
// tokenize 完。即便扔进 worker，10s 后才上色，用户感知到的还是"半天没出
// 高亮"。一旦命中下面任一阈值，直接 plain fallback，保证打开 < 100ms。
//
//   - MAX_HIGHLIGHT_CHARS: 整段代码总长度上限
//   - MAX_LINE_CHARS:      任意单行长度上限（专门抓 minified one-liner）

const MAX_HIGHLIGHT_CHARS = 250_000;
const MAX_LINE_CHARS = 8_000;

function isTooBigToHighlight(code: string): boolean {
  if (code.length > MAX_HIGHLIGHT_CHARS) return true;
  let cur = 0;
  for (let i = 0; i < code.length; i++) {
    if (code.charCodeAt(i) === 10) {
      if (cur > MAX_LINE_CHARS) return true;
      cur = 0;
    } else {
      cur++;
    }
  }
  return cur > MAX_LINE_CHARS;
}

// ============================================
// Worker 通信
// ============================================

interface WorkerResponse {
  id: number;
  html: string | null;
}

let worker: Worker | null = null;
let nextReqId = 0;
const pending = new Map<number, (html: string | null) => void>();

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null; // SSR / jsdom
  try {
    worker = new Worker(new URL('./shiki.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const { id, html } = e.data;
      const resolve = pending.get(id);
      if (resolve) {
        pending.delete(id);
        resolve(html);
      }
    };
    worker.onerror = () => {
      // worker 跪了：把所有等待中的请求喂 null，让 caller 走 plainHtml；
      // 下一次再 getWorker() 时会重建。
      pending.forEach((r) => r(null));
      pending.clear();
      try {
        worker?.terminate();
      } catch {
        // ignore
      }
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

function highlightInWorker(code: string, lang: string): Promise<string | null> {
  const w = getWorker();
  if (!w) return Promise.resolve(null);
  const id = ++nextReqId;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ id, code, lang });
  });
}

// ============================================
// 渲染
// ============================================

function escapePlain(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 纯文本回退：保留 `<span class="line">…</span>` 结构，让 CodeBlock 的行号 /
 * 拷贝逻辑跟着 shiki 路径走，避免两套布局。
 */
function plainHtml(code: string): string {
  return code
    .split('\n')
    .map((line) => `<span class="line">${escapePlain(line)}</span>`)
    .join('\n');
}

/** 剥掉 shiki `codeToHtml` 输出最外层 `<pre><code>` 包装。 */
function stripPreCode(html: string): string {
  const m = html.match(/<code[^>]*>([\s\S]*?)<\/code>/);
  return m ? m[1] : html;
}

export interface HighlightResult {
  html: string;
  language: string;
}

/**
 * 异步高亮：
 *   - 语言不支持 / 太大 / worker 不可用 → 全部走 plain fallback
 *   - 其余 postMessage 给 worker，由 worker 加载语法 + tokenize
 */
export async function highlightCodeAsync(
  code: string,
  language?: string,
): Promise<HighlightResult> {
  const requested = (language || '').toLowerCase().trim();
  const canonical = resolveCanonical(requested);
  if (!canonical) {
    return { html: plainHtml(code), language: requested || 'text' };
  }
  if (isTooBigToHighlight(code)) {
    return { html: plainHtml(code), language: canonical };
  }
  try {
    const html = await highlightInWorker(code, canonical);
    if (html == null) {
      return { html: plainHtml(code), language: canonical };
    }
    return { html: stripPreCode(html), language: canonical };
  } catch {
    return { html: plainHtml(code), language: canonical };
  }
}

/**
 * 同步入口（已废弃，但还有老调用方）：直接返回 plain，shiki 必须异步。
 */
export function highlightCode(code: string, language?: string): HighlightResult {
  return { html: plainHtml(code), language: (language || '').toLowerCase().trim() || 'text' };
}
