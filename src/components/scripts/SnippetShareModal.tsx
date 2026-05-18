import React, { useEffect, useState } from 'react';
import { X, Copy, Check, Loader2, Share2, Trash2, RefreshCw, ExternalLink } from 'lucide-react';
import { ScriptSnippet } from '../../types';
import { revokeShare, shareSnippet } from '../../services/snippetService';

interface SnippetShareModalProps {
  snippet: ScriptSnippet;
  onClose: () => void;
  onUpdated: (next: ScriptSnippet) => void;
}

function buildShareUrl(token: string): string {
  return `${window.location.origin}/share/${token}`;
}

const SnippetShareModal: React.FC<SnippetShareModalProps> = ({ snippet, onClose, onUpdated }) => {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc 关闭
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [onClose]);

  const enabled = !!snippet.shareEnabled && !!snippet.shareToken;
  const shareUrl = enabled && snippet.shareToken ? buildShareUrl(snippet.shareToken) : '';

  const handleEnable = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await shareSnippet(snippet.id);
      onUpdated(next);
    } catch (e) {
      setError((e as Error).message || '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await revokeShare(snippet.id);
      onUpdated(next);
    } catch (e) {
      setError((e as Error).message || '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('复制失败，请手动选择 URL');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="公开分享"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800/60">
          <div className="flex items-center gap-2">
            <Share2 size={16} className="text-accent" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              公开分享
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            生成只读分享链接，任何人都可以通过链接查看本脚本（无需登录）。
          </p>

          {enabled ? (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  分享链接
                </label>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={shareUrl}
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-700 dark:text-slate-300 font-mono"
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent text-white text-xs font-semibold hover:bg-accent/90"
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? '已复制' : '复制'}
                  </button>
                </div>
                <a
                  href={shareUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                >
                  <ExternalLink size={11} />
                  在新窗口打开预览
                </a>
              </div>

              <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                {snippet.shareCreatedAt && (
                  <p>启用于 {new Date(snippet.shareCreatedAt).toLocaleString()}</p>
                )}
                <p>分享内容仅包含 标题 / 描述 / 代码；标签、收藏、内部 ID 不会暴露。</p>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/60">
                <button
                  type="button"
                  onClick={handleEnable}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                  title="重新生成 token，旧 URL 立即失效"
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  重新生成
                </button>
                <button
                  type="button"
                  onClick={handleRevoke}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors disabled:opacity-50"
                >
                  <Trash2 size={13} />
                  撤销分享
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 py-4">
              <p className="text-sm text-slate-500 dark:text-slate-400 text-center">
                该脚本当前未开启分享。
              </p>
              <button
                type="button"
                onClick={handleEnable}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold shadow-sm hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
                开启分享
              </button>
            </div>
          )}

          {error && (
            <div className="text-xs px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SnippetShareModal;
