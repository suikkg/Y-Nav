import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Save, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { ScriptSnippet } from '../../types';
import { SnippetInput } from '../../services/snippetService';
import MonacoCodeEditor from './MonacoCodeEditor';

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

const DRAFT_KEY_PREFIX = 'ynav.scripts.draft.';
const DRAFT_SAVE_DELAY_MS = 2000;

interface DraftPayload {
  title: string;
  language: string;
  tagsText: string;
  description: string;
  code: string;
  favorite: boolean;
  savedAt: number;
}

function draftKeyFor(initial?: ScriptSnippet | null): string {
  return `${DRAFT_KEY_PREFIX}${initial?.id || 'new'}`;
}

function loadDraft(key: string): DraftPayload | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as DraftPayload;
  } catch {
    return null;
  }
}

function saveDraft(key: string, payload: Omit<DraftPayload, 'savedAt'>): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...payload, savedAt: Date.now() }));
  } catch {
    // sessionStorage 不可用（隐私模式等）— 忽略
  }
}

function clearDraft(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function buildInitialState(snippet?: ScriptSnippet | null) {
  return {
    title: snippet?.title || '',
    language: snippet?.language || 'text',
    tagsText: (snippet?.tags || []).join(', '),
    description: snippet?.description || '',
    code: snippet?.code || '',
    favorite: !!snippet?.favorite,
  };
}

function statesEqual(
  a: ReturnType<typeof buildInitialState>,
  b: ReturnType<typeof buildInitialState>,
): boolean {
  return (
    a.title === b.title &&
    a.language === b.language &&
    a.tagsText === b.tagsText &&
    a.description === b.description &&
    a.code === b.code &&
    a.favorite === b.favorite
  );
}

// ============================================
// 焦点陷阱 & Esc 关闭
// ============================================

function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active || !containerRef.current) return;
    const container = containerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    function getFocusable(): HTMLElement[] {
      return Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
    }

    function handleKey(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (current === first || !container.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    }

    container.addEventListener('keydown', handleKey);
    return () => {
      container.removeEventListener('keydown', handleKey);
      previouslyFocused?.focus?.();
    };
  }, [active, containerRef]);
}

function useEscClose(onClose: () => void, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, [active, onClose]);
}

// ============================================
// 组件
// ============================================

const SnippetEditor: React.FC<SnippetEditorProps> = ({ initial, onCancel, onSubmit }) => {
  const initialState = useMemo(() => buildInitialState(initial), [initial]);

  const [title, setTitle] = useState(initialState.title);
  const [language, setLanguage] = useState(initialState.language);
  const [tagsText, setTagsText] = useState(initialState.tagsText);
  const [description, setDescription] = useState(initialState.description);
  const [code, setCode] = useState(initialState.code);
  const [favorite, setFavorite] = useState(initialState.favorite);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftRestoredFrom, setDraftRestoredFrom] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const containerRef = useRef<HTMLFormElement>(null);
  const draftKey = draftKeyFor(initial);

  // 重置当 initial 改变
  useEffect(() => {
    const s = buildInitialState(initial);
    setTitle(s.title);
    setLanguage(s.language);
    setTagsText(s.tagsText);
    setDescription(s.description);
    setCode(s.code);
    setFavorite(s.favorite);
    setError(null);
    setDraftRestoredFrom(null);
  }, [initial]);

  // 加载草稿（仅在打开时检查，且草稿与原始不同时才恢复）
  useEffect(() => {
    const draft = loadDraft(draftKey);
    if (!draft) return;
    const draftState = {
      title: draft.title,
      language: draft.language,
      tagsText: draft.tagsText,
      description: draft.description,
      code: draft.code,
      favorite: draft.favorite,
    };
    if (statesEqual(draftState, initialState)) {
      clearDraft(draftKey);
      return;
    }
    setTitle(draft.title);
    setLanguage(draft.language);
    setTagsText(draft.tagsText);
    setDescription(draft.description);
    setCode(draft.code);
    setFavorite(draft.favorite);
    setDraftRestoredFrom(draft.savedAt);
  }, [draftKey, initialState]);

  // 草稿自动保存（debounce 2s）
  useEffect(() => {
    const current = { title, language, tagsText, description, code, favorite };
    if (statesEqual(current, initialState)) {
      clearDraft(draftKey);
      return;
    }
    const timer = setTimeout(() => {
      saveDraft(draftKey, current);
    }, DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [title, language, tagsText, description, code, favorite, initialState, draftKey]);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent | Event) => {
      e?.preventDefault?.();
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
        clearDraft(draftKey);
      } catch (err) {
        setError((err as Error)?.message || '保存失败');
      } finally {
        setSubmitting(false);
      }
    },
    [title, code, language, description, tagsText, favorite, onSubmit, draftKey],
  );

  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  useFocusTrap(containerRef, true);
  useEscClose(handleCancel, !submitting);

  const submitOnSaveShortcut = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={initial ? '编辑脚本' : '新建脚本'}
    >
      <form
        ref={containerRef}
        onSubmit={handleSubmit}
        className={`flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden ${
          isFullscreen
            ? 'w-full h-full max-w-none max-h-none rounded-none'
            : 'w-full max-w-3xl max-h-[92vh] rounded-2xl'
        }`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800/60">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {initial ? '编辑脚本' : '新建脚本'}
          </h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setIsFullscreen((v) => !v)}
              className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label={isFullscreen ? '退出全屏' : '全屏编辑'}
              title={isFullscreen ? '退出全屏' : '全屏编辑'}
            >
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="关闭 (Esc)"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div
          className={`flex-1 min-h-0 px-6 py-5 ${
            isFullscreen ? 'flex flex-col gap-4 overflow-hidden' : 'overflow-y-auto space-y-4'
          }`}
        >
          {draftRestoredFrom !== null && (
            <div className="text-xs px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 shrink-0">
              已恢复 {new Date(draftRestoredFrom).toLocaleString()} 的未保存草稿
              <button
                type="button"
                onClick={() => {
                  const s = buildInitialState(initial);
                  setTitle(s.title);
                  setLanguage(s.language);
                  setTagsText(s.tagsText);
                  setDescription(s.description);
                  setCode(s.code);
                  setFavorite(s.favorite);
                  setDraftRestoredFrom(null);
                  clearDraft(draftKey);
                }}
                className="ml-2 underline hover:no-underline"
              >
                丢弃草稿
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 shrink-0">
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
                autoFocus
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

          <div className="shrink-0">
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

          <div className={isFullscreen ? 'flex-1 min-h-0 flex flex-col' : ''}>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5 shrink-0">
              代码 <span className="text-red-500">*</span>
              <span className="ml-2 text-slate-400 dark:text-slate-500 font-normal">
                (⌘/Ctrl+S 保存{isFullscreen ? '' : '，⛶ 全屏'})
              </span>
            </label>
            <div className={isFullscreen ? 'flex-1 min-h-0' : ''}>
              <MonacoCodeEditor
                value={code}
                onChange={setCode}
                language={language}
                height={isFullscreen ? '100%' : 380}
                onSave={submitOnSaveShortcut}
              />
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={favorite}
              onChange={(e) => setFavorite(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-accent focus:ring-accent"
            />
            标记为收藏
          </label>

          {error && <div className="text-sm text-red-600 dark:text-red-400 shrink-0">{error}</div>}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800/60 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
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
