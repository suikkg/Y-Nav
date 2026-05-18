import React from 'react';
import {
  ArrowLeft,
  CheckSquare,
  Download,
  FileCode2,
  LogOut,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { ScriptsVaultData } from './useScriptsVaultData';

interface Props {
  data: ScriptsVaultData;
  onExit: () => void;
}

const ScriptsVaultHeader: React.FC<Props> = ({ data, onExit }) => {
  const {
    view,
    setView,
    setSelectedId,
    setMobileView,
    refreshing,
    fetchSnippets,
    selectionMode,
    enterSelectionMode,
    exitSelectionMode,
    setEditorState,
    handleExport,
    filtered,
    fileInputRef,
    handleImportFile,
    handleLogout,
  } = data;

  return (
    <header className="px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onExit}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <ArrowLeft size={14} />
            返回
          </button>
          <h1 className="text-base sm:text-lg font-semibold truncate">脚本库</h1>
          <div className="hidden sm:flex items-center gap-1 ml-2 rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5">
            <button
              type="button"
              onClick={() => {
                if (view === 'active') return;
                setView('active');
                setSelectedId(null);
                setMobileView('list');
              }}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                view === 'active'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <FileCode2 size={12} />
              全部
            </button>
            <button
              type="button"
              onClick={() => {
                if (view === 'trash') return;
                setView('trash');
                setSelectedId(null);
                setMobileView('list');
              }}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                view === 'trash'
                  ? 'bg-white dark:bg-slate-900 text-red-600 dark:text-red-400 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <Trash2 size={12} />
              回收站
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchSnippets(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            disabled={refreshing}
            aria-label="刷新"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">刷新</span>
          </button>
          {view === 'active' && (
            <button
              type="button"
              onClick={() => (selectionMode ? exitSelectionMode() : enterSelectionMode())}
              aria-pressed={selectionMode}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm transition-colors ${
                selectionMode
                  ? 'bg-accent/15 text-accent'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              title="批量选择"
            >
              <CheckSquare size={14} />
              <span className="hidden sm:inline">{selectionMode ? '退出选择' : '选择'}</span>
            </button>
          )}
          {view === 'active' && !selectionMode && (
            <button
              type="button"
              onClick={() => setEditorState({ mode: 'create' })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent text-white text-sm font-semibold shadow-sm hover:bg-accent/90 transition-colors"
            >
              <Plus size={14} />
              <span className="hidden sm:inline">新建</span>
            </button>
          )}
          {view === 'active' && !selectionMode && (
            <>
              <button
                type="button"
                onClick={handleExport}
                disabled={filtered.length === 0}
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={`导出 ${filtered.length} 条`}
              >
                <Download size={14} />
                <span className="hidden md:inline">导出</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="导入 JSON"
              >
                <Upload size={14} />
                <span className="hidden md:inline">导入</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) await handleImportFile(file);
                }}
              />
            </>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="登出"
          >
            <LogOut size={14} />
            <span className="hidden sm:inline">登出</span>
          </button>
        </div>
      </div>
    </header>
  );
};

export default ScriptsVaultHeader;
