import React, { Suspense, lazy, useEffect } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useDialog } from '../ui/DialogProvider';
import ScriptsLogin from './ScriptsLogin';
import SnippetList from './SnippetList';
import SnippetViewer from './SnippetViewer';
import BatchActionBar from './BatchActionBar';
import ScriptsVaultHeader from './ScriptsVaultHeader';
import ScriptsVaultFilters from './ScriptsVaultFilters';
import { useScriptsVaultData } from './useScriptsVaultData';

// 懒加载：仅在用户触发对应交互时拉取 Monaco / 历史 / 分享 bundle
const SnippetEditor = lazy(() => import('./SnippetEditor'));
const SnippetHistoryModal = lazy(() => import('./SnippetHistoryModal'));
const SnippetShareModal = lazy(() => import('./SnippetShareModal'));

/**
 * 进入脚本库后，浏览器空闲时把 Monaco 相关 bundle（编辑器 + diff 编辑器）
 * 预拉到缓存。首次点击「编辑」/「历史」就不再卡顿。
 */
function prefetchMonacoBundles(): void {
  void import('./SnippetEditor');
  void import('./SnippetHistoryModal');
  // monacoSetup 在 SnippetEditor / SnippetHistoryModal 内被引用，但显式再拉一次
  // 避免 chunk graph 把 Monaco 切到次级子图后仍需 round-trip
  void import('./MonacoCodeEditor');
  void import('./MonacoDiffEditor');
}

const Fallback: React.FC<{ label: string }> = ({ label }) => (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
    <div className="rounded-2xl bg-white dark:bg-slate-900 px-6 py-5 flex items-center gap-3 shadow-2xl">
      <Loader2 size={18} className="animate-spin text-accent" />
      <span className="text-sm text-slate-600 dark:text-slate-300">{label}</span>
    </div>
  </div>
);

