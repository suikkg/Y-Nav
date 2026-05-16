import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language?: string;
  maxHeight?: number;
  /** 是否显示行号 */
  showLineNumbers?: boolean;
}

const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language,
  maxHeight,
  showLineNumbers = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCopy = async () => {
    setError(null);
    try {
      // 复制原始代码，不复制行号或 HTML
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      setError('复制失败，请手动选择');
      setTimeout(() => setError(null), 2000);
    }
  };

  const lines = showLineNumbers ? code.split('\n') : null;

  return (
    <div className="relative group rounded-2xl border border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/70 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200/80 dark:border-slate-700/60 bg-white/60 dark:bg-slate-900/60">
        <div className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          {language || 'text'}
        </div>
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
      {error && (
        <div className="px-4 py-2 text-xs text-red-600 dark:text-red-400 border-b border-slate-200/80 dark:border-slate-700/60">
          {error}
        </div>
      )}
      <pre
        className="overflow-auto text-sm leading-relaxed font-mono text-slate-800 dark:text-slate-100"
        style={maxHeight ? { maxHeight } : undefined}
      >
        {showLineNumbers && lines ? (
          <code className="block">
            <table className="w-full border-collapse">
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={idx}>
                    <td className="select-none text-right pr-3 pl-4 text-slate-400 dark:text-slate-500 align-top w-12">
                      {idx + 1}
                    </td>
                    <td className="pr-4 py-0 whitespace-pre">{line || ' '}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </code>
        ) : (
          <code className="block px-4 py-3 whitespace-pre">{code}</code>
        )}
      </pre>
    </div>
  );
};

export default CodeBlock;
