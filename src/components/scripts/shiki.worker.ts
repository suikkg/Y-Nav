/**
 * Shiki 在 Web Worker 里运行
 *
 * 背景：shiki 的 JS 正则引擎是同步 tokenize，1000+ 行 Python 在主线程要 ~800ms，
 * 一个 1MB 的 minified bundle 能跑到 ~10s —— 期间 UI 完全冻住、滚动也停。
 * 搬进 worker 后主线程只负责 postMessage / setHighlightedHtml，
 * 大代码 tokenize 不再阻塞渲染、滚动、查找输入。
 *
 * 协议:
 *   主线程  -> { id, code, lang }
 *   worker -> { id, html }                // 成功
 *   worker -> { id, html: null }          // 语言不支持 / 加载失败，主线程回退 plainHtml
 */

import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

const THEME_LIGHT = 'vitesse-light';
const THEME_DARK = 'vitesse-dark';

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

let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>();
const langLoading = new Map<string, Promise<boolean>>();

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const [light, dark] = await Promise.all([
        import('@shikijs/themes/vitesse-light'),
        import('@shikijs/themes/vitesse-dark'),
      ]);
      return createHighlighterCore({
        themes: [light.default, dark.default],
        langs: [],
        engine: createJavaScriptRegexEngine(),
      });
    })();
  }
  return highlighterPromise;
}

async function ensureLang(hi: HighlighterCore, lang: string): Promise<boolean> {
  if (loadedLangs.has(lang)) return true;
  const loader = loaders[lang];
  if (!loader) return false;
  const existing = langLoading.get(lang);
  if (existing) return existing;
  const task = (async () => {
    try {
      const mod = await loader();
      await hi.loadLanguage((mod as { default: unknown }).default as never);
      loadedLangs.add(lang);
      return true;
    } catch {
      return false;
    } finally {
      langLoading.delete(lang);
    }
  })();
  langLoading.set(lang, task);
  return task;
}

interface RequestMsg {
  id: number;
  code: string;
  lang: string;
}

self.onmessage = async (e: MessageEvent<RequestMsg>) => {
  const { id, code, lang } = e.data;
  try {
    const hi = await getHighlighter();
    const ok = await ensureLang(hi, lang);
    if (!ok) {
      (self as unknown as Worker).postMessage({ id, html: null });
      return;
    }
    const html = hi.codeToHtml(code, {
      lang,
      themes: { light: THEME_LIGHT, dark: THEME_DARK },
      defaultColor: false,
    });
    (self as unknown as Worker).postMessage({ id, html });
  } catch {
    (self as unknown as Worker).postMessage({ id, html: null });
  }
};
