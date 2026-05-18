import React, { useState } from 'react';
import { Trash2, Star, StarOff, Tag, X, Loader2, CheckSquare } from 'lucide-react';

interface BatchActionBarProps {
  selectedCount: number;
  totalCount: number;
  busy?: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onBatchDelete: () => void;
  onBatchSetFavorite: (favorite: boolean) => void;
  onBatchAddTag: (tag: string) => void;
}

const BatchActionBar: React.FC<BatchActionBarProps> = ({
  selectedCount,
  totalCount,
  busy = false,
  onSelectAll,
  onClear,
  onBatchDelete,
  onBatchSetFavorite,
  onBatchAddTag,
}) => {
  const [tagInputOpen, setTagInputOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState('');

  const submitTag = () => {
    const tag = tagDraft.trim();
    if (!tag) return;
    onBatchAddTag(tag);
    setTagDraft('');
    setTagInputOpen(false);
  };

  return (
    <div className="fixed bottom-4 inset-x-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-40 max-w-2xl mx-auto">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-2xl px-4 py-3">
        <div className="flex items-center flex-wrap gap-2">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            已选 {selectedCount}
            <span className="text-slate-400 dark:text-slate-500 font-normal"> / {totalCount}</span>
          </span>

          <button
            type="button"
            onClick={onSelectAll}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <CheckSquare size={12} />
            全选
          </button>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-1" />

          {tagInputOpen ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitTag();
              }}
              className="inline-flex items-center gap-1"
            >
              <input
                autoFocus
                type="text"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                placeholder="新标签"
                className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs w-24 focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
              <button
                type="submit"
                disabled={busy || !tagDraft.trim()}
                className="px-2 py-1 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 disabled:opacity-50"
              >
                添加
              </button>
              <button
                type="button"
                onClick={() => {
                  setTagInputOpen(false);
                  setTagDraft('');
                }}
                className="p-1 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X size={12} />
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setTagInputOpen(true)}
              disabled={busy || selectedCount === 0}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              <Tag size={12} />
              加标签
            </button>
          )}

          <button
            type="button"
            onClick={() => onBatchSetFavorite(true)}
            disabled={busy || selectedCount === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 disabled:opacity-50"
          >
            <Star size={12} />
            加收藏
          </button>

          <button
            type="button"
            onClick={() => onBatchSetFavorite(false)}
            disabled={busy || selectedCount === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <StarOff size={12} />
            取消收藏
          </button>

          <button
            type="button"
            onClick={onBatchDelete}
            disabled={busy || selectedCount === 0}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
          >
            <Trash2 size={12} />
            删除
          </button>

          <div className="ml-auto flex items-center gap-2">
            {busy && <Loader2 size={12} className="animate-spin text-slate-400" />}
            <button
              type="button"
              onClick={onClear}
              disabled={busy}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              <X size={12} />
              退出
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BatchActionBar;
