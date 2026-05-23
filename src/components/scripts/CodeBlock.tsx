import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Check, Search, X, ChevronUp, ChevronDown } from 'lucide-react';
import { highlightCodeAsync } from './highlight';
import CopyWithVarsButton from './CopyWithVarsButton';
import './code-theme.css';

interface CodeBlockProps {
  code: string;
  language?: string;
  maxHeight?: number;
  /** 是否显示行号 */
  showLineNumbers?: boolean;
}

function escapePlain(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================
// 查找：在 shiki 渲染后的 DOM 文本节点上注入 <mark>，再做导航
// ============================================

const FIND_CLASS = 'ynav-code-find';
const FIND_ACTIVE_CLASS = 'ynav-code-find--active';

function clearFindHighlights(root: HTMLElement): void {
  const marks = root.querySelectorAll<HTMLElement>(`mark.${FIND_CLASS}`);
  marks.forEach((m) => {
    const text = document.createTextNode(m.textContent ?? '');
    m.replaceWith(text);
  });
  if (marks.length > 0) root.normalize();
}

function applyFindHighlights(root: HTMLElement, query: string): HTMLElement[] {
  if (!query) return [];
  const lowerQuery = query.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // 已经在 <mark.ynav-code-find> 内部的文本节点不重复处理
      if (
        node.parentElement?.tagName === 'MARK' &&
        (node.parentElement as HTMLElement).classList.contains(FIND_CLASS)
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) textNodes.push(node as Text);

  const marks: HTMLElement[] = [];
  for (const textNode of textNodes) {
    const text = textNode.nodeValue ?? '';
    if (!text) continue;
    const lowerText = text.toLowerCase();
    if (!lowerText.includes(lowerQuery)) continue;

    const frag = document.createDocumentFragment();
    let cursor = 0;
    let idx = lowerText.indexOf(lowerQuery, cursor);
    while (idx !== -1) {
      if (idx > cursor) {
        frag.appendChild(document.createTextNode(text.slice(cursor, idx)));
      }
      const mark = document.createElement('mark');
      mark.className = FIND_CLASS;
      mark.textContent = text.slice(idx, idx + query.length);
      frag.appendChild(mark);
      marks.push(mark);
      cursor = idx + query.length;
      idx = lowerText.indexOf(lowerQuery, cursor);
    }
    if (cursor < text.length) {
      frag.appendChild(document.createTextNode(text.slice(cursor)));
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  }
  return marks;
}

const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language,
  maxHeight,
  showLineNumbers = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightedHtml, setHighlightedHtml] = useState<string>(() => escapePlain(code));
  const [resolvedLang, setResolvedLang] = useState<string>(() =>
    (language || 'text').toLowerCase().trim(),
  );

  // 查找状态
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [activeMatchIdx, setActiveMatchIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const codeRootRef = useRef<HTMLPreElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const marksRef = useRef<HTMLElement[]>([]);
  // 鼠标是否在代码块上 — 用来决定 Ctrl/Cmd+F 是否拦截
  const isHoveringRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    // 立即显示未高亮文本作为占位，避免大代码渲染前白屏
    setHighlightedHtml(escapePlain(code));
    setResolvedLang((language || 'text').toLowerCase().trim());

    highlightCodeAsync(code, language)
      .then((result) => {
        if (!cancelled) {
          setHighlightedHtml(result.html);
          setResolvedLang(result.language);
        }
      })
      .catch(() => {
        // 已经显示了 escaped 文本，无需额外处理
      });

    return () => {
      cancelled = true;
    };
  }, [code, language]);

  const highlightedLines = useMemo(() => {
    if (!showLineNumbers) return null;
    // Shiki 输出形如 `<span class="line">…</span>\n<span class="line">…</span>`,
    // 末尾通常带一个空 line 形成尾随换行 — 渲染时丢掉以避免多一个空行。
    const lines = highlightedHtml.split('\n');
    if (lines.length > 1 && /^<span class="line"><\/span>$/.test(lines[lines.length - 1])) {
      lines.pop();
    }
    return lines;
  }, [highlightedHtml, showLineNumbers]);

  // ============================================
  // 查找：query 或 渲染内容变化时重新匹配
  // ============================================
  useEffect(() => {
    const root = codeRootRef.current;
    if (!root) return;
    clearFindHighlights(root);
    if (!findQuery) {
      marksRef.current = [];
      setMatchCount(0);
      setActiveMatchIdx(-1);
      return;
    }
    const marks = applyFindHighlights(root, findQuery);
    marksRef.current = marks;
    setMatchCount(marks.length);
    // 关键：marks 重建后，必须当场把第一个标成 active + 滚到视图。
    // 因为 setActiveMatchIdx(0) 在前一次 activeMatchIdx 已经是 0 时是 no-op，
    // 不会触发下面那个 [activeMatchIdx] effect — 那种情况下新建的 marks 会拿不到 active 样式也不滚动。
    if (marks.length > 0) {
      marks[0].classList.add(FIND_ACTIVE_CLASS);
      marks[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      setActiveMatchIdx(0);
    } else {
      setActiveMatchIdx(-1);
    }
    // 依赖 highlightedHtml/highlightedLines/showLineNumbers 因为它们决定 DOM 内容
  }, [findQuery, highlightedHtml, highlightedLines, showLineNumbers]);

  // 切换 active 高亮 + 滚动到视图（用于 prev/next 导航）
  useEffect(() => {
    const marks = marksRef.current;
    if (marks.length === 0) return;
    marks.forEach((m, i) => {
      if (i === activeMatchIdx) {
        m.classList.add(FIND_ACTIVE_CLASS);
      } else {
        m.classList.remove(FIND_ACTIVE_CLASS);
      }
    });
    if (activeMatchIdx >= 0 && activeMatchIdx < marks.length) {
      marks[activeMatchIdx].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeMatchIdx]);

  // 卸载时清掉所有高亮，避免残留
  useEffect(() => {
    return () => {
      const root = codeRootRef.current;
      if (root) clearFindHighlights(root);
    };
  }, []);

  const handleCopy = async () => {
    setError(null);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('复制失败，请手动选择');
      setTimeout(() => setError(null), 2000);
    }
  };

  const openFind = useCallback(() => {
    setFindOpen(true);
    // 等渲染后再 focus
    requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }, []);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindQuery('');
  }, []);

  const goToNext = useCallback(() => {
    if (matchCount === 0) return;
    setActiveMatchIdx((idx) => (idx + 1) % matchCount);
  }, [matchCount]);

  const goToPrev = useCallback(() => {
    if (matchCount === 0) return;
    setActiveMatchIdx((idx) => (idx - 1 + matchCount) % matchCount);
  }, [matchCount]);

  // 全局 Ctrl/Cmd+F：只在鼠标悬停在本代码块上 或 查找框已打开时拦截
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isFind = (e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F');
      if (!isFind) return;
      const active = document.activeElement;
      const insideThisBlock =
        containerRef.current && active instanceof Node && containerRef.current.contains(active);
      if (!isHoveringRef.current && !insideThisBlock) return;
      e.preventDefault();
      openFind();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openFind]);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeFind();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) goToPrev();
      else goToNext();
    } else if (e.key === 'F3') {
      e.preventDefault();
      if (e.shiftKey) goToPrev();
      else goToNext();
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative group rounded-2xl border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/70 overflow-hidden"
      onMouseEnter={() => {
        isHoveringRef.current = true;
      }}
      onMouseLeave={() => {
        isHoveringRef.current = false;
      }}
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200/80 dark:border-slate-700/60 bg-white/60 dark:bg-slate-900/60">
        <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          {resolvedLang || 'text'}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={openFind}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-700/60 transition-colors"
            aria-label="查找 (Ctrl/Cmd+F)"
            title="查找 (Ctrl/Cmd+F)"
          >
            <Search size={14} />
            查找
          </button>
          <CopyWithVarsButton code={code} />
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-700/60 transition-colors"
            aria-label="复制代码"
          >
            {copied ? (
              <>
                <Check size={14} className="text-emerald-500" />
                已复制
              </>
            ) : (
              <>
                <Copy size={14} />
                复制
              </>
            )}
          </button>
        </div>
      </div>
      {findOpen && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-200/80 dark:border-slate-700/60 bg-white/80 dark:bg-slate-900/80">
          <Search size={13} className="text-slate-400 shrink-0" />
          <input
            ref={findInputRef}
            type="text"
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="查找..."
            className="flex-1 min-w-0 px-2 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/60"
          />
          <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums whitespace-nowrap">
            {findQuery ? (matchCount > 0 ? `${activeMatchIdx + 1} / ${matchCount}` : '无匹配') : ''}
          </span>
          <button
            type="button"
            onClick={goToPrev}
            disabled={matchCount === 0}
            className="p-1 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-700/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="上一个"
            title="上一个 (Shift+Enter)"
          >
            <ChevronUp size={14} />
          </button>
          <button
            type="button"
            onClick={goToNext}
            disabled={matchCount === 0}
            className="p-1 rounded-md text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-700/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            aria-label="下一个"
            title="下一个 (Enter)"
          >
            <ChevronDown size={14} />
          </button>
          <button
            type="button"
            onClick={closeFind}
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700/60 transition-colors"
            aria-label="关闭查找 (Esc)"
            title="关闭查找 (Esc)"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {error && (
        <div className="px-4 py-2 text-xs text-red-600 dark:text-red-400 border-b border-slate-200/80 dark:border-slate-700/60">
          {error}
        </div>
      )}
      <pre
        ref={codeRootRef}
        className="overflow-auto text-sm leading-relaxed font-mono text-slate-800 dark:text-slate-100"
        style={maxHeight ? { maxHeight } : undefined}
      >
        {showLineNumbers && highlightedLines ? (
          <code className="shiki-code block">
            <table className="w-full border-collapse">
              <tbody>
                {highlightedLines.map((line, idx) => (
                  <tr key={idx}>
                    <td className="select-none text-right pr-3 pl-4 text-slate-400 dark:text-slate-500 align-top w-12">
                      {idx + 1}
                    </td>
                    <td
                      className="pr-4 py-0 whitespace-pre"
                      dangerouslySetInnerHTML={{ __html: line || ' ' }}
                    />
                  </tr>
                ))}
              </tbody>
            </table>
          </code>
        ) : (
          <code
            className="shiki-code block px-4 py-3 whitespace-pre"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        )}
      </pre>
    </div>
  );
};

export default CodeBlock;
