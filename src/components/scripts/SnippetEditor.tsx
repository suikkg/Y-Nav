import React, { useEffect, useState } from 'react';
import { X, Save, Loader2 } from 'lucide-react';
import { ScriptSnippet } from '../../types';
import { SnippetInput } from '../../services/snippetService';

interface SnippetEditorProps {
  initial?: ScriptSnippet | null;
  onCancel: () => void;
  onSubmit: (input: SnippetInput) => Promise<void>;
}

const LANGUAGES = [
  'text',
  'bash',
  'shell',
  'python',
  'javascript',
  'typescript',
  'tsx',
  'jsx',
  'go',
  'rust',
  'java',
  'c',
  'cpp',
  'csharp',
  'php',
  'ruby',
  'sql',
  'json',
  'yaml',
  'toml',
  'html',
  'css',
  'markdown',
  'dockerfile',
  'nginx',
  'lua',
  'kotlin',
  'swift',
];

const SnippetEditor: React.FC<SnippetEditorProps> = ({ initial, onCancel, onSubmit }) => {
  const [title, setTitle] = useState(initial?.title || '');
  const [language, setLanguage] = useState(initial?.language || 'text');
  const [tagsText, setTagsText] = useState((initial?.tags || []).join(', '));
  const [description, setDescription] = useState(initial?.description || '');
  const [code, setCode] = useState(initial?.code || '');
  const [favorite, setFavorite] = useState(!!initial?.favorite);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(initial?.title || '');
    setLanguage(initial?.language || 'text');
    setTagsText((initial?.tags || []).join(', '));
    setDescription(initial?.description || '');
    setCode(initial?.code || '');
    setFavorite(!!initial?.favorite);
  }, [initial]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('请输入标题');
      return;
    }
    if (!code) {
      setError('代码不能为空');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const tags = tagsText
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean);
      await onSubmit({
        title: title.trim(),
        language: language || 'text',
        code,
        description: description.trim(),
        tags,
        favorite,
      });
    } catch (err: any) {
      setError(err?.message || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800/60">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {initial ? '编辑脚本' : '新建脚本'}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                标题 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/60"
                placeholder="例: 清理 docker 镜像"
                maxLength={200}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                语言
              </label>
              <input
                type="text"
                list="snippet-languages"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/60"
                placeholder="text"
                maxLength={40}
              />
              <datalist id="snippet-languages">
                {LANGUAGES.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                标签 (逗号分隔)
              </label>
              <input
                type="text"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/60"
                placeholder="例: docker, 运维"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              描述
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/60 resize-y"
              placeholder="可选: 这段脚本的用途、注意事项"
              maxLength={2000}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              代码 <span className="text-red-500">*</span>
            </label>
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              rows={14}
              spellCheck={false}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/60 font-mono text-sm leading-relaxed resize-y"
              placeholder="在此粘贴代码..."
            />
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={favorite}
              onChange={(e) => setFavorite(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-accent focus:ring-accent"
            />
            标记为收藏
          </label>

          {error && (
            <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold shadow-sm hover:bg-accent/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            保存
          </button>
        </div>
      </form>
    </div>
  );
};

export default SnippetEditor;