const ScriptsVault: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const { notify } = useDialog();
  const data = useScriptsVaultData();

  // 浏览器空闲时预拉 Monaco bundles，避免首次点编辑/历史时卡顿
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof w.requestIdleCallback === 'function') {
      const handle = w.requestIdleCallback(prefetchMonacoBundles, { timeout: 3000 });
      return () => w.cancelIdleCallback?.(handle);
    }
    const t = setTimeout(prefetchMonacoBundles, 800);
    return () => clearTimeout(t);
  }, []);

  if (!data.sessionState) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Loader2 size={20} className="animate-spin text-slate-400" />
      </div>
    );
  }

  if (!data.sessionState.authenticated) {
    return <ScriptsLogin onLoggedIn={data.handleLoggedIn} onBack={onExit} />;
  }

  const {
    loading,
    filtered,
    selected,
    selectedId,
    setSelectedId,
    mobileView,
    setMobileView,
    view,
    query,
    snippets,
    editorState,
    setEditorState,
    historyFor,
    setHistoryFor,
    shareFor,
    setShareFor,
    selectionMode,
    selectedSet,
    setSelectedSet,
    batchBusy,
    toggleSelect,
    exitSelectionMode,
    handleDelete,
    handleRestore,
    handlePermanentDelete,
    handleUpdate,
    handleCreate,
    handleBatchDelete,
    handleBatchSetFavorite,
    handleBatchAddTag,
    setSnippets,
    importProgress,
  } = data;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <ScriptsVaultHeader data={data} onExit={onExit} />
      <ScriptsVaultFilters data={data} />

      <div className="flex-1 grid grid-cols-1 md:grid-cols-[320px_1fr] min-h-0">
        <aside
          className={`md:border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 min-h-0 ${
            mobileView === 'detail' ? 'hidden md:block' : 'block'
          }`}
        >
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 size={20} className="animate-spin" />
            </div>
          ) : (
            <SnippetList
              snippets={filtered}
              selectedId={selectedId}
              onSelect={(s) => {
                setSelectedId(s.id);
                setMobileView('detail');
              }}
              highlightQuery={query}
              selectionMode={selectionMode}
              selectedSet={selectedSet}
              onToggleSelect={toggleSelect}
            />
          )}
        </aside>

        <main
          className={`bg-slate-50 dark:bg-slate-950 overflow-hidden ${
            mobileView === 'list' ? 'hidden md:block' : 'block'
          }`}
        >
          {selected ? (
            <SnippetViewer
              snippet={selected}
              mode={view}
              onEdit={() => setEditorState({ mode: 'edit', snippet: selected })}
              onDelete={() => handleDelete(selected.id)}
              onRestore={() => handleRestore(selected.id)}
              onPermanentDelete={() => handlePermanentDelete(selected.id)}
              onShowHistory={() => setHistoryFor(selected)}
              onShare={() => setShareFor(selected)}
              onBackToList={() => setMobileView('list')}
              highlightQuery={query}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center px-6 py-16 text-slate-400 dark:text-slate-500">
              {view === 'trash' ? (
                <>
                  <Trash2 size={32} className="mb-3 opacity-60" />
                  <p className="text-sm">
                    {snippets.length === 0 ? '回收站为空' : '从左侧选择一个脚本'}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm mb-3">
                    {snippets.length === 0
                      ? '还没有脚本，点击右上角「新建」开始'
                      : '从左侧选择一个脚本查看详情'}
                  </p>
                  <button
                    type="button"
                    onClick={() => setEditorState({ mode: 'create' })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent text-white text-sm font-semibold shadow-sm hover:bg-accent/90 transition-colors"
                  >
                    <Plus size={14} />
                    新建脚本
                  </button>
                </>
              )}
            </div>
          )}
        </main>
      </div>

      {editorState && (
        <Suspense fallback={<Fallback label="加载编辑器..." />}>
          <SnippetEditor
            initial={editorState.mode === 'edit' ? editorState.snippet : null}
            onCancel={() => setEditorState(null)}
            onSubmit={async (input) => {
              if (editorState.mode === 'edit') {
                await handleUpdate(editorState.snippet.id, input);
              } else {
                await handleCreate(input);
              }
            }}
          />
        </Suspense>
      )}

      {historyFor && (
        <Suspense fallback={<Fallback label="加载历史..." />}>
          <SnippetHistoryModal
            snippet={historyFor}
            onClose={() => setHistoryFor(null)}
            onRestored={(restored) => {
              setSnippets((prev) => {
                const next = prev.filter((s) => s.id !== restored.id);
                return [restored, ...next];
              });
              setSelectedId(restored.id);
              setHistoryFor(null);
              notify('已恢复到该版本', 'success');
            }}
          />
        </Suspense>
      )}

      {shareFor && (
        <Suspense fallback={<Fallback label="加载..." />}>
          <SnippetShareModal
            snippet={shareFor}
            onClose={() => setShareFor(null)}
            onUpdated={(next) => {
              setSnippets((prev) => prev.map((s) => (s.id === next.id ? next : s)));
              setShareFor(next);
            }}
          />
        </Suspense>
      )}

      {selectionMode && (
        <BatchActionBar
          selectedCount={selectedSet.size}
          totalCount={filtered.length}
          busy={batchBusy}
          onSelectAll={() => setSelectedSet(new Set(filtered.map((s) => s.id)))}
          onClear={exitSelectionMode}
          onBatchDelete={handleBatchDelete}
          onBatchSetFavorite={handleBatchSetFavorite}
          onBatchAddTag={handleBatchAddTag}
        />
      )}

      {importProgress && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="rounded-2xl bg-white dark:bg-slate-900 shadow-2xl px-6 py-5 min-w-[260px] max-w-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">
              <Loader2 size={16} className="animate-spin text-accent" />
              正在导入...
            </div>
            <div className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-accent transition-all"
                style={{
                  width: `${Math.round((importProgress.done / importProgress.total) * 100)}%`,
                }}
              />
            </div>
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 flex justify-between">
              <span>
                {importProgress.done} / {importProgress.total}
              </span>
              {importProgress.failed > 0 && (
                <span className="text-red-500">失败 {importProgress.failed}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScriptsVault;
