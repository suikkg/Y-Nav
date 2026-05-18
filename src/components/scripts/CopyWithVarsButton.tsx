import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Check, ChevronDown, X } from 'lucide-react';

interface CopyWithVarsButtonProps {
  code: string;
}

interface Placeholder {
  name: string;
  hasDollar: boolean;
  hasMustache: boolean;
}

const DOLLAR_RE = /\$\{([A-Z_][A-Z0-9_]{1,})\}/g;
const MUSTACHE_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_-]+)\s*\}\}/g;

export function detectPlaceholders(code: string): Placeholder[] {
  const map = new Map<string, Placeholder>();
  for (const m of code.matchAll(DOLLAR_RE)) {
    const name = m[1];
    const entry = map.get(name) || { name, hasDollar: false, hasMustache: false };
    entry.hasDollar = true;
    map.set(name, entry);
  }
  for (const m of code.matchAll(MUSTACHE_RE)) {
    const name = m[1];
    const entry = map.get(name) || { name, hasDollar: false, hasMustache: false };
    entry.hasMustache = true;
    map.set(name, entry);
  }
  return Array.from(map.values());
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function substituteVariables(code: string, values: Record<string, string>): string {
  let out = code;
  for (const [name, value] of Object.entries(values)) {
    const dollarRe = new RegExp(`\\$\\{${escapeRegExp(name)}\\}`, 'g');
    out = out.replace(dollarRe, value);
    const mustRe = new RegExp(`\\{\\{\\s*${escapeRegExp(name)}\\s*\\}\\}`, 'g');
    out = out.replace(mustRe, value);
  }
  return out;
}

const CopyWithVarsButton: React.FC<CopyWithVarsButtonProps> = ({ code }) => {
  const placeholders = useMemo(() => detectPlaceholders(code), [code]);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // 打开时重置值（保留已有的，新增的初始化为空）
  useEffect(() => {
    if (!open) return;
    setValues((prev) => {
      const next: Record<string, string> = {};
      for (const p of placeholders) {
        next[p.name] = prev[p.name] ?? '';
      }
      return next;
    });
    // 短延迟后聚焦首个输入框，等待 React 完成渲染
    const t = setTimeout(() => firstInputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open, placeholders]);

  // 点外部关闭
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (placeholders.length === 0) return null;

  const handleCopy = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = substituteVariables(code, values);
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setError(null);
      setTimeout(() => {
        setCopied(false);
        setOpen(false);
      }, 1200);
    } catch {
      setError('复制失败，请检查浏览器权限');
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-slate-700/60 transition-colors"
        aria-label="带变量替换复制"
        aria-expanded={open}
      >
        <Copy size={14} />
        替换 {placeholders.length} 个变量
        <ChevronDown size={12} />
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-1 z-30 w-80 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl"
          role="dialog"
          aria-label="变量替换"
        >
          <form onSubmit={handleCopy} className="flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 dark:border-slate-800">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                填入变量值后复制
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="关闭"
              >
                <X size={14} />
              </button>
            </div>

            <div className="px-3 py-2 space-y-2 max-h-72 overflow-y-auto">
              {placeholders.map((p, idx) => (
                <label key={p.name} className="block">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-mono text-slate-600 dark:text-slate-300">
                      {p.name}
                    </span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">
                      {p.hasDollar && p.hasMustache
                        ? '${} + {{}}'
                        : p.hasDollar
                          ? '${...}'
                          : '{{ ... }}'}
                    </span>
                  </div>
                  <input
                    ref={idx === 0 ? firstInputRef : undefined}
                    type="text"
                    value={values[p.name] ?? ''}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [p.name]: e.target.value }))
                    }
                    placeholder={`留空保留 "${p.name}"`}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/60"
                  />
                </label>
              ))}
            </div>

            {error && (
              <div className="px-3 pb-2 text-xs text-red-600 dark:text-red-400">{error}</div>
            )}

            <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setValues({})}
                className="px-2.5 py-1 rounded-lg text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                清空
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90"
              >
                {copied ? (
                  <>
                    <Check size={12} />
                    已复制
                  </>
                ) : (
                  <>
                    <Copy size={12} />
                    复制
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default CopyWithVarsButton;
