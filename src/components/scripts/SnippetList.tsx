import React from 'react';
import { Star, FileCode2, Clock, Tag } from 'lucide-react';
import { ScriptSnippet } from '../../types';

interface SnippetListProps {
  snippets: ScriptSnippet[];
  selectedId: string | null;
  onSelect: (snippet: ScriptSnippet) => void;
}

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return iso;
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(ts).toLocaleDateString();
}

function lineCount(code: string): number {
  if (!code) return 0;
  return code.split('\n').length;
}

const SnippetList: React.FC<SnippetListProps> = ({ snippets, selectedId, onSelect }) => {
  if (snippets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
        <FileCode2 size={36} className="mb-3 opacity-60" />
        <p className="text-sm">没有匹配的脚本</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800/60">
      {snippets.map((s) => {
        const isSelected = s.id === selectedId;
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onSelect(s)}
              className={`w-full text-left px-4 py-3 transition-colors ${
                isSelected
                  ? 'bg-accent/10 dark:bg-accent/20'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  {s.favorite && (
                    <Star size={12} className="text-amber-500 fill-amber-400 shrink-0" />
                  )}
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {s.title}
                  </span>
                </div>
                <span className="shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                  {s.language || 'text'}
                </span>
              </div>

              {s.description && (
                <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mb-2">
                  {s.description}
                </p>
              )}

              <div className="flex items-center flex-wrap gap-1.5 mb-2">
                {s.tags.slice(0, 6).map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                  >
                    <Tag size={9} />
                    {t}
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-3 text-[11px] text-slate-400 dark:text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <Clock size={11} />
                  {formatRelative(s.updatedAt)}
                </span>
                <span>{lineCount(s.code)} 行</span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
};

export default SnippetList;
