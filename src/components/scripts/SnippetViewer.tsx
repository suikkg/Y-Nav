import React from 'react';
import {
  Pencil,
  Trash2,
  Tag,
  Clock,
  Calendar,
  FileCode2,
  ArrowLeft,
  RotateCcw,
  History,
  Share2,
} from 'lucide-react';
import { ScriptSnippet } from '../../types';
import CodeBlock from './CodeBlock';
import HighlightText from './HighlightText';

interface SnippetViewerProps {
  snippet: ScriptSnippet;
  /** active: 编辑 + 软删除；trash: 恢复 + 永久删除 */
  mode?: 'active' | 'trash';
  onEdit?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
  onPermanentDelete?: () => void;
  onShowHistory?: () => void;
  onShare?: () => void;
  /** 移动端：从详情返回到列表 */
  onBackToList?: () => void;
  highlightQuery?: string;
}

function formatDateTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const SnippetViewer: React.FC<SnippetViewerProps> = ({
  snippet,
  mode = 'active',
  onEdit,
  onDelete,
  onRestore,
  onPermanentDelete,
  onShowHistory,
  onShare,
  onBackToList,
  highlightQuery,
}) => {
  const isTrash = mode === 'trash';

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800/60">
        {onBackToList && (
          <button
            type="button"
            onClick={onBackToList}
            className="md:hidden mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft size={14} />
            返回列表
          </button>
        )}
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <FileCode2 size={16} className="text-accent" />
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 truncate">
                <HighlightText text={snippet.title} query={highlightQuery} />
              </h2>
              {isTrash && (
                <span className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-800">
                  已删除
                </span>
              )}
            </div>
            {snippet.description && (
              <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-line">
                <HighlightText text={snippet.description} query={highlightQuery} />
              </p>
            )}
          </div>
          <div className="shrink-0 flex items-center gap-2 flex-wrap justify-end">
            {!isTrash && onShowHistory && (
              <button
                type="button"
                onClick={onShowHistory}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="版本历史"
              >
                <History size={13} />
                <span className="hidden sm:inline">历史</span>
              </button>
            )}
            {!isTrash && onShare && (
              <button
                type="button"
                onClick={onShare}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="分享"
              >
                <Share2 size={13} />
                <span className="hidden sm:inline">分享</span>
              </button>
            )}
            {!isTrash && onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <Pencil size={13} />
                编辑
              </button>
            )}
            {!isTrash && onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <Trash2 size={13} />
                删除
              </button>
            )}
            {isTrash && onRestore && (
              <button
                type="button"
                onClick={onRestore}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
              >
                <RotateCcw size={13} />
                恢复
              </button>
            )}
            {isTrash && onPermanentDelete && (
              <button
                type="button"
                onClick={onPermanentDelete}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                <Trash2 size={13} />
                永久删除
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 uppercase tracking-wide">
            {snippet.language || 'text'}
          </span>
          <span className="inline-flex items-center gap-1">
            <Calendar size={12} />
            创建 {formatDateTime(snippet.createdAt)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock size={12} />
            更新 {formatDateTime(snippet.updatedAt)}
          </span>
          {isTrash && snippet.deletedAt && (
            <span className="inline-flex items-center gap-1 text-red-500 dark:text-red-400">
              <Trash2 size={12} />
              删除于 {formatDateTime(snippet.deletedAt)}
            </span>
          )}
          {snippet.tags.length > 0 && (
            <span className="inline-flex items-center flex-wrap gap-1.5">
              {snippet.tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                >
                  <Tag size={10} />
                  {t}
                </span>
              ))}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        <CodeBlock code={snippet.code} language={snippet.language} showLineNumbers />
      </div>
    </div>
  );
};

export default SnippetViewer;
