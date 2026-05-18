import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScriptSnippet, SnippetSortKey } from '../../types';
import {
  SessionStatus,
  SnippetInput,
  createSnippet,
  deleteSnippet,
  getSession,
  listSnippets,
  logout,
  permanentlyDeleteSnippet,
  restoreSnippet,
  updateSnippet,
} from '../../services/snippetService';
import { useDialog } from '../ui/DialogProvider';

// ============================================
// 共享常量 / 类型 (UI 子组件也会引用)
// ============================================

export type DateRangePreset = 'all' | 'today' | '7d' | 'month' | 'year' | 'custom';

export interface CustomRange {
  from: string;
  to: string;
}

export type SearchScope = 'title' | 'description' | 'code';

export const ALL_SEARCH_SCOPES = ['title', 'description', 'code'] as const;

export const SEARCH_SCOPE_LABELS: Record<SearchScope, string> = {
  title: '标题',
  description: '描述',
  code: '代码内容',
};

export const SORT_LABELS: Record<SnippetSortKey, string> = {
  updated_desc: '更新时间 ↓',
  updated_asc: '更新时间 ↑',
  created_desc: '创建时间 ↓',
  created_asc: '创建时间 ↑',
  title_asc: '标题 A→Z',
  title_desc: '标题 Z→A',
};

export const VALID_SORTS: readonly SnippetSortKey[] = [
  'updated_desc',
  'updated_asc',
  'created_desc',
  'created_asc',
  'title_asc',
  'title_desc',
];

const SEARCH_SCOPES_KEY = 'ynav.scripts.searchScopes';
const SORT_KEY_STORAGE = 'ynav.scripts.sort';
const FAVORITE_ONLY_KEY = 'ynav.scripts.favoritesOnly';
const SESSION_IDLE_MS = 10 * 60 * 1000;
const SESSION_HEARTBEAT_MS = 60_000;
const SESSION_CHECK_INTERVAL_MS = 15_000;

function startOfPreset(
  preset: DateRangePreset,
  custom: CustomRange,
): { from: number | null; to: number | null } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  if (preset === 'all') return { from: null, to: null };
  if (preset === 'today') return { from: new Date(y, m, d).getTime(), to: null };
  if (preset === '7d') return { from: new Date(y, m, d).getTime() - 6 * 86400_000, to: null };
  if (preset === 'month') return { from: new Date(y, m, 1).getTime(), to: null };
  if (preset === 'year') return { from: new Date(y, 0, 1).getTime(), to: null };
  const from = custom.from ? new Date(custom.from + 'T00:00:00').getTime() : null;
  const to = custom.to ? new Date(custom.to + 'T23:59:59.999').getTime() : null;
  return { from, to };
}

interface ImportProgress {
  total: number;
  done: number;
  failed: number;
}

export type EditorState = { mode: 'create' } | { mode: 'edit'; snippet: ScriptSnippet } | null;

/**
 * 集中持有 ScriptsVault 的所有数据与副作用。
 *
 * 设计原则：
 *   - hook 只关心 state + business logic + storage 持久化
 *   - 不渲染任何 UI
 *   - 把派生数据 (filtered/allTags/allLanguages) 以 useMemo 暴露
 *   - 所有 setter 都通过显式命名的 handler 暴露，避免外部随意修改内部 state
 */
