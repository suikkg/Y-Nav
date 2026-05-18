import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, RotateCcw, Loader2, Clock, Eye } from 'lucide-react';
import { ScriptSnippet, ScriptSnippetRevision } from '../../types';
import { getRevision, listRevisions, restoreRevision } from '../../services/snippetService';
import CodeBlock from './CodeBlock';

interface SnippetHistoryModalProps {
  snippet: ScriptSnippet;
  onClose: () => void;
  onRestored: (restored: ScriptSnippet) => void;
}

function formatDateTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const SnippetHistoryModal: React.FC<SnippetHistoryModalProps> = ({
  snippet,
  onClose,
  onRestored,
}) => {
  const [revisions, setRevisions] = useState<ScriptSnippetRevision[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRevId, setSelectedRevId] = useState<number | null>(null);
  const [activeRevision, setActiveRevision] = useState<ScriptSnippetRevision | null>(null);
  const [loadingRev, setLoadingRev] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 加载版本列表
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    listRevisions(snippet.id)
      .then((rs) => {
        if (cancelled) return;
        setRevisions(rs);
        if (rs.length > 0) setSelectedRevId(rs[0].id);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setLoadError(e.message || '加载历史失败');
        setRevisions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [snippet.id]);

  // 加载选中版本的详情
  useEffect(() => {
    if (selectedRevId === null) {
      setActiveRevision(null);
      return;
    }
    let cancelled = false;
    setLoadingRev(true);
    getRevision(snippet.id, selectedRevId)
      .then((rev) => {
        if (!cancelled) setActiveRevision(rev);
      })
      .catch(() => {
        if (!cancelled) setActiveRevision(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingRev(false);
      });
    return () => {
      cancelled = true;
    };
  }, [snippet.id, selectedRevId]);

  // Esc 关闭
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose]);

  const handleRestore = useCallback(async () => {
    if (selectedRevId === null) return;
    setRestoring(true);
    try {
      const restored = await restoreRevision(snippet.id, selectedRevId);
      onRestored(restored);
      onClose();
    } catch (e) {
      setLoadError((e as Error).message || '恢复失败');
    } finally {
      setRestoring(false);
    }
  }, [selectedRevId, snippet.id, onRestored, onClose]);

  const summary = useMemo(() => {
    if (!revisions) return '加载中...';
    if (revisions.length === 0) return '尚无历史版本';
    return `${revisions.length} 个历史版本`;
  }, [revisions]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="版本历史"
    >
      <div
        ref={containerRef}
        className="w-full max-w-5xl max-h-[92vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800/60">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">版本历史</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {snippet.title} · {summary}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        {loadError && (
          <div className="px-6 py-2 text-xs text-red-600 dark:text-red-400 border-b border-red-100 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20">
            {loadError}
          </div>
        )}

        <div className="flex-1 grid grid-cols-1 md:grid-cols-[260px_1fr] min-h-0">
          {/* 版本列表 */}
          <aside className="border-b md:border-b-0 md:border-r border-slate-100 dark:border-slate-800/60 overflow-y-auto max-h-56 md:max-h-none">
            {revisions === null ? (
              <div className="flex items-center justify-center py-10 text-slate-400">
                <Loader2 size={18} className="animate-spin" />
              </div>
            ) : revisions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400 dark:text-slate-500">
                <Clock size={28} className="mb-2 opacity-60" />
                <p className="text-xs">还没有保存过历史版本</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {/* 当前版本（合成项） */}
                <li>
                  <button
                    type="button"
                    onClick={() => setSelectedRevId(-1)}
                    className={`w-full text-left px-4 py-3 transition-colors ${
                      selectedRevId === -1
                        ? 'bg-accent/10 dark:bg-accent/20'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <Eye size={11} className="text-accent" />
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        当前版本
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                      {formatDateTime(snippet.updatedAt)}
                    </div>
                  </button>
                </li>
                {revisions.map((rev) => (
                  <li key={rev.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedRevId(rev.id)}
                      className={`w-full text-left px-4 py-3 transition-colors ${
                        selectedRevId === rev.id
                          ? 'bg-accent/10 dark:bg-accent/20'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate mb-0.5">
                        {rev.title}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">
                        {formatDateTime(rev.createdAt)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          {/* 详情预览 */}
          <main className="overflow-y-auto p-4 md:p-6 bg-slate-50 dark:bg-slate-950">
            {selectedRevId === -1 ? (
              <CodeBlock code={snippet.code} language={snippet.language} showLineNumbers />
            ) : loadingRev ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <Loader2 size={18} className="animate-spin" />
              </div>
            ) : activeRevision ? (
              <CodeBlock
                code={activeRevision.code}
                language={activeRevision.language}
                showLineNumbers
              />
            ) : (
              <div className="text-sm text-slate-400 text-center py-12">请选择一个版本</div>
            )}
          </main>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            恢复操作会把当前版本备份成新的历史版本
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              关闭
            </button>
            <button
              type="button"
              disabled={
                selectedRevId === null || selectedRevId === -1 || restoring || !activeRevision
              }
              onClick={handleRestore}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold shadow-sm hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {restoring ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              恢复此版本
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SnippetHistoryModal;
