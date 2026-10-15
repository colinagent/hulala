/**
 * MillerColumns — a reusable 3-column directory browser (parent / current / child).
 *
 * Standalone component, no dialog/modal coupling.
 * Consumers supply a provider and get navigation callbacks.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PlusIcon } from '../Icons';
import { IconButton } from '../IconButton';
import { FileTreeFolderIcon, FileTreeFileIcon } from '../FileExplorer/FileTreeIcons';
import { useFileExcludeStore } from '../../store/fileExcludeStore';
import { filterFileEntries } from '../../../shared/fileExcludes';
import {
  detectDirectoryPickerPathStyle,
  directoryPickerPathsEqual,
  getDirectoryPickerBaseName,
  getDirectoryPickerParentPath,
  isAbsoluteDirectoryPickerPath,
  isDirectoryPickerRootPath,
  joinDirectoryPickerPath,
  normalizeDirectoryPickerPath,
  sortDirectoryPickerEntries,
  type DirectoryPickerEntry,
  type DirectoryPickerPathStyle,
} from './directoryPickerModel';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export type MillerColumnsProvider = {
  kind: 'local' | 'remote';
  listDirectory: (path: string) => Promise<{
    entries?: DirectoryPickerEntry[];
    error?: string;
  }>;
  mkdir?: (path: string) => Promise<{ success?: boolean; error?: string }>;
  writeFile?: (path: string, content: string) => Promise<{ error?: string }>;
};

// ---------------------------------------------------------------------------
// Public props
// ---------------------------------------------------------------------------

export type MillerColumnsProps = {
  /** Absolute path to centre the columns around */
  initialPath: string;
  /** Controlled browse path (overrides internal state when set) */
  browsePath?: string;
  selectedChild?: string | null;
  pathStyle?: DirectoryPickerPathStyle;
  provider: MillerColumnsProvider | null;
  /** Allow creating files/folders via the + button in each column header */
  allowCreate?: boolean;
  /** Hide non-directory entries */
  directoriesOnly?: boolean;
  onNavigate?: (browsePath: string, selectedChild: string | null, targetPath: string) => void;
};

// ---------------------------------------------------------------------------
// Inline create row
// ---------------------------------------------------------------------------

type InlineCreateState = {
  column: 'left' | 'middle' | 'right';
  kind: 'file' | 'folder';
};

function InlineCreateRow({
  kind,
  onSubmit,
  onCancel,
}: {
  kind: 'file' | 'folder';
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed && !submittedRef.current) {
      submittedRef.current = true;
      onSubmit(trimmed);
    }
  };

  const handleBlur = () => {
    // Delay cancel so that Enter→submit can fire first
    setTimeout(() => {
      if (!submittedRef.current) onCancel();
    }, 80);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1 bg-hover-bg">
      <span className="file-tree-icon shrink-0">
        {kind === 'folder' ? <FileTreeFolderIcon open={false} /> : <FileTreeFileIcon />}
      </span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
          if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        onBlur={handleBlur}
        className="min-w-0 flex-1 bg-transparent text-sm text-prime-text outline-none"
        placeholder={kind === 'folder' ? 'New folder' : 'New file'}
        spellCheck={false}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single column
// ---------------------------------------------------------------------------

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) {
    return '—';
  }
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  if (size < 1024 * 1024 * 1024) return `${Math.round(size / (1024 * 102.4)) / 10} MB`;
  return `${Math.round(size / (1024 * 1024 * 102.4)) / 10} GB`;
}

function formatModifiedTime(modTime: number): string {
  if (!Number.isFinite(modTime) || modTime <= 0) {
    return '—';
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(modTime));
  } catch {
    return '—';
  }
}

function formatFileKind(name: string): string {
  const trimmed = name.trim();
  const dotIndex = trimmed.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === trimmed.length - 1) {
    return 'File';
  }
  return `${trimmed.slice(dotIndex + 1).toUpperCase()} file`;
}

