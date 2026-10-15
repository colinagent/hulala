import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import type { SearchFileResult, SearchMatch } from '../../services/fileService';
import { PopupMenu } from '../PopupMenu';
import {
  CaseSensitiveIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileIcon,
  FilterIcon,
  RegexIcon,
  SearchIcon,
  WholeWordIcon,
} from '../Icons';

const SEARCH_DEBOUNCE_MS = 180;

function summarize(totalCount: number, fileCount: number, truncated: boolean): string {
  if (totalCount <= 0) {
    return 'No matches';
  }
  const base = `${totalCount} match${totalCount === 1 ? '' : 'es'} in ${fileCount} file${fileCount === 1 ? '' : 's'}`;
  return truncated ? `${base} · truncated` : base;
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(idx + 1) || normalized : normalized;
}

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');
  return idx > 0 ? normalized.slice(0, idx) : '';
}

function relativeToRoot(path: string, root: string | null): string {
  if (!root) return path;
  const normalizedPath = path.replace(/\\/g, '/');
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  if (normalizedPath === normalizedRoot) return basename(normalizedPath);
  const prefix = `${normalizedRoot}/`;
  return normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : normalizedPath;
}

function middleEllipsis(input: string, max = 34): string {
  if (input.length <= max) return input;
  const left = Math.max(8, Math.floor((max - 1) * 0.42));
  const right = Math.max(8, max - left - 1);
  return `${input.slice(0, left)}…${input.slice(input.length - right)}`;
}

function utf8ByteLength(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (code <= 0x7f) return 1;
  if (code <= 0x7ff) return 2;
  if (code <= 0xffff) return 3;
  return 4;
}

function byteColumnToStringIndex(text: string, column: number): number {
  const byteOffset = Math.max(0, column - 1);
  let bytes = 0;
  let index = 0;
  for (const ch of text) {
    if (bytes >= byteOffset) return index;
    const len = utf8ByteLength(ch);
    if (bytes + len > byteOffset) return index;
    bytes += len;
    index += ch.length;
  }
  return text.length;
}

type SnippetPart = {
  text: string;
  match: boolean;
};

function buildSnippet(match: SearchMatch): SnippetPart[] {
  const lineText = match.text || '';
  if (!lineText) return [{ text: '', match: false }];

  const matchStart = byteColumnToStringIndex(lineText, match.column);
  const matchEnd = Math.max(matchStart + 1, byteColumnToStringIndex(lineText, match.endColumn));
  const beforeBudget = 18;
  const afterBudget = 64;
  const start = Math.max(0, matchStart - beforeBudget);
  const end = Math.min(lineText.length, matchEnd + afterBudget);

  const prefixEllipsis = start > 0 ? '…' : '';
  const suffixEllipsis = end < lineText.length ? '…' : '';
  const before = `${prefixEllipsis}${lineText.slice(start, matchStart)}`;
  const hit = lineText.slice(matchStart, matchEnd);
  const after = `${lineText.slice(matchEnd, end)}${suffixEllipsis}`;

  return [
    { text: before, match: false },
    { text: hit, match: true },
    { text: after, match: false },
  ].filter((part) => part.text.length > 0);
}

