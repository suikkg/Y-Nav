import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  RotateCcw,
  Loader2,
  Clock,
  Eye,
  GitCompareArrows,
  Columns2,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { ScriptSnippet, ScriptSnippetRevision } from '../../types';
import { getRevision, listRevisions, restoreRevision } from '../../services/snippetService';
import CodeBlock from './CodeBlock';
import MonacoDiffEditor from './MonacoDiffEditor';

interface SnippetHistoryModalProps {
  snippet: ScriptSnippet;
  onClose: () => void;
  onRestored: (restored: ScriptSnippet) => void;
}

/** 当前版本（合成项）的虚拟 id — 必须不与真实 revision id 冲突 */
const CURRENT_REV_ID = -1;

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

  // 单视图模式：只用 selectedRevId；对比模式：用 baseRevId / compareRevId
  const [compareMode, setCompareMode] = useState(false);
  const [selectedRevId, setSelectedRevId] = useState<number | null>(null);
  const [baseRevId, setBaseRevId] = useState<number | null>(null);
  const [compareRevId, setCompareRevId] = useState<number | null>(null);
  const [sideBySide, setSideBySide] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 版本内容缓存：id -> revision；-1 用 snippet
  const [revisionCache, setRevisionCache] = useState<Map<number, ScriptSnippetRevision>>(
    () => new Map(),
  );
  const [loadingIds, setLoadingIds] = useState<Set<number>>(() => new Set());
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
        if (rs.length > 0) {
          setSelectedRevId(rs[0].id);
          // 对比模式默认值：base = 最旧的（rs[-1]，因为列表按新→旧），compare = 当前版本
          setBaseRevId(rs[rs.length - 1].id);
          setCompareRevId(CURRENT_REV_ID);
        } else {
          setSelectedRevId(CURRENT_REV_ID);
          setBaseRevId(CURRENT_REV_ID);
          setCompareRevId(CURRENT_REV_ID);
        }
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

  // 按需加载某个版本内容
  const ensureRevisionLoaded = useCallback(
    (revId: number | null) => {
      if (revId === null || revId === CURRENT_REV_ID) return;
      if (revisionCache.has(revId)) return;
      setLoadingIds((prev) => {
        if (prev.has(revId)) return prev;
        const next = new Set(prev);
        next.add(revId);
        return next;
      });
      getRevision(snippet.id, revId)
        .then((rev) => {
          setRevisionCache((prev) => {
            const next = new Map(prev);
            next.set(revId, rev);
            return next;
          });
        })
        .catch(() => {
          /* 静默失败 — UI 显示"加载失败" */
        })
        .finally(() => {
          setLoadingIds((prev) => {
            if (!prev.has(revId)) return prev;
            const next = new Set(prev);
            next.delete(revId);
            return next;
          });
        });
    },
    [snippet.id, revisionCache],
  );

  // 选中变化时触发懒加载
  useEffect(() => {
    if (compareMode) {
      ensureRevisionLoaded(baseRevId);
      ensureRevisionLoaded(compareRevId);
    } else {
      ensureRevisionLoaded(selectedRevId);
    }
  }, [compareMode, selectedRevId, baseRevId, compareRevId, ensureRevisionLoaded]);

  // Esc 关闭
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose]);

  const handleRestore = useCallback(async () => {
    if (selectedRevId === null || selectedRevId === CURRENT_REV_ID) return;
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

  /** 用 id 取代码 / 语言。-1 返回当前 snippet，未加载完毕返回 null */
  const lookupCode = (id: number | null): { code: string; language: string } | null => {
    if (id === null) return null;
    if (id === CURRENT_REV_ID) return { code: snippet.code, language: snippet.language };
    const rev = revisionCache.get(id);
    if (!rev) return null;
    return { code: rev.code, language: rev.language };
  };

  const baseEntry = compareMode ? lookupCode(baseRevId) : null;
  const compareEntry = compareMode ? lookupCode(compareRevId) : null;
  const singleEntry = !compareMode ? lookupCode(selectedRevId) : null;
  const compareLoading =
    compareMode &&
    ((baseRevId !== null && baseRevId !== CURRENT_REV_ID && loadingIds.has(baseRevId)) ||
      (compareRevId !== null && compareRevId !== CURRENT_REV_ID && loadingIds.has(compareRevId)));
  const singleLoading =
    !compareMode &&
    selectedRevId !== null &&
    selectedRevId !== CURRENT_REV_ID &&
    loadingIds.has(selectedRevId);

  const handleToggleCompare = () => {
    setCompareMode((prev) => !prev);
  };

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm ${
        isFullscreen || compareMode ? 'p-0 sm:p-2' : 'p-4'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="版本历史"
    >
      <div
        ref={containerRef}
        className={`flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden ${
          isFullscreen
            ? 'w-full h-full max-w-none max-h-none rounded-none sm:rounded-2xl'
            : compareMode
              ? 'w-full max-w-[1600px] h-[96vh] max-h-[96vh] rounded-2xl'
              : 'w-full max-w-6xl max-h-[92vh] rounded-2xl'
        }`}
      >
        <div className="flex items-center justify-between px-6 py-3 border-b border-slate-100 dark:border-slate-800/60">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">版本历史</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {snippet.title} · {summary}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={handleToggleCompare}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                compareMode
                  ? 'bg-accent text-white hover:bg-accent/90'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              title={compareMode ? '退出对比' : '对比两个版本'}
              disabled={!revisions || revisions.length === 0}
            >
              <GitCompareArrows size={13} />
              {compareMode ? '退出对比' : '对比版本'}
            </button>
            {compareMode && (
              <button
                type="button"
                onClick={() => setSideBySide((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title={sideBySide ? '切换为统一视图' : '切换为双栏视图'}
              >
                <Columns2 size={13} />
                {sideBySide ? '统一视图' : '双栏视图'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsFullscreen((v) => !v)}
              className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label={isFullscreen ? '退出全屏' : '全屏'}
              title={isFullscreen ? '退出全屏' : '全屏'}
            >
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="关闭"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {loadError && (
          <div className="px-6 py-2 text-xs text-red-600 dark:text-red-400 border-b border-red-100 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20">
            {loadError}
          </div>
        )}

        {compareMode && (
          <div className="px-6 py-1.5 text-[11px] text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800/60 bg-slate-50 dark:bg-slate-900/40 flex items-center gap-1.5 shrink-0">
            点击版本旁的
            <span className="inline-block px-1 py-px rounded bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-300 font-semibold">
              原
            </span>
            /
            <span className="inline-block px-1 py-px rounded bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300 font-semibold">
              新
            </span>
            选两个版本对比
          </div>
        )}

        <div className="flex-1 grid grid-cols-1 md:grid-cols-[280px_1fr] min-h-0">
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
                <RevisionRow
                  isCurrent
                  id={CURRENT_REV_ID}
                  title="当前版本"
                  subtitle={formatDateTime(snippet.updatedAt)}
                  compareMode={compareMode}
                  selectedRevId={selectedRevId}
                  baseRevId={baseRevId}
                  compareRevId={compareRevId}
                  onSelect={setSelectedRevId}
                  onSetBase={setBaseRevId}
                  onSetCompare={setCompareRevId}
                />
                {revisions.map((rev) => (
                  <RevisionRow
                    key={rev.id}
                    id={rev.id}
                    title={rev.title}
                    subtitle={formatDateTime(rev.createdAt)}
                    compareMode={compareMode}
                    selectedRevId={selectedRevId}
                    baseRevId={baseRevId}
                    compareRevId={compareRevId}
                    onSelect={setSelectedRevId}
                    onSetBase={setBaseRevId}
                    onSetCompare={setCompareRevId}
                  />
                ))}
              </ul>
            )}
          </aside>

          {/* 详情预览 */}
          <main className="overflow-hidden flex flex-col bg-slate-50 dark:bg-slate-950">
            {compareMode ? (
              compareLoading ? (
                <div className="flex-1 flex items-center justify-center text-slate-400">
                  <Loader2 size={18} className="animate-spin" />
                </div>
              ) : baseEntry && compareEntry ? (
                <div className="flex-1 min-h-0">
                  <MonacoDiffEditor
                    original={baseEntry.code}
                    modified={compareEntry.code}
                    originalLanguage={baseEntry.language}
                    modifiedLanguage={compareEntry.language}
                    renderSideBySide={sideBySide}
                    height="100%"
                  />
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-sm text-slate-400">
                  请选择两个版本以查看差异
                </div>
              )
            ) : (
              <div className="flex-1 overflow-y-auto p-4 md:p-6">
                {singleLoading ? (
                  <div className="flex items-center justify-center py-12 text-slate-400">
                    <Loader2 size={18} className="animate-spin" />
                  </div>
                ) : singleEntry ? (
                  <CodeBlock
                    code={singleEntry.code}
                    language={singleEntry.language}
                    showLineNumbers
                  />
                ) : (
                  <div className="text-sm text-slate-400 text-center py-12">请选择一个版本</div>
                )}
              </div>
            )}
          </main>
        </div>

        <div
          className={`border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-between gap-3 ${
            compareMode ? 'px-6 py-2' : 'px-6 py-4'
          }`}
        >
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {compareMode
              ? '对比模式下不可执行恢复，请退出对比再操作'
              : '恢复操作会把当前版本备份成新的历史版本'}
          </p>
          <div className="flex items-center gap-2 shrink-0">
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
                compareMode ||
                selectedRevId === null ||
                selectedRevId === CURRENT_REV_ID ||
                restoring ||
                !singleEntry
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

// ============================================
// 版本列表行（单独组件，避免主体太长）
// ============================================

interface RevisionRowProps {
  id: number;
  title: string;
  subtitle: string;
  isCurrent?: boolean;
  compareMode: boolean;
  selectedRevId: number | null;
  baseRevId: number | null;
  compareRevId: number | null;
  onSelect: (id: number) => void;
  onSetBase: (id: number) => void;
  onSetCompare: (id: number) => void;
}

const RevisionRow: React.FC<RevisionRowProps> = ({
  id,
  title,
  subtitle,
  isCurrent,
  compareMode,
  selectedRevId,
  baseRevId,
  compareRevId,
  onSelect,
  onSetBase,
  onSetCompare,
}) => {
  const isBase = baseRevId === id;
  const isCompare = compareRevId === id;
  const isSelectedSingle = selectedRevId === id;

  // 单视图模式：整行作为按钮
  if (!compareMode) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onSelect(id)}
          className={`w-full text-left px-4 py-3 transition-colors ${
            isSelectedSingle
              ? 'bg-accent/10 dark:bg-accent/20'
              : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
          }`}
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            {isCurrent && <Eye size={11} className="text-accent" />}
            <span
              className={`text-xs ${
                isCurrent
                  ? 'font-semibold text-slate-900 dark:text-slate-100'
                  : 'font-medium text-slate-900 dark:text-slate-100'
              } truncate`}
            >
              {title}
            </span>
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400">{subtitle}</div>
        </button>
      </li>
    );
  }

  // 对比模式：左侧文本 + 右侧 [原][新] 切换
  return (
    <li
      className={`px-4 py-3 transition-colors ${
        isBase || isCompare
          ? 'bg-accent/5 dark:bg-accent/10'
          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            {isCurrent && <Eye size={11} className="text-accent shrink-0" />}
            <span className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
              {title}
            </span>
          </div>
          <div className="text-[10px] text-slate-500 dark:text-slate-400">{subtitle}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onSetBase(id)}
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors ${
              isBase
                ? 'bg-rose-500 text-white border-rose-500'
                : 'bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-300 border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-900/30'
            }`}
            title="设为对比的'原版'"
          >
            原
          </button>
          <button
            type="button"
            onClick={() => onSetCompare(id)}
            className={`px-1.5 py-0.5 rounded text-[10px] font-bold border transition-colors ${
              isCompare
                ? 'bg-emerald-500 text-white border-emerald-500'
                : 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-900/30'
            }`}
            title="设为对比的'新版'"
          >
            新
          </button>
        </div>
      </div>
    </li>
  );
};

export default SnippetHistoryModal;