function FilePreviewColumn({
  header,
  entry,
}: {
  header: string;
  entry: DirectoryPickerEntry;
}) {
  return (
    <div className="flex w-1/3 min-w-0 flex-col overflow-hidden border-r border-border last:border-r-0">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-secondary-text">{header}</span>
      </div>
      <div className="flex-1 overflow-auto px-4 py-4">
        <div className="flex flex-col items-center text-center">
          <svg
            className="h-16 w-16 text-tertiary-text"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z" />
            <path d="M14 2v6h6" />
          </svg>
          <div className="mt-4 max-w-full truncate text-2xl font-semibold text-prime-text">{entry.name}</div>
          <div className="mt-1 text-sm text-secondary-text">
            {formatFileKind(entry.name)} · {formatFileSize(entry.size)}
          </div>
        </div>

        <div className="mt-6 overflow-hidden rounded border border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-sm">
            <span className="text-secondary-text">Type</span>
            <span className="ml-4 text-right text-prime-text">{formatFileKind(entry.name)}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border px-3 py-2 text-sm">
            <span className="text-secondary-text">Size</span>
            <span className="ml-4 text-right text-prime-text">{formatFileSize(entry.size)}</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 text-sm">
            <span className="text-secondary-text">Modified</span>
            <span className="ml-4 text-right text-prime-text">{formatModifiedTime(entry.modTime)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

type ColumnProps = {
  header: string;
  /** Absolute path this column represents (for create operations) */
  dirPath: string | null;
  entries: DirectoryPickerEntry[];
  loading: boolean;
  activeName?: string | null;
  emptyMessage?: string;
  disabled?: boolean;
  directoriesOnly?: boolean;
  allowCreate?: boolean;
  inlineCreate?: InlineCreateState | null;
  columnId: 'left' | 'middle' | 'right';
  onSelect: (name: string) => void;
  onRequestCreate?: (column: 'left' | 'middle' | 'right', kind: 'file' | 'folder') => void;
  onInlineCreateSubmit?: (name: string) => void;
  onInlineCreateCancel?: () => void;
};

function Column({
  header,
  dirPath,
  entries,
  loading,
  activeName,
  emptyMessage = 'Empty',
  disabled,
  directoriesOnly,
  allowCreate,
  inlineCreate,
  columnId,
  onSelect,
  onRequestCreate,
  onInlineCreateSubmit,
  onInlineCreateCancel,
}: ColumnProps) {
  const fileExcludePatterns = useFileExcludeStore((state) => state.patterns);

  const sortedEntries = useMemo(() => {
    const visibleEntries = dirPath
      ? filterFileEntries(entries, dirPath, fileExcludePatterns)
      : entries;
    const sorted = sortDirectoryPickerEntries(visibleEntries);
    return directoriesOnly ? sorted.filter((e) => e.isDir) : sorted;
  }, [dirPath, directoriesOnly, entries, fileExcludePatterns]);

  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (activeName && activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'center' });
    }
  }, [activeName, sortedEntries.length]);

  const showInlineCreate = inlineCreate?.column === columnId;
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!createMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (createMenuRef.current?.contains(e.target as Node)) return;
      setCreateMenuOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown, true);
    return () => window.removeEventListener('mousedown', onMouseDown, true);
  }, [createMenuOpen]);

  return (
    <div className="flex w-1/3 min-w-0 flex-col overflow-hidden border-r border-border last:border-r-0">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-secondary-text">{header}</span>
        {allowCreate && onRequestCreate ? (
          <div className="relative shrink-0" ref={createMenuRef}>
            <IconButton
              className="ml-1"
              title="New..."
              onClick={(e) => {
                e.stopPropagation();
                setCreateMenuOpen((v) => !v);
              }}
            >
              <PlusIcon className="w-3 h-3" />
            </IconButton>
            {createMenuOpen ? (
              <div className="absolute right-0 top-full z-50 mt-1 w-[140px] rounded-lg border border-border bg-overlay-bg p-1 shadow-xl">
                <button
                  type="button"
                  className="w-full rounded px-2 py-1.5 text-left text-sm text-secondary-text hover:bg-hover-bg hover:text-prime-text"
                  onClick={() => { setCreateMenuOpen(false); onRequestCreate(columnId, 'folder'); }}
                >
                  New Folder
                </button>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1.5 text-left text-sm text-secondary-text hover:bg-hover-bg hover:text-prime-text"
                  onClick={() => { setCreateMenuOpen(false); onRequestCreate(columnId, 'file'); }}
                >
                  New File
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {/* Entries */}
      <div className="flex-1 overflow-auto">
        {showInlineCreate && onInlineCreateSubmit && onInlineCreateCancel ? (
          <InlineCreateRow
            kind={inlineCreate!.kind}
            onSubmit={onInlineCreateSubmit}
            onCancel={onInlineCreateCancel}
          />
        ) : null}
        {loading ? (
          <div className="px-3 py-2 text-sm text-secondary-text">Loading...</div>
        ) : sortedEntries.length === 0 && !showInlineCreate ? (
          <div className="px-3 py-2 text-sm text-tertiary-text">{emptyMessage}</div>
        ) : (
          sortedEntries.map((entry) => {
            const isActive = entry.name === activeName;
            return (
              <button
                key={entry.name}
                ref={isActive ? activeRef : null}
                type="button"
                disabled={disabled}
                className={[
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors',
                  isActive ? 'bg-hover-bg text-prime-text font-medium' : 'text-prime-text',
                ].join(' ')}
                onClick={() => onSelect(entry.name)}
              >
                <span className="file-tree-icon shrink-0">
                  {entry.isDir ? <FileTreeFolderIcon open={false} /> : <FileTreeFileIcon />}
                </span>
                <span className="min-w-0 truncate">{entry.name}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MillerColumns (main export)
// ---------------------------------------------------------------------------

export function MillerColumns({
  initialPath,
  browsePath: controlledBrowse,
  selectedChild: controlledChild,
  pathStyle: explicitPathStyle,
  provider,
  allowCreate = false,
  directoriesOnly = false,
  onNavigate,
}: MillerColumnsProps) {
  const pathStyle = explicitPathStyle || detectDirectoryPickerPathStyle(initialPath);

  const [internalBrowse, setInternalBrowse] = useState(initialPath);
  const [internalChild, setInternalChild] = useState<string | null>(null);
  const [inlineCreate, setInlineCreate] = useState<InlineCreateState | null>(null);

  const browsePath = controlledBrowse ?? internalBrowse;
  const selectedChild = controlledChild !== undefined ? controlledChild : internalChild;

  // Cache
  const cacheRef = useRef(new Map<string, DirectoryPickerEntry[]>());
  const pendingRef = useRef(new Set<string>());
  const [renderSeq, setRenderSeq] = useState(0);

  const parentPath = useMemo(() => {
    const parent = getDirectoryPickerParentPath(browsePath, pathStyle);
    return directoryPickerPathsEqual(parent, browsePath, pathStyle) ? null : parent;
  }, [browsePath, pathStyle]);

  const childPath = useMemo(() => {
    if (!selectedChild) return null;
    return joinDirectoryPickerPath(browsePath, selectedChild, pathStyle);
  }, [browsePath, selectedChild, pathStyle]);

  const atRoot = isDirectoryPickerRootPath(browsePath, pathStyle);

  // Directory loader
  const loadDir = useCallback((dirPath: string) => {
    if (!provider) return;
    const key = normalizeDirectoryPickerPath(dirPath, pathStyle);
    if (!key || cacheRef.current.has(key) || pendingRef.current.has(key)) return;
    pendingRef.current.add(key);
    setRenderSeq((n) => n + 1);
    provider.listDirectory(key).then(
      (result) => {
        cacheRef.current.set(key, result.error ? [] : (result.entries || []));
        pendingRef.current.delete(key);
        setRenderSeq((n) => n + 1);
      },
      () => {
        cacheRef.current.set(key, []);
        pendingRef.current.delete(key);
        setRenderSeq((n) => n + 1);
      },
    );
  }, [pathStyle, provider]);

  // Helpers
  const getEntries = (p: string) => cacheRef.current.get(normalizeDirectoryPickerPath(p, pathStyle)) || [];
  const isDirPending = (p: string) => pendingRef.current.has(normalizeDirectoryPickerPath(p, pathStyle));
  const selectedChildEntry = useMemo(() => {
    if (!selectedChild) return null;
    return getEntries(browsePath).find((entry) => entry.name === selectedChild) || null;
  }, [browsePath, renderSeq, selectedChild]);
  const rightColumnShowsDirectory = Boolean(selectedChildEntry?.isDir);

  // Load columns
  useEffect(() => {
    if (!provider) return;
    if (parentPath) loadDir(parentPath);
    loadDir(browsePath);
    if (childPath && rightColumnShowsDirectory) loadDir(childPath);
  }, [provider, parentPath, browsePath, childPath, rightColumnShowsDirectory, loadDir]);
  // Navigation helpers
  const navigate = useCallback((newBrowse: string, newChild: string | null) => {
    setInternalBrowse(newBrowse);
    setInternalChild(newChild);
    const target = newChild ? joinDirectoryPickerPath(newBrowse, newChild, pathStyle) : newBrowse;
    onNavigate?.(newBrowse, newChild, target);
  }, [onNavigate, pathStyle]);

  const handleLeftClick = useCallback((name: string) => {
    if (!parentPath) return;
    navigate(parentPath, name);
  }, [navigate, parentPath]);

  const handleMiddleClick = useCallback((name: string) => {
    setInternalChild(name);
    const target = joinDirectoryPickerPath(browsePath, name, pathStyle);
    onNavigate?.(browsePath, name, target);
  }, [browsePath, onNavigate, pathStyle]);

  const handleRightClick = useCallback((name: string) => {
    if (!childPath) return;
    navigate(childPath, name);
  }, [childPath, navigate]);

  // Create operations
  const columnDirPath = useCallback((col: 'left' | 'middle' | 'right'): string | null => {
    if (col === 'left') return parentPath;
    if (col === 'middle') return browsePath;
    return childPath;
  }, [browsePath, childPath, parentPath]);

  const handleRequestCreate = useCallback((column: 'left' | 'middle' | 'right', kind: 'file' | 'folder') => {
    const dirPath = columnDirPath(column);
    if (!dirPath) return;
    setInlineCreate({ column, kind });
  }, [columnDirPath]);

  const refreshDirCache = useCallback(async (dirPath: string) => {
    const key = normalizeDirectoryPickerPath(dirPath, pathStyle);
    if (!key || !provider) return;
    cacheRef.current.delete(key);
    pendingRef.current.delete(key);
    const result = await provider.listDirectory(dirPath);
    cacheRef.current.set(key, result.entries || []);
    setRenderSeq((n) => n + 1);
  }, [pathStyle, provider]);

  const handleInlineCreateSubmit = useCallback(async (name: string) => {
    if (!inlineCreate || !provider) return;
    const column = inlineCreate.column;
    const dirPath = columnDirPath(column);
    if (!dirPath) { setInlineCreate(null); return; }
    const fullPath = joinDirectoryPickerPath(dirPath, name, pathStyle);

    setInlineCreate(null);

    try {
      if (inlineCreate.kind === 'folder') {
        if (!provider.mkdir) return;
        const result = await provider.mkdir(fullPath);
        if (result.error) { console.error('mkdir failed:', result.error); return; }
      } else {
        if (!provider.writeFile) return;
        const result = await provider.writeFile(fullPath, '');
        if (result.error) { console.error('writeFile failed:', result.error); return; }
      }

      // Refresh the column that contains the new item
      await refreshDirCache(dirPath);

      // Select the newly created item in the appropriate column
      if (column === 'left') {
        // Left column: clicking an item there makes it the middle column's browsePath
        navigate(parentPath!, name);
      } else if (column === 'middle') {
        // Middle column: select the new item as selectedChild
        setInternalChild(name);
        const target = joinDirectoryPickerPath(browsePath, name, pathStyle);
        onNavigate?.(browsePath, name, target);
      } else if (column === 'right' && childPath) {
        // Right column: navigate so the right column becomes the middle, new item selected
        navigate(childPath, name);
      }
    } catch (err) {
      console.error('Create failed:', err);
    }
  }, [browsePath, childPath, columnDirPath, inlineCreate, navigate, onNavigate, parentPath, pathStyle, provider, refreshDirCache]);

  const handleInlineCreateCancel = useCallback(() => {
    setInlineCreate(null);
  }, []);

  const canCreate = allowCreate && provider && (!!provider.mkdir || !!provider.writeFile);

  return (
    <div className="flex w-full min-h-0 flex-1">
      <Column
        header={parentPath ? getDirectoryPickerBaseName(parentPath, pathStyle) : atRoot ? browsePath : '—'}
        dirPath={parentPath}
        entries={parentPath ? getEntries(parentPath) : []}
        loading={parentPath ? isDirPending(parentPath) : false}
        activeName={parentPath ? getDirectoryPickerBaseName(browsePath, pathStyle) : null}
        emptyMessage={atRoot ? 'Root level' : 'Empty'}
        disabled={!parentPath}
        directoriesOnly={directoriesOnly}
        allowCreate={!!canCreate && !!parentPath}
        inlineCreate={inlineCreate}
        columnId="left"
        onSelect={handleLeftClick}
        onRequestCreate={handleRequestCreate}
        onInlineCreateSubmit={handleInlineCreateSubmit}
        onInlineCreateCancel={handleInlineCreateCancel}
      />
      <Column
        header={getDirectoryPickerBaseName(browsePath, pathStyle)}
        dirPath={browsePath}
        entries={getEntries(browsePath)}
        loading={isDirPending(browsePath)}
        activeName={selectedChild}
        emptyMessage="Empty directory"
        directoriesOnly={directoriesOnly}
        allowCreate={!!canCreate}
        inlineCreate={inlineCreate}
        columnId="middle"
        onSelect={handleMiddleClick}
        onRequestCreate={handleRequestCreate}
        onInlineCreateSubmit={handleInlineCreateSubmit}
        onInlineCreateCancel={handleInlineCreateCancel}
      />
      {selectedChildEntry && !selectedChildEntry.isDir ? (
        <FilePreviewColumn
          header={selectedChild || '—'}
          entry={selectedChildEntry}
        />
      ) : (
        <Column
          header={selectedChild || '—'}
          dirPath={childPath}
          entries={childPath ? getEntries(childPath) : []}
          loading={childPath && rightColumnShowsDirectory ? isDirPending(childPath) : false}
          emptyMessage={selectedChild ? 'Empty directory' : 'Select a directory'}
          directoriesOnly={directoriesOnly}
          allowCreate={!!canCreate && rightColumnShowsDirectory}
          inlineCreate={inlineCreate}
          columnId="right"
          onSelect={handleRightClick}
          onRequestCreate={handleRequestCreate}
          onInlineCreateSubmit={handleInlineCreateSubmit}
          onInlineCreateCancel={handleInlineCreateCancel}
        />
      )}
    </div>
  );
}
