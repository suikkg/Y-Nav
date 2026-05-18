import React from 'react';
import { Search, Calendar, Filter, Star } from 'lucide-react';
import { SnippetSortKey } from '../../types';
import {
  ALL_SEARCH_SCOPES,
  DateRangePreset,
  SEARCH_SCOPE_LABELS,
  SORT_LABELS,
  ScriptsVaultData,
  VALID_SORTS,
} from './useScriptsVaultData';

interface Props {
  data: ScriptsVaultData;
}

const DATE_PRESETS: ReadonlyArray<[DateRangePreset, string]> = [
  ['all', '全部'],
  ['today', '今天'],
  ['7d', '最近 7 天'],
  ['month', '本月'],
  ['year', '今年'],
  ['custom', '自定义'],
];

const ScriptsVaultFilters: React.FC<Props> = ({ data }) => {
  const {
    query,
    setQuery,
    sortKey,
    setSortKey,
    langFilter,
    setLangFilter,
    tagFilter,
    setTagFilter,
    favoritesOnly,
    setFavoritesOnly,
    allLanguages,
    allTags,
    searchScopes,
    toggleSearchScope,
    datePreset,
    setDatePreset,
    customRange,
    setCustomRange,
  } = data;

  const hasActiveFilter =
    !!query || !!tagFilter || !!langFilter || datePreset !== 'all' || favoritesOnly;

  return (
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
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SnippetSortKey)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/60"
              aria-label="排序方式"
            >
              {(VALID_SORTS as readonly SnippetSortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
            <select
              value={langFilter}
              onChange={(e) => setLangFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/60"
            >
              <option value="">全部语言</option>
              {allLanguages.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/60"
            >
              <option value="">全部标签</option>
              {allTags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setFavoritesOnly(!favoritesOnly)}
              aria-pressed={favoritesOnly}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                favoritesOnly
                  ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                  : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
              title="仅显示收藏"
            >
              <Star size={14} className={favoritesOnly ? 'fill-amber-400 text-amber-500' : ''} />
              <span className="hidden sm:inline">收藏</span>
            </button>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <Search size={12} />
            范围:
          </span>
          {ALL_SEARCH_SCOPES.map((scope) => (
            <button
              key={scope}
              type="button"
              onClick={() => toggleSearchScope(scope)}
              aria-pressed={searchScopes.has(scope)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                searchScopes.has(scope)
                  ? 'bg-accent text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {SEARCH_SCOPE_LABELS[scope]}
            </button>
          ))}
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <Calendar size={12} />
            时间:
          </span>
          {DATE_PRESETS.map(([key, label]) => (
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
          {hasActiveFilter && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setTagFilter('');
                setLangFilter('');
                setDatePreset('all');
                setCustomRange({ from: '', to: '' });
                setFavoritesOnly(false);
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
  );
};

export default ScriptsVaultFilters;
