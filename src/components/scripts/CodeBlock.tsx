import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Check } from 'lucide-react';
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

  return (
    <div className="relative group rounded-2xl border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/70 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200/80 dark:border-slate-700/60 bg-white/60 dark:bg-slate-900/60">
        <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          {resolvedLang || 'text'}
        </div>
        <div className="flex items-center gap-1">
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
      {error && (
        <div className="px-4 py-2 text-xs text-red-600 dark:text-red-400 border-b border-slate-200/80 dark:border-slate-700/60">
          {error}
        </div>
      )}
      <pre
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
