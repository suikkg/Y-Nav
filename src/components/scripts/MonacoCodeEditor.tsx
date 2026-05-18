import React, { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { Editor, loader } from '@monaco-editor/react';

/**
 * Monaco loader 与 Web Worker 初始化。
 *   - loader 强制使用本地 monaco-editor 包，绕开 CDN，兼容 CSP `default-src 'self'`
 *   - Vite 通过 ?worker 语法把每个 worker 编译成独立 chunk，按需懒加载
 */
let configured = false;
function configureLoaderOnce() {
  if (configured) return;
  configured = true;

  // 配置 Monaco Workers
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

function normalizeLanguage(lang?: string): string {
  if (!lang) return 'plaintext';
  const l = lang.toLowerCase().trim();
  return LANGUAGE_ALIAS[l] || l;
}

interface MonacoCodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  height?: string | number;
  /** 触发于编辑器内 ⌘/Ctrl+S */
  onSave?: () => void;
  /** 自动聚焦 */
  autoFocus?: boolean;
}

const MonacoCodeEditor: React.FC<MonacoCodeEditorProps> = ({
  value,
  onChange,
  language,
  height = 380,
  onSave,
  autoFocus = false,
}) => {
  configureLoaderOnce();

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // 主题跟随 <html class="dark">
  const [theme, setTheme] = useState<'vs' | 'vs-dark'>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'vs-dark'
      : 'vs',
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs');
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  const handleMount = (editor: monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSaveRef.current?.();
    });
    if (autoFocus) editor.focus();
  };

  return (
    <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
      <Editor
        value={value}
        onChange={(v) => onChange(v ?? '')}
        language={normalizeLanguage(language)}
        theme={theme}
        height={height}
        onMount={handleMount}
        loading={
          <div className="flex items-center justify-center h-full text-sm text-slate-400">
            加载编辑器...
          </div>
        }
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          tabSize: 2,
          automaticLayout: true,
          scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
          renderLineHighlight: 'gutter',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, "Courier New", monospace',
        }}
      />
    </div>
  );
};

export default MonacoCodeEditor;
