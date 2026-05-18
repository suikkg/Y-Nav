import React, { useEffect, useState } from 'react';
import { FileCode2, Calendar, Clock, Loader2, AlertCircle, Sun, Moon } from 'lucide-react';
import { PublicSnippet } from '../../types';
import { getPublicSnippet } from '../../services/snippetService';
import CodeBlock from './CodeBlock';

interface PublicSnippetViewProps {
  token: string;
}

function formatDateTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DARK_KEY = 'ynav.publicShare.dark';

const PublicSnippetView: React.FC<PublicSnippetViewProps> = ({ token }) => {
  const [snippet, setSnippet] = useState<PublicSnippet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dark, setDark] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(DARK_KEY);
      if (stored === '1') return true;
      if (stored === '0') return false;
    } catch {
      // ignore
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem(DARK_KEY, dark ? '1' : '0');
    } catch {
      // ignore
    }
  }, [dark]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setSnippet(null);
    getPublicSnippet(token)
      .then((s) => {
        if (!cancelled) setSnippet(s);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || '链接无效或已失效');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header className="px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <FileCode2 size={16} className="text-accent" />
            <span className="text-sm font-semibold truncate">Y-Nav 分享脚本</span>
          </div>
          <button
            type="button"
            onClick={() => setDark((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="切换主题"
          >
            {dark ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </header>

      <main className="flex-1 px-4 sm:px-8 py-6 max-w-4xl w-full mx-auto">
        {error ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <AlertCircle size={36} className="text-red-400 mb-3" />
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">
              {error}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              请向分享者确认链接是否仍有效。
            </p>
          </div>
        ) : !snippet ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={20} className="animate-spin text-slate-400" />
          </div>
        ) : (
          <>
            <div className="mb-5">
              <h1 className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
                {snippet.title}
              </h1>
              {snippet.description && (
                <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-line mb-3">
                  {snippet.description}
                </p>
              )}
              <div className="flex items-center flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase tracking-wide">
                  {snippet.language || 'text'}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Calendar size={12} />
                  {formatDateTime(snippet.createdAt)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock size={12} />
                  {formatDateTime(snippet.updatedAt)}
                </span>
              </div>
            </div>
            <CodeBlock code={snippet.code} language={snippet.language} showLineNumbers />
          </>
        )}
      </main>

      <footer className="text-center text-xs text-slate-400 dark:text-slate-500 py-4 px-4 border-t border-slate-200 dark:border-slate-800">
        本链接由分享者生成 · 只读视图 · 撤销后立即失效
      </footer>
    </div>
  );
};

export default PublicSnippetView;
