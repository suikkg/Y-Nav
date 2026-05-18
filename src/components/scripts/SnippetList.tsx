import React, { useRef } from 'react';
import { Star, FileCode2, Clock, Tag, Check } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ScriptSnippet } from '../../types';
import HighlightText from './HighlightText';

interface SnippetListProps {
  snippets: ScriptSnippet[];
  selectedId: string | null;
  onSelect: (snippet: ScriptSnippet) => void;
  /** 搜索关键词；非空时列表项中的命中文本会被 <mark> 包裹 */
  highlightQuery?: string;
  /** 批量选择模式：渲染勾选框，点击行切换选中状态而非进入详情 */
  selectionMode?: boolean;
  selectedSet?: Set<string>;
  onToggleSelect?: (id: string) => void;
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

const ROW_ESTIMATE = 110;
const ROW_OVERSCAN = 8;

const SnippetList: React.FC<SnippetListProps> = ({
  snippets,
  selectedId,
  onSelect,
  highlightQuery,
  selectionMode = false,
  selectedSet,
  onToggleSelect,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: snippets.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: ROW_OVERSCAN,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  if (snippets.length === 0) {
    return (
      <div
        ref={parentRef}
        className="h-full overflow-y-auto max-h-[calc(100vh-160px)] md:max-h-[calc(100vh-200px)]"
      >
        <div className="flex flex-col items-center justify-center py-16 text-slate-400 dark:text-slate-500">
          <FileCode2 size={36} className="mb-3 opacity-60" />
          <p className="text-sm">没有匹配的脚本</p>
        </div>
      </div>
    );
  }

  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      ref={parentRef}
      className="h-full overflow-y-auto max-h-[calc(100vh-160px)] md:max-h-[calc(100vh-200px)]"
    >
      <ul
        style={{ height: `${totalSize}px`, position: 'relative' }}
        className="divide-y divide-slate-100 dark:divide-slate-800/60"
      >
        {items.map((vRow) => {
          const s = snippets[vRow.index];
          if (!s) return null;
          const isSelected = s.id === selectedId;
          const isChecked = selectionMode && !!selectedSet?.has(s.id);
          return (
            <li
              key={s.id}
              data-index={vRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vRow.start}px)`,
              }}
            >
              <button
                type="button"
                onClick={() => {
                  if (selectionMode) onToggleSelect?.(s.id);
                  else onSelect(s);
                }}
                className={`w-full text-left px-4 py-3 transition-colors ${
                  isChecked
                    ? 'bg-accent/15 dark:bg-accent/25'
                    : isSelected && !selectionMode
                      ? 'bg-accent/10 dark:bg-accent/20'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {selectionMode && (
                      <span
                        className={`shrink-0 inline-flex items-center justify-center w-4 h-4 rounded border-2 transition-colors ${
                          isChecked
                            ? 'bg-accent border-accent text-white'
                            : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600'
                        }`}
                      >
                        {isChecked && <Check size={10} strokeWidth={3} />}
                      </span>
                    )}
                    {s.favorite && (
                      <Star size={12} className="text-amber-500 fill-amber-400 shrink-0" />
                    )}
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      <HighlightText text={s.title} query={highlightQuery} />
                    </span>
                  </div>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                    {s.language || 'text'}
                  </span>
                </div>

                {s.description && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mb-2">
                    <HighlightText text={s.description} query={highlightQuery} />
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
    </div>
  );
};

export default SnippetList;