function SearchOptionButton({
  active,
  title,
  children,
  onClick,
}: {
  active: boolean;
  title: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-7 w-7 items-center justify-center rounded transition-colors ${
        active
          ? 'bg-search-match-bg text-search-match-text'
          : 'text-secondary-text hover:bg-hover-bg hover:text-prime-text'
      }`}
    >
      {children}
    </button>
  );
}

function FiltersPopup({
  currentDir,
  includes,
  excludes,
  setIncludes,
  setExcludes,
}: {
  currentDir: string | null;
  includes: string;
  excludes: string;
  setIncludes: (value: string) => void;
  setExcludes: (value: string) => void;
}) {
  return (
    <PopupMenu substrate="sidebar" className="absolute left-0 top-8 z-30 w-[min(340px,calc(100vw-40px))] p-2">
      <label className="block text-[11px] font-medium uppercase tracking-wide text-tertiary-text">
        Files to include
      </label>
      <input
        type="text"
        value={includes}
        onChange={(event) => setIncludes(event.target.value)}
        placeholder="e.g. **/*.md, src/**"
        className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-xs text-prime-text outline-none transition-colors placeholder:text-secondary-text focus:border-brand"
      />

      <label className="mt-3 block text-[11px] font-medium uppercase tracking-wide text-tertiary-text">
        Files to exclude
      </label>
      <input
        type="text"
        value={excludes}
        onChange={(event) => setExcludes(event.target.value)}
        placeholder="e.g. node_modules, dist"
        className="mt-1 h-8 w-full rounded border border-border bg-background px-2 text-xs text-prime-text outline-none transition-colors placeholder:text-secondary-text focus:border-brand"
      />

      <div className="mt-3 border-t border-border pt-2 text-[11px] text-secondary-text">
        <div className="mb-1 text-tertiary-text">Search root</div>
        <div className="truncate" title={currentDir || 'No folder selected'}>
          {currentDir || 'No folder selected'}
        </div>
      </div>
    </PopupMenu>
  );
}

function SearchMatchRow({
  file,
  match,
  onOpen,
}: {
  file: SearchFileResult;
  match: SearchMatch;
  onOpen: () => void;
}) {
  const snippet = useMemo(() => buildSnippet(match), [match]);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full min-w-0 items-center gap-2 rounded px-2 py-1 text-left transition-colors hover:bg-hover-bg"
      title={`${file.path}:${match.line}:${match.column}`}
    >
      <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-tertiary-text group-hover:text-secondary-text">
        {match.line}
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] leading-5 text-secondary-text group-hover:text-prime-text">
        {snippet.map((part, index) => part.match ? (
          <mark
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            className="rounded-sm bg-search-match-bg px-0.5 text-search-match-text"
          >
            {part.text}
          </mark>
        ) : (
          // eslint-disable-next-line react/no-array-index-key
          <span key={index}>{part.text}</span>
        ))}
      </span>
    </button>
  );
}

function SearchFileGroup({
  file,
  currentDir,
  collapsed,
  onToggle,
  onOpenMatch,
}: {
  file: SearchFileResult;
  currentDir: string | null;
  collapsed: boolean;
  onToggle: () => void;
  onOpenMatch: (match: SearchMatch) => void;
}) {
  const relativePath = relativeToRoot(file.path, currentDir);
  const name = basename(relativePath);
  const parent = dirname(relativePath);
  const firstMatch = file.matches[0];

  return (
    <div className="border-b border-border/70 py-1">
      <div className="flex min-w-0 items-center gap-1 px-1">
        <button
          type="button"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-secondary-text hover:bg-hover-bg hover:text-prime-text"
          onClick={onToggle}
          title={collapsed ? 'Expand file matches' : 'Collapse file matches'}
          aria-label={collapsed ? 'Expand file matches' : 'Collapse file matches'}
        >
          {collapsed ? <ChevronRightIcon className="w-3.5 h-3.5" /> : <ChevronDownIcon className="w-3.5 h-3.5" />}
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-hover-bg"
          onClick={() => {
            if (firstMatch) onOpenMatch(firstMatch);
          }}
          title={file.path}
        >
          <FileIcon className="h-3.5 w-3.5 shrink-0 text-secondary-text" />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-prime-text">
            {name || file.path}
          </span>
          {parent ? (
            <span className="max-w-[120px] shrink truncate text-[11px] text-tertiary-text" title={parent}>
              {middleEllipsis(parent)}
            </span>
          ) : null}
          <span className="ml-1 shrink-0 rounded-full bg-secondary-bg px-1.5 py-0.5 text-[10px] tabular-nums text-secondary-text">
            {file.count || file.matches.length}
          </span>
        </button>
      </div>
      {!collapsed ? (
        <div className="mt-0.5 space-y-0.5 pr-1">
          {file.matches.map((match) => (
            <SearchMatchRow
              key={`${file.path}:${match.line}:${match.column}:${match.endColumn}:${match.text}`}
              file={file}
              match={match}
              onOpen={() => onOpenMatch(match)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SearchSidebar() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const filterPopupRef = useRef<HTMLDivElement | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(() => new Set());

  const currentDir = useAppStore((state) => state.currentDir);
  const query = useAppStore((state) => state.sidebarSearchQuery);
  const includes = useAppStore((state) => state.sidebarSearchIncludes);
  const excludes = useAppStore((state) => state.sidebarSearchExcludes);
  const flags = useAppStore((state) => state.sidebarSearchFlags);
  const loading = useAppStore((state) => state.sidebarSearchLoading);
  const error = useAppStore((state) => state.sidebarSearchError);
  const results = useAppStore((state) => state.sidebarSearchResults);
  const totalCount = useAppStore((state) => state.sidebarSearchTotalCount);
  const truncated = useAppStore((state) => state.sidebarSearchTruncated);
  const setQuery = useAppStore((state) => state.setSidebarSearchQuery);
  const setIncludes = useAppStore((state) => state.setSidebarSearchIncludes);
  const setExcludes = useAppStore((state) => state.setSidebarSearchExcludes);
  const setFlag = useAppStore((state) => state.setSidebarSearchFlag);
  const clear = useAppStore((state) => state.clearSidebarSearchState);
  const runSearch = useAppStore((state) => state.runSidebarSearch);
  const openFile = useAppStore((state) => state.openFile);

  const filtersActive = includes.trim().length > 0 || excludes.trim().length > 0;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!filtersOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (filterButtonRef.current?.contains(target)) return;
      if (filterPopupRef.current?.contains(target)) return;
      setFiltersOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [filtersOpen]);

  useEffect(() => {
    if (!query.trim()) {
      clear();
      return;
    }
    const handle = window.setTimeout(() => {
      void runSearch();
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [clear, currentDir, excludes, flags.matchCase, flags.regex, flags.wholeWord, includes, query, runSearch]);

  // 结果变更时清理已不存在文件的折叠状态。
  useEffect(() => {
    setCollapsedFiles((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      for (const file of results) {
        if (prev.has(file.path)) next.add(file.path);
      }
      return next;
    });
  }, [results]);

  const summary = useMemo(
    () => summarize(totalCount, results.length, truncated),
    [results.length, totalCount, truncated],
  );

  const statusText = loading ? 'Searching…' : error ? 'Search failed' : summary;

  return (
    <div className="flex h-full flex-col text-prime-text">
      <div className="border-b border-border px-3 py-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-tertiary-text" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            className="h-9 w-full rounded border border-border bg-transparent pl-8 pr-[96px] text-sm text-prime-text outline-none transition-colors placeholder:text-secondary-text focus:border-brand"
          />
          <div className="absolute right-1 top-1 flex items-center gap-0.5">
            <SearchOptionButton
              active={flags.matchCase}
              title="Match case"
              onClick={() => setFlag('matchCase', !flags.matchCase)}
            >
              <CaseSensitiveIcon className="h-3.5 w-3.5" />
            </SearchOptionButton>
            <SearchOptionButton
              active={flags.wholeWord}
              title="Match whole word"
              onClick={() => setFlag('wholeWord', !flags.wholeWord)}
            >
              <WholeWordIcon className="h-3.5 w-3.5" />
            </SearchOptionButton>
            <SearchOptionButton
              active={flags.regex}
              title="Use regular expression"
              onClick={() => setFlag('regex', !flags.regex)}
            >
              <RegexIcon className="h-3.5 w-3.5" />
            </SearchOptionButton>
          </div>
        </div>

        <div className="relative mt-2 flex items-center justify-between gap-2 text-[11px]">
          <button
            ref={filterButtonRef}
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            className={`relative inline-flex h-7 items-center gap-1 rounded px-2 transition-colors ${
              filtersOpen || filtersActive
                ? 'text-highlight hover:bg-hover-bg'
                : 'text-secondary-text hover:bg-hover-bg hover:text-prime-text'
            }`}
            title="Search filters"
          >
            <FilterIcon className="h-3.5 w-3.5" />
            <span>Filters</span>
            {filtersActive ? (
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />
            ) : null}
          </button>
          <div className={`min-w-0 flex-1 truncate text-right ${error ? 'text-accent' : 'text-secondary-text'}`}>
            {statusText}
          </div>
          {filtersOpen ? (
            <div ref={filterPopupRef}>
              <FiltersPopup
                currentDir={currentDir}
                includes={includes}
                excludes={excludes}
                setIncludes={setIncludes}
                setExcludes={setExcludes}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-auto py-1">
        {error ? (
          <div className="px-3 py-3 text-sm text-accent">{error}</div>
        ) : null}
        {!error && !loading && query.trim() && results.length === 0 ? (
          <div className="px-3 py-3 text-sm text-secondary-text">No results found.</div>
        ) : null}
        {!error && !query.trim() ? (
          <div className="px-3 py-3 text-sm text-secondary-text">Type to search in the current folder.</div>
        ) : null}
        {results.map((file) => (
          <SearchFileGroup
            key={file.path}
            file={file}
            currentDir={currentDir}
            collapsed={collapsedFiles.has(file.path)}
            onToggle={() => {
              setCollapsedFiles((prev) => {
                const next = new Set(prev);
                if (next.has(file.path)) next.delete(file.path);
                else next.add(file.path);
                return next;
              });
            }}
            onOpenMatch={(match) => {
              void openFile(file.path, {
                reveal: { line: match.line, column: match.column },
                focusEditor: true,
              });
            }}
          />
        ))}
      </div>
    </div>
  );
}
