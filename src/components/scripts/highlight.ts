/**
 * Shiki 语法高亮（VS Code 同款 TextMate 引擎，JS Regex 版，免 WASM）
 *
 * 设计要点：
 *   - 用 `shiki/core` + `shiki/engine/javascript` 自建 highlighter，按需 import 语法包
 *   - 双主题 vitesse-light / vitesse-dark，`defaultColor: false` 让 shiki 写入
 *     `--shiki-light` / `--shiki-dark` CSS 变量；亮/暗切换由 `code-theme.css`
 *     里的 `html.dark` 选择器控制（与项目的 dark mode 策略保持一致）
 *   - 输出剥离最外层 `<pre><code>`，仅返回 `<span class="line">…</span>` 链，
 *     交给 `CodeBlock.tsx` 用自家容器渲染（保留圆角 / 滚动 / 最大高度等样式）
 */

import type { HighlighterCore } from 'shiki/core';

const THEME_LIGHT = 'vitesse-light';
const THEME_DARK = 'vitesse-dark';

/**
 * 语言 → 动态 import loader。Shiki 把每种语言切成独立 chunk，
 * 首屏只加载核心 + 引擎，使用时再拉对应语法。
 */
const loaders: Record<string, () => Promise<unknown>> = {
  bash: () => import('@shikijs/langs/bash'),
  shell: () => import('@shikijs/langs/shell'),
  python: () => import('@shikijs/langs/python'),
  javascript: () => import('@shikijs/langs/javascript'),
  typescript: () => import('@shikijs/langs/typescript'),
  go: () => import('@shikijs/langs/go'),
  rust: () => import('@shikijs/langs/rust'),
  java: () => import('@shikijs/langs/java'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  php: () => import('@shikijs/langs/php'),
  ruby: () => import('@shikijs/langs/ruby'),
  sql: () => import('@shikijs/langs/sql'),
  json: () => import('@shikijs/langs/json'),
  yaml: () => import('@shikijs/langs/yaml'),
  ini: () => import('@shikijs/langs/ini'),
  toml: () => import('@shikijs/langs/toml'),
  xml: () => import('@shikijs/langs/xml'),
  html: () => import('@shikijs/langs/html'),
  css: () => import('@shikijs/langs/css'),
  markdown: () => import('@shikijs/langs/markdown'),
  dockerfile: () => import('@shikijs/langs/dockerfile'),
  nginx: () => import('@shikijs/langs/nginx'),
  lua: () => import('@shikijs/langs/lua'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  swift: () => import('@shikijs/langs/swift'),
  powershell: () => import('@shikijs/langs/powershell'),
};

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
  if (normalized in loaders) return normalized;
  if (normalized in aliases) {
    const target = aliases[normalized];
    return target === 'plaintext' ? null : target;
  }
  return null;
}

// ============================================
// Highlighter 单例 + 语言按需加载
// ============================================

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>();
const langLoading = new Map<string, Promise<void>>();

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, light, dark] =
        await Promise.all([
          import('shiki/core'),
          import('shiki/engine/javascript'),
          import('@shikijs/themes/vitesse-light'),
          import('@shikijs/themes/vitesse-dark'),
        ]);
      return createHighlighterCore({
        themes: [light.default, dark.default],
        langs: [],
        engine: createJavaScriptRegexEngine(),
      });
    })().catch((err) => {
      // 失败时清掉缓存，下次调用重试
      highlighterPromise = null;
      throw err;
    });
  }
  return highlighterPromise;
}

export async function ensureLanguage(lang: string): Promise<string | null> {
  const canonical = resolveCanonical(lang);
  if (!canonical) return null;
  if (loadedLangs.has(canonical)) return canonical;

  const existing = langLoading.get(canonical);
  if (existing) {
    await existing;
    return loadedLangs.has(canonical) ? canonical : null;
  }

  const task = (async () => {
    const [hi, mod] = await Promise.all([getHighlighter(), loaders[canonical]()]);
    await hi.loadLanguage((mod as { default: unknown }).default as never);
    loadedLangs.add(canonical);
  })()
    .catch(() => {
      // 失败不抛，调用方回退到纯文本
    })
    .finally(() => {
      langLoading.delete(canonical);
    });

  langLoading.set(canonical, task);
  await task;
  return loadedLangs.has(canonical) ? canonical : null;
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
 * 用纯文本回退渲染（保留 `<span class="line">…</span>` 结构，
 * 让 CodeBlock 的行号 / 拷贝逻辑无感切换）。
 */
function plainHtml(code: string): string {
  return code
    .split('\n')
    .map((line) => `<span class="line">${escapePlain(line)}</span>`)
    .join('\n');
}

/**
 * 提取 shiki `codeToHtml` 输出的 `<code>` 内层内容，去掉外层 `<pre><code>` 包装。
 * 这样 CodeBlock 仍可用自家 `<pre>` 控制高度 / 圆角 / padding。
 */
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
 *   - 内部确保 highlighter + 对应语言已加载
 *   - 未识别 / 加载失败 → 回退到纯文本（也包成 line 结构）
 */
export async function highlightCodeAsync(
  code: string,
  language?: string,
): Promise<HighlightResult> {
  const requested = (language || '').toLowerCase().trim();

  try {
    const canonical = await ensureLanguage(requested);
    if (!canonical) {
      return { html: plainHtml(code), language: requested || 'text' };
    }
    const hi = await getHighlighter();
    const full = hi.codeToHtml(code, {
      lang: canonical,
      themes: { light: THEME_LIGHT, dark: THEME_DARK },
      defaultColor: false,
    });
    return { html: stripPreCode(full), language: canonical };
  } catch {
    return { html: plainHtml(code), language: requested || 'text' };
  }
}

/**
 * 已废弃的同步入口：保留导出避免老调用方破坏，
 * 直接返回 escape 后的纯文本（shiki 必须异步）。
 */
export function highlightCode(code: string, language?: string): HighlightResult {
  return { html: plainHtml(code), language: (language || '').toLowerCase().trim() || 'text' };
}
