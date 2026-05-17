import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ArrowLeft,
    LogOut,
    Plus,
    Search,
    Loader2,
    RefreshCw,
    Calendar,
    Filter,
} from 'lucide-react';
import { ScriptSnippet } from '../../types';
import {
    SessionStatus,
    SnippetInput,
    createSnippet,
    deleteSnippet,
    getSession,
    listSnippets,
    logout,
    updateSnippet,
} from '../../services/snippetService';
import { useDialog } from '../ui/DialogProvider';
import ScriptsLogin from './ScriptsLogin';
import SnippetList from './SnippetList';
import SnippetViewer from './SnippetViewer';
import SnippetEditor from './SnippetEditor';

type DateRangePreset = 'all' | 'today' | '7d' | 'month' | 'year' | 'custom';

interface CustomRange {
    from: string; // YYYY-MM-DD
    to: string;   // YYYY-MM-DD
}

function startOfPreset(preset: DateRangePreset, custom: CustomRange): { from: number | null; to: number | null } {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const d = now.getDate();

    if (preset === 'all') return { from: null, to: null };

    if (preset === 'today') {
        const from = new Date(y, m, d).getTime();
        return { from, to: null };
    }
    if (preset === '7d') {
        const from = new Date(y, m, d).getTime() - 6 * 24 * 60 * 60 * 1000;
        return { from, to: null };
    }
    if (preset === 'month') {
        const from = new Date(y, m, 1).getTime();
        return { from, to: null };
    }
    if (preset === 'year') {
        const from = new Date(y, 0, 1).getTime();
        return { from, to: null };
    }
    // custom
    const from = custom.from ? new Date(custom.from + 'T00:00:00').getTime() : null;
    const to = custom.to ? new Date(custom.to + 'T23:59:59.999').getTime() : null;
    return { from, to };
}