// eslint-disable-next-line max-lines-per-function -- 这是核心状态聚合，拆得太散反而难追踪
export function useScriptsVaultData(onNotify?: () => void) {
  void onNotify; // 占位，留给未来通知钩子
  const { notify, confirm } = useDialog();

  // ============== Session / view ==============
  const [sessionState, setSessionState] = useState<SessionStatus | null>(null);
  const [snippets, setSnippets] = useState<ScriptSnippet[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorState, setEditorState] = useState<EditorState>(null);
  const [mobileView, setMobileView] = useState<'list' | 'detail'>('list');
  const [view, setView] = useState<'active' | 'trash'>('active');
  const [historyFor, setHistoryFor] = useState<ScriptSnippet | null>(null);
  const [shareFor, setShareFor] = useState<ScriptSnippet | null>(null);

  // ============== 批量选择 ==============
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);

  // ============== 筛选 ==============
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState<string>('');
  const [langFilter, setLangFilter] = useState<string>('');
  const [datePreset, setDatePreset] = useState<DateRangePreset>('all');
  const [customRange, setCustomRange] = useState<CustomRange>({ from: '', to: '' });
  const [searchScopes, setSearchScopes] = useState<Set<SearchScope>>(() => {
    try {
      const stored = localStorage.getItem(SEARCH_SCOPES_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const valid = parsed.filter((s): s is SearchScope =>
            (ALL_SEARCH_SCOPES as readonly string[]).includes(s),
          );
          if (valid.length > 0) return new Set(valid);
        }
      }
    } catch {
      // ignore
    }
    return new Set(ALL_SEARCH_SCOPES);
  });
  const [sortKey, setSortKey] = useState<SnippetSortKey>(() => {
    try {
      const stored = localStorage.getItem(SORT_KEY_STORAGE);
      if (stored && (VALID_SORTS as readonly string[]).includes(stored)) {
        return stored as SnippetSortKey;
      }
    } catch {
      // ignore
    }
    return 'updated_desc';
  });
  const [favoritesOnly, setFavoritesOnly] = useState<boolean>(() => {
    try {
      return localStorage.getItem(FAVORITE_ONLY_KEY) === '1';
    } catch {
      return false;
    }
  });

  // ============== 导入进度 ==============
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);

  // ============== Storage 同步 ==============
  useEffect(() => {
    try {
      localStorage.setItem(SORT_KEY_STORAGE, sortKey);
    } catch {
      /* ignore */
    }
  }, [sortKey]);
  useEffect(() => {
    try {
      localStorage.setItem(FAVORITE_ONLY_KEY, favoritesOnly ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [favoritesOnly]);
  useEffect(() => {
    try {
      localStorage.setItem(SEARCH_SCOPES_KEY, JSON.stringify(Array.from(searchScopes)));
    } catch {
      /* ignore */
    }
  }, [searchScopes]);

  // ============== Session ==============
  const lastActivityRef = useRef<number>(Date.now());

  const refreshSession = useCallback(async () => {
    try {
      const status = await getSession();
      setSessionState(status);
      return status;
    } catch {
      const fallback: SessionStatus = { authenticated: false, configured: false };
      setSessionState(fallback);
      return fallback;
    }
  }, []);

  const fetchSnippets = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const result = await listSnippets({
          trashed: view === 'trash' ? 'true' : 'false',
          limit: 200,
        });
        setSnippets(result.snippets);
      } catch (err) {
        const e = err as Error & { status?: number };
        if (e?.status === 401) {
          await refreshSession();
        } else {
          notify(e?.message || '加载失败', 'error');
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [notify, refreshSession, view],
  );

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (sessionState?.authenticated) fetchSnippets();
  }, [sessionState?.authenticated, fetchSnippets]);

  // 活动续期心跳
  useEffect(() => {
    if (!sessionState?.authenticated) return;
    lastActivityRef.current = Date.now();
    let lastBeat = Date.now();
    const beat = () => {
      const now = Date.now();
      lastActivityRef.current = now;
      if (now - lastBeat < SESSION_HEARTBEAT_MS) return;
      lastBeat = now;
      getSession().catch(() => {
        /* 心跳失败由后续 API 调用处理 */
      });
    };
    const events: Array<keyof WindowEventMap> = ['mousedown', 'keydown', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, beat, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, beat));
  }, [sessionState?.authenticated]);

  // 本地超时检测
  useEffect(() => {
    if (!sessionState?.authenticated) return;
    const interval = setInterval(async () => {
      if (Date.now() - lastActivityRef.current < SESSION_IDLE_MS) return;
      clearInterval(interval);
      try {
        await logout();
      } catch {
        /* ignore */
      }
      setSnippets([]);
      setSelectedId(null);
      setEditorState(null);
      notify('会话已超时，请重新登录', 'warning');
      await refreshSession();
    }, SESSION_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [sessionState?.authenticated, notify, refreshSession]);

  // ============== Auth handlers ==============
  const handleLoggedIn = useCallback(async () => {
    await refreshSession();
  }, [refreshSession]);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
    } catch {
      /* ignore */
    }
    setSnippets([]);
    setSelectedId(null);
    await refreshSession();
  }, [refreshSession]);

  // ============== CRUD ==============
  const handleCreate = useCallback(
    async (input: SnippetInput) => {
      const created = await createSnippet(input);
      setSnippets((prev) => [created, ...prev]);
      setSelectedId(created.id);
      setEditorState(null);
      notify('已创建脚本', 'success');
    },
    [notify],
  );

  const handleUpdate = useCallback(
    async (id: string, input: SnippetInput) => {
      const updated = await updateSnippet(id, input);
      setSnippets((prev) => {
        const next = prev.filter((s) => s.id !== id);
        return [updated, ...next];
      });
      setSelectedId(updated.id);
      setEditorState(null);
      notify('已保存修改', 'success');
    },
    [notify],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: '删除脚本',
        message: '删除后会进入回收站，可恢复。确定继续吗？',
        confirmText: '删除',
        variant: 'danger',
      });
      if (!ok) return;
      try {
        await deleteSnippet(id);
        setSnippets((prev) => prev.filter((s) => s.id !== id));
        setSelectedId((cur) => (cur === id ? null : cur));
        setMobileView('list');
        notify('已移入回收站', 'success');
      } catch (err) {
        notify((err as Error)?.message || '删除失败', 'error');
      }
    },
    [confirm, notify],
  );

  const handleRestore = useCallback(
    async (id: string) => {
      try {
        await restoreSnippet(id);
        setSnippets((prev) => prev.filter((s) => s.id !== id));
        setSelectedId((cur) => (cur === id ? null : cur));
        setMobileView('list');
        notify('已恢复', 'success');
      } catch (err) {
        notify((err as Error)?.message || '恢复失败', 'error');
      }
    },
    [notify],
  );

  const handlePermanentDelete = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: '永久删除',
        message: '此操作不可撤销，确定要永久删除这个脚本吗？',
        confirmText: '永久删除',
        variant: 'danger',
      });
      if (!ok) return;
      try {
        await permanentlyDeleteSnippet(id);
        setSnippets((prev) => prev.filter((s) => s.id !== id));
        setSelectedId((cur) => (cur === id ? null : cur));
        setMobileView('list');
        notify('已永久删除', 'success');
      } catch (err) {
        notify((err as Error)?.message || '永久删除失败', 'error');
      }
    },
    [confirm, notify],
  );

  // ============== 批量 ==============
  const toggleSelect = useCallback((id: string) => {
    setSelectedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true);
    setSelectedSet(new Set());
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedSet(new Set());
  }, []);

  const toggleSearchScope = useCallback((scope: SearchScope) => {
    setSearchScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }, []);

  const handleBatchDelete = useCallback(async () => {
    if (selectedSet.size === 0) return;
    const ok = await confirm({
      title: `删除 ${selectedSet.size} 条脚本`,
      message: '将移入回收站，可恢复。继续吗？',
      confirmText: '删除',
      variant: 'danger',
    });
    if (!ok) return;
    setBatchBusy(true);
    const ids = Array.from(selectedSet);
    let success = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await deleteSnippet(id);
        success += 1;
      } catch {
        failed += 1;
      }
    }
    setSnippets((prev) => prev.filter((s) => !selectedSet.has(s.id)));
    setSelectedId((cur) => (cur && selectedSet.has(cur) ? null : cur));
    setBatchBusy(false);
    exitSelectionMode();
    notify(
      failed > 0 ? `已删除 ${success} 条，${failed} 条失败` : `已删除 ${success} 条`,
      failed > 0 ? 'warning' : 'success',
    );
  }, [selectedSet, confirm, notify, exitSelectionMode]);

  const handleBatchSetFavorite = useCallback(
    async (favorite: boolean) => {
      if (selectedSet.size === 0) return;
      setBatchBusy(true);
      const ids = Array.from(selectedSet);
      const updated: ScriptSnippet[] = [];
      let failed = 0;
      for (const id of ids) {
        try {
          const next = await updateSnippet(id, { favorite });
          updated.push(next);
        } catch {
          failed += 1;
        }
      }
      setSnippets((prev) => {
        const byId = new Map(updated.map((s) => [s.id, s]));
        return prev.map((s) => byId.get(s.id) || s);
      });
      setBatchBusy(false);
      exitSelectionMode();
      if (failed > 0) {
        notify(`已更新 ${updated.length} 条，${failed} 条失败`, 'warning');
      } else {
        notify(
          favorite ? `已收藏 ${updated.length} 条` : `已取消收藏 ${updated.length} 条`,
          'success',
        );
      }
    },
    [selectedSet, notify, exitSelectionMode],
  );

  const handleBatchAddTag = useCallback(
    async (tag: string) => {
      if (selectedSet.size === 0 || !tag.trim()) return;
      const cleanTag = tag.trim();
      setBatchBusy(true);
      const ids = Array.from(selectedSet);
      const updated: ScriptSnippet[] = [];
      let failed = 0;
      for (const id of ids) {
        const cur = snippets.find((s) => s.id === id);
        if (!cur) {
          failed += 1;
          continue;
        }
        if (cur.tags.includes(cleanTag)) {
          updated.push(cur);
          continue;
        }
        try {
          const next = await updateSnippet(id, { tags: [...cur.tags, cleanTag] });
          updated.push(next);
        } catch {
          failed += 1;
        }
      }
      setSnippets((prev) => {
        const byId = new Map(updated.map((s) => [s.id, s]));
        return prev.map((s) => byId.get(s.id) || s);
      });
      setBatchBusy(false);
      exitSelectionMode();
      if (failed > 0) {
        notify(`已加标签 ${updated.length} 条，${failed} 条失败`, 'warning');
      } else {
        notify(`已加标签 "${cleanTag}" 到 ${updated.length} 条`, 'success');
      }
    },
    [selectedSet, snippets, notify, exitSelectionMode],
  );

  // ============== 派生数据 ==============
  const allTags = useMemo(() => {
    const set = new Set<string>();
    snippets.forEach((s) => s.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [snippets]);

  const allLanguages = useMemo(() => {
    const set = new Set<string>();
    snippets.forEach((s) => s.language && set.add(s.language));
    return Array.from(set).sort();
  }, [snippets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const range = startOfPreset(datePreset, customRange);
    const matched = snippets.filter((s) => {
      if (favoritesOnly && !s.favorite) return false;
      if (langFilter && s.language !== langFilter) return false;
      if (tagFilter && !s.tags.includes(tagFilter)) return false;
      const updated = new Date(s.updatedAt).getTime();
      if (range.from !== null && !Number.isNaN(updated) && updated < range.from) return false;
      if (range.to !== null && !Number.isNaN(updated) && updated > range.to) return false;
      if (q) {
        const parts: string[] = [];
        if (searchScopes.has('title')) parts.push(s.title);
        if (searchScopes.has('description')) parts.push(s.description || '');
        if (searchScopes.has('code')) parts.push(s.code);
        if (parts.length === 0) return false;
        const hay = parts.join('\n').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const sorted = [...matched];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'updated_asc':
          return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
        case 'created_desc':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'created_asc':
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'title_asc':
          return a.title.localeCompare(b.title, 'zh-CN');
        case 'title_desc':
          return b.title.localeCompare(a.title, 'zh-CN');
        case 'updated_desc':
        default:
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });
    return sorted;
  }, [
    snippets,
    query,
    tagFilter,
    langFilter,
    datePreset,
    customRange,
    searchScopes,
    favoritesOnly,
    sortKey,
  ]);

  const selected = useMemo(
    () =>
      filtered.find((s) => s.id === selectedId) ||
      snippets.find((s) => s.id === selectedId) ||
      null,
    [filtered, snippets, selectedId],
  );

  // ============== 导入 / 导出 ==============
  const handleExport = useCallback(() => {
    const payload = {
      meta: {
        version: 1,
        exportedAt: new Date().toISOString(),
        count: filtered.length,
        scope: filtered.length === snippets.length ? 'all' : 'filtered',
      },
      snippets: filtered.map((s) => ({
        title: s.title,
        language: s.language,
        code: s.code,
        description: s.description || '',
        tags: s.tags,
        favorite: s.favorite,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `ynav-snippets-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    notify(`已导出 ${filtered.length} 条`, 'success');
  }, [filtered, snippets.length, notify]);

  const handleImportFile = useCallback(
    async (file: File) => {
      let parsed: unknown;
      try {
        const text = await file.text();
        parsed = JSON.parse(text);
      } catch {
        notify('文件不是有效的 JSON', 'error');
        return;
      }
      const items = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { snippets?: unknown[] })?.snippets)
          ? (parsed as { snippets: unknown[] }).snippets
          : null;
      if (!items) {
        notify('JSON 结构无效，期望数组或 {snippets:[]}', 'error');
        return;
      }
      const candidates = items.filter(
        (it): it is { title: unknown; code: unknown } =>
          typeof it === 'object' &&
          it !== null &&
          'title' in it &&
          'code' in it &&
          typeof (it as { title: unknown }).title === 'string' &&
          typeof (it as { code: unknown }).code === 'string',
      );
      if (candidates.length === 0) {
        notify('未找到可导入的条目（需要 title + code）', 'warning');
        return;
      }
      const ok = await confirm({
        title: `导入 ${candidates.length} 条脚本`,
        message: '将作为新条目添加，不会覆盖已有脚本。继续吗?',
        confirmText: '导入',
      });
      if (!ok) return;
      setImportProgress({ total: candidates.length, done: 0, failed: 0 });
      const created: ScriptSnippet[] = [];
      let failed = 0;
      for (let i = 0; i < candidates.length; i++) {
        const raw = candidates[i] as {
          title: string;
          code: string;
          language?: unknown;
          description?: unknown;
          tags?: unknown;
          favorite?: unknown;
        };
        const input: SnippetInput = {
          title: String(raw.title).slice(0, 200).trim(),
          language: typeof raw.language === 'string' ? raw.language.slice(0, 40) : 'text',
          code: String(raw.code),
          description: typeof raw.description === 'string' ? raw.description.slice(0, 2000) : '',
          tags: Array.isArray(raw.tags)
            ? raw.tags.filter((t) => typeof t === 'string').map((t) => t as string)
            : [],
          favorite: !!raw.favorite,
        };
        if (!input.title || !input.code) {
          failed += 1;
          setImportProgress({ total: candidates.length, done: i + 1, failed });
          continue;
        }
        try {
          const c = await createSnippet(input);
          created.push(c);
        } catch {
          failed += 1;
        }
        setImportProgress({ total: candidates.length, done: i + 1, failed });
      }
      if (created.length > 0) setSnippets((prev) => [...created, ...prev]);
      setImportProgress(null);
      notify(
        failed > 0
          ? `导入完成：${created.length} 成功，${failed} 失败`
          : `已导入 ${created.length} 条`,
        failed > 0 ? 'warning' : 'success',
      );
    },
    [confirm, notify],
  );

  return {
    // session
    sessionState,
    loading,
    refreshing,
    handleLoggedIn,
    handleLogout,
    fetchSnippets,
    // data
    snippets,
    setSnippets,
    selected,
    selectedId,
    setSelectedId,
    filtered,
    allTags,
    allLanguages,
    // view
    mobileView,
    setMobileView,
    view,
    setView,
    // editor / modals
    editorState,
    setEditorState,
    historyFor,
    setHistoryFor,
    shareFor,
    setShareFor,
    // filters
    query,
    setQuery,
    tagFilter,
    setTagFilter,
    langFilter,
    setLangFilter,
    datePreset,
    setDatePreset,
    customRange,
    setCustomRange,
    searchScopes,
    toggleSearchScope,
    sortKey,
    setSortKey,
    favoritesOnly,
    setFavoritesOnly,
    // CRUD
    handleCreate,
    handleUpdate,
    handleDelete,
    handleRestore,
    handlePermanentDelete,
    // 批量
    selectionMode,
    selectedSet,
    setSelectedSet,
    batchBusy,
    toggleSelect,
    enterSelectionMode,
    exitSelectionMode,
    handleBatchDelete,
    handleBatchSetFavorite,
    handleBatchAddTag,
    // 导入导出
    fileInputRef,
    importProgress,
    handleExport,
    handleImportFile,
  };
}

export type ScriptsVaultData = ReturnType<typeof useScriptsVaultData>;
