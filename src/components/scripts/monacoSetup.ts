import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { loader } from '@monaco-editor/react';

/**
 * Monaco loader 与 Web Worker 初始化（普通编辑器 / diff 编辑器共享）。
 *   - loader 强制使用本地 monaco-editor 包，绕开 CDN，兼容 CSP `default-src 'self'`
 *   - Vite 通过 ?worker 语法把每个 worker 编译成独立 chunk，按需懒加载
 */
let configured = false;
export function configureMonacoLoaderOnce(): void {
  if (configured) return;
  configured = true;

  (self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      switch (label) {
        case 'json':
          return new JsonWorker();
        case 'css':
        case 'scss':
        case 'less':
          return new CssWorker();
        case 'html':
        case 'handlebars':
        case 'razor':
          return new HtmlWorker();
        case 'typescript':
        case 'javascript':
          return new TsWorker();
        default:
          return new EditorWorker();
      }
    },
  };

  loader.config({ monaco });
}

// 把脚本库的语言别名映射为 monaco 支持的名字
const LANGUAGE_ALIAS: Record<string, string> = {
  text: 'plaintext',
  bash: 'shell',
  zsh: 'shell',
  sh: 'shell',
  jsx: 'javascript',
  js: 'javascript',
  tsx: 'typescript',
  ts: 'typescript',
  rs: 'rust',
  py: 'python',
  rb: 'ruby',
  kt: 'kotlin',
  yml: 'yaml',
  md: 'markdown',
  docker: 'dockerfile',
  ps1: 'powershell',
  'c++': 'cpp',
  cs: 'csharp',
};

export function normalizeMonacoLanguage(lang?: string): string {
  if (!lang) return 'plaintext';
  const l = lang.toLowerCase().trim();
  return LANGUAGE_ALIAS[l] || l;
}

/**
 * 监听 <html class="dark"> 切换 Monaco 主题。
 * 返回当前主题 + 注册卸载函数的钩子接口（避免每个组件重复实现）。
 */
export function getInitialMonacoTheme(): 'vs' | 'vs-dark' {
  if (typeof document === 'undefined') return 'vs';
  return document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs';
}

export function observeMonacoTheme(cb: (theme: 'vs' | 'vs-dark') => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const observer = new MutationObserver(() => {
    cb(document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs');
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
  return () => observer.disconnect();
}