const ScriptsVault: React.FC<{ onExit: () => void }> = ({ onExit }) => {
    const { notify, confirm } = useDialog();
    const [sessionState, setSessionState] = useState<SessionStatus | null>(null);
    const [snippets, setSnippets] = useState<ScriptSnippet[]>([]);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [editorState, setEditorState] = useState<
        { mode: 'create' } | { mode: 'edit'; snippet: ScriptSnippet } | null
    >(null);

    // 筛选
    const [query, setQuery] = useState('');
    const [tagFilter, setTagFilter] = useState<string>('');
    const [langFilter, setLangFilter] = useState<string>('');
    const [datePreset, setDatePreset] = useState<DateRangePreset>('all');
    const [customRange, setCustomRange] = useState<CustomRange>({ from: '', to: '' });

    const refreshSession = useCallback(async () => {
        try {
            const status = await getSession();
            setSessionState(status);
            return status;
        } catch (err: any) {
            const fallback: SessionStatus = { authenticated: false, configured: false };
            setSessionState(fallback);
            return fallback;
        }
    }, []);

    const fetchSnippets = useCallback(async (silent = false) => {
        if (silent) {
            setRefreshing(true);
        } else {
            setLoading(true);
        }
        try {
            const data = await listSnippets();
            setSnippets(data);
        } catch (err: any) {
            if (err?.status === 401) {
                await refreshSession();
            } else {
                notify(err?.message || '加载失败', 'error');
            }
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [notify, refreshSession]);

    useEffect(() => {
        refreshSession();
    }, [refreshSession]);

    useEffect(() => {
        if (sessionState?.authenticated) {
            fetchSnippets();
        }
    }, [sessionState?.authenticated, fetchSnippets]);

    // 活动续期：监听点击 / 键盘 / 触屏事件（不含 mousemove / scroll），节流后调一次
    // /auth/session 触发服务端滑动续期。后端 TTL = 10 分钟；60 秒内最多发一次心跳。
    // 闲置 10 分钟后下一个请求会被 401，已由现有逻辑拉回登录页。
    useEffect(() => {
        if (!sessionState?.authenticated) return;
        let lastBeat = Date.now();
        const beat = () => {
            const now = Date.now();
            if (now - lastBeat < 60_000) return;
            lastBeat = now;
            getSession().catch(() => { /* 心跳失败由后续 API 调用处理 */ });
        };
        const events: Array<keyof WindowEventMap> = ['mousedown', 'keydown', 'touchstart'];
        events.forEach((e) => window.addEventListener(e, beat, { passive: true }));
        return () => events.forEach((e) => window.removeEventListener(e, beat));
    }, [sessionState?.authenticated]);

    const handleLoggedIn = useCallback(async () => {
        await refreshSession();
    }, [refreshSession]);

    const handleLogout = useCallback(async () => {
        try {
            await logout();
        } catch {
            // ignore
        }
        setSnippets([]);
        setSelectedId(null);
        await refreshSession();
    }, [refreshSession]);

    const handleCreate = useCallback(async (input: SnippetInput) => {
        const created = await createSnippet(input);
        setSnippets((prev) => [created, ...prev]);
        setSelectedId(created.id);
        setEditorState(null);
        notify('已创建脚本', 'success');
    }, [notify]);

    const handleUpdate = useCallback(async (id: string, input: SnippetInput) => {
        const updated = await updateSnippet(id, input);
        setSnippets((prev) => {
            const next = prev.filter((s) => s.id !== id);
            return [updated, ...next];
        });
        setSelectedId(updated.id);
        setEditorState(null);
        notify('已保存修改', 'success');
    }, [notify]);

    const handleDelete = useCallback(async (id: string) => {
        const ok = await confirm({
            title: '删除脚本',
            message: '删除后无法恢复，确定继续吗？',
            confirmText: '删除',
            variant: 'danger',
        });
        if (!ok) return;
        try {
            await deleteSnippet(id);
            setSnippets((prev) => prev.filter((s) => s.id !== id));
            setSelectedId((cur) => (cur === id ? null : cur));
            notify('已删除', 'success');
        } catch (err: any) {
            notify(err?.message || '删除失败', 'error');
        }
    }, [confirm, notify]);

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
        return snippets.filter((s) => {
            if (langFilter && s.language !== langFilter) return false;
            if (tagFilter && !s.tags.includes(tagFilter)) return false;

            const updated = new Date(s.updatedAt).getTime();
            if (range.from !== null && (!Number.isNaN(updated)) && updated < range.from) return false;
            if (range.to !== null && (!Number.isNaN(updated)) && updated > range.to) return false;

            if (q) {
                const hay = [
                    s.title,
                    s.description || '',
                    s.code,
                    s.tags.join(' '),
                    s.language,
                ].join('\n').toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [snippets, query, tagFilter, langFilter, datePreset, customRange]);

    const selected = useMemo(
        () => filtered.find((s) => s.id === selectedId) || snippets.find((s) => s.id === selectedId) || null,
        [filtered, snippets, selectedId]
    );

    if (!sessionState) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
                <Loader2 size={20} className="animate-spin text-slate-400" />
            </div>
        );
    }

    if (!sessionState.authenticated) {
        return (
            <ScriptsLogin onLoggedIn={handleLoggedIn} onBack={onExit} />
        );
    }

    return (
        <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
            {/* Header */}
            <header className="px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-30">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <button
                            type="button"
                            onClick={onExit}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                            <ArrowLeft size={14} />
                            返回
                        </button>
                        <h1 className="text-base sm:text-lg font-semibold truncate">脚本库</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => fetchSnippets(true)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            disabled={refreshing}
                            aria-label="刷新"
                        >
                            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                            <span className="hidden sm:inline">刷新</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setEditorState({ mode: 'create' })}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent text-white text-sm font-semibold shadow-sm hover:bg-accent/90 transition-colors"
                        >
                            <Plus size={14} />
                            <span className="hidden sm:inline">新建</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleLogout}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            aria-label="登出"
                        >
                            <LogOut size={14} />
                            <span className="hidden sm:inline">登出</span>
                        </button>
                    </div>
                </div>
            </header>

            {/* Filters */}
            <div className="px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col sm:flex-row gap-2">
                        <div className="relative flex-1">
                            <Search
                                size={14}
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                            />
                            <input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder="搜索标题、描述、代码内容..."
                                className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/60"
                            />
                        </div>
                        <div className="flex gap-2">
                            <select
                                value={langFilter}
                                onChange={(e) => setLangFilter(e.target.value)}
                                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/60"
                            >
                                <option value="">全部语言</option>
                                {allLanguages.map((l) => (
                                    <option key={l} value={l}>{l}</option>
                                ))}
                            </select>
                            <select
                                value={tagFilter}
                                onChange={(e) => setTagFilter(e.target.value)}
                                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/60"
                            >
                                <option value="">全部标签</option>
                                {allTags.map((t) => (
                                    <option key={t} value={t}>{t}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="flex items-center flex-wrap gap-2">
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                            <Calendar size={12} />
                            时间:
                        </span>
                        {([
                            ['all', '全部'],
                            ['today', '今天'],
                            ['7d', '最近 7 天'],
                            ['month', '本月'],
                            ['year', '今年'],
                            ['custom', '自定义'],
                        ] as Array<[DateRangePreset, string]>).map(([key, label]) => (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setDatePreset(key)}
                                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                                    datePreset === key
                                        ? 'bg-accent text-white'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                                }`}
                            >
                                {label}
                            </button>
                        ))}
                        {datePreset === 'custom' && (
                            <div className="flex items-center gap-1.5">
                                <input
                                    type="date"
                                    value={customRange.from}
                                    onChange={(e) => setCustomRange((p) => ({ ...p, from: e.target.value }))}
                                    className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                                />
                                <span className="text-xs text-slate-400">~</span>
                                <input
                                    type="date"
                                    value={customRange.to}
                                    onChange={(e) => setCustomRange((p) => ({ ...p, to: e.target.value }))}
                                    className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                                />
                            </div>
                        )}
                        {(query || tagFilter || langFilter || datePreset !== 'all') && (
                            <button
                                type="button"
                                onClick={() => {
                                    setQuery('');
                                    setTagFilter('');
                                    setLangFilter('');
                                    setDatePreset('all');
                                    setCustomRange({ from: '', to: '' });
                                }}
                                className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                <Filter size={11} />
                                清除筛选
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-[320px_1fr] min-h-0">
                <aside className="md:border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-y-auto max-h-[calc(100vh-160px)] md:max-h-none">
                    {loading ? (
                        <div className="flex items-center justify-center py-16 text-slate-400">
                            <Loader2 size={20} className="animate-spin" />
                        </div>
                    ) : (
                        <SnippetList
                            snippets={filtered}
                            selectedId={selectedId}
                            onSelect={(s) => setSelectedId(s.id)}
                        />
                    )}
                </aside>

                <main className="bg-slate-50 dark:bg-slate-950 overflow-hidden">
                    {selected ? (
                        <SnippetViewer
                            snippet={selected}
                            onEdit={() => setEditorState({ mode: 'edit', snippet: selected })}
                            onDelete={() => handleDelete(selected.id)}
                        />
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-center px-6 py-16 text-slate-400 dark:text-slate-500">
                            <p className="text-sm mb-3">
                                {snippets.length === 0
                                    ? '还没有脚本，点击右上角「新建」开始'
                                    : '从左侧选择一个脚本查看详情'}
                            </p>
                            <button
                                type="button"
                                onClick={() => setEditorState({ mode: 'create' })}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent text-white text-sm font-semibold shadow-sm hover:bg-accent/90 transition-colors"
                            >
                                <Plus size={14} />
                                新建脚本
                            </button>
                        </div>
                    )}
                </main>
            </div>

            {editorState && (
                <SnippetEditor
                    initial={editorState.mode === 'edit' ? editorState.snippet : null}
                    onCancel={() => setEditorState(null)}
                    onSubmit={async (input) => {
                        if (editorState.mode === 'edit') {
                            await handleUpdate(editorState.snippet.id, input);
                        } else {
                            await handleCreate(input);
                        }
                    }}
                />
            )}
        </div>
    );
};

export default ScriptsVault;
