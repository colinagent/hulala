import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { CloseButton } from '../Icons';
import { useBlockingModal } from '../../utils/useBlockingModal';
import {
  dedupeDirectoryPickerPaths,
  detectDirectoryPickerPathStyle,
  directoryPickerPathsEqual,
  getDirectoryPickerBaseName,
  getDirectoryPickerParentPath,
  isAbsoluteDirectoryPickerPath,
  isDirectoryPickerRootPath,
  joinDirectoryPickerPath,
  normalizeDirectoryPickerPath,
  type DirectoryPickerPathStyle,
} from './directoryPickerModel';
import { MillerColumns, type MillerColumnsProvider } from './MillerColumns';

export type DirectoryPickerQuickAccessItem = {
  key: string;
  label: string;
  path: string;
};

export type DirectoryPickerProvider = MillerColumnsProvider & {
  statPath: (path: string) => Promise<{
    path?: string;
    name?: string;
    size?: number;
    isDir?: boolean;
    modTime?: number;
    error?: string;
  }>;
  getQuickAccess: () => Promise<DirectoryPickerQuickAccessItem[]>;
};

type DirectoryPickerDialogProps = {
  open: boolean;
  mode?: 'directory' | 'saveFile' | 'openFile';
  title: string;
  subtitle?: string | null;
  defaultPath?: string | null;
  currentPath?: string | null;
  recentPaths?: string[];
  submitLabel?: string;
  defaultFileName?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  /** Allow creating files/folders via + in column headers */
  allowCreate?: boolean;
  /** Start selection work after closing the dialog instead of blocking on it. */
  asyncSelect?: boolean;
  provider: DirectoryPickerProvider | null;
  onClose: () => void;
  onSelect: (path: string) => Promise<void>;
};

export function DirectoryPickerDialog({
  open,
  mode = 'directory',
  title,
  subtitle,
  defaultPath,
  currentPath,
  recentPaths = [],
  submitLabel = 'OK',
  defaultFileName = '',
  filters,
  allowCreate = false,
  asyncSelect = false,
  provider,
  onClose,
  onSelect,
}: DirectoryPickerDialogProps) {
  useBlockingModal(open);

  const isSaveMode = mode === 'saveFile';

  const initialPath = useMemo(() => {
    const base = defaultPath || currentPath || '/';
    return normalizeDirectoryPickerPath(base);
  }, [currentPath, defaultPath]);

  const pathStyle = useMemo<DirectoryPickerPathStyle>(
    () => detectDirectoryPickerPathStyle(initialPath || '/'),
    [initialPath],
  );

  // --- Core state ---
  const [browsePath, setBrowsePath] = useState(initialPath || '/');
  const [selectedChild, setSelectedChild] = useState<string | null>(null);
  const [inputPath, setInputPath] = useState(initialPath || '/');
  const [quickAccess, setQuickAccess] = useState<DirectoryPickerQuickAccessItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState(defaultFileName);

  const validationSeqRef = useRef(0);

  const normalizedCurrentPath = useMemo(
    () => normalizeDirectoryPickerPath(currentPath || '', pathStyle),
    [currentPath, pathStyle],
  );

  const targetPath = useMemo(
    () => normalizeDirectoryPickerPath(inputPath, pathStyle),
    [inputPath, pathStyle],
  );

  const saveFilePath = useMemo(() => {
    if (!isSaveMode || !fileName.trim()) return '';
    const dirPath = normalizeDirectoryPickerPath(inputPath, pathStyle);
    if (!dirPath) return fileName.trim();
    return joinDirectoryPickerPath(dirPath, fileName.trim(), pathStyle);
  }, [fileName, inputPath, isSaveMode, pathStyle]);

  const targetMatchesCurrent = Boolean(
    normalizedCurrentPath && directoryPickerPathsEqual(targetPath, normalizedCurrentPath, pathStyle),
  );

  const [targetValidation, setTargetValidation] = useState<{
    checking: boolean;
    isDir: boolean;
    error: string | null;
  }>({ checking: false, isDir: false, error: null });

  // --- Reset on open ---
  useEffect(() => {
    if (!open) return;
    const initial = normalizeDirectoryPickerPath(initialPath || '/', pathStyle) || '/';
    if (isDirectoryPickerRootPath(initial, pathStyle)) {
      setBrowsePath(initial);
      setSelectedChild(null);
    } else {
      setBrowsePath(getDirectoryPickerParentPath(initial, pathStyle));
      setSelectedChild(getDirectoryPickerBaseName(initial, pathStyle));
    }
    setInputPath(initial);
    setQuickAccess([]);
    setSubmitting(false);
    setError(null);
    setTargetValidation({ checking: false, isDir: false, error: null });
    setFileName(defaultFileName);
  }, [open, initialPath, pathStyle, defaultFileName]);

  // --- Load quick access ---
  useEffect(() => {
    if (!open || !provider) return;
    let active = true;
    provider.getQuickAccess()
      .then((items) => { if (active) setQuickAccess(items || []); })
      .catch(() => { if (active) setQuickAccess([]); });
    return () => { active = false; };
  }, [open, provider]);

  // --- Validate target (directory mode only) ---
  useEffect(() => {
    if (!open || !provider || isSaveMode) return;
    if (!targetPath || !isAbsoluteDirectoryPickerPath(targetPath, pathStyle)) {
      setTargetValidation({ checking: false, isDir: false, error: 'Path must be absolute' });
      return;
    }
    if (targetMatchesCurrent) {
      setTargetValidation({ checking: false, isDir: true, error: null });
      return;
    }
    const seq = validationSeqRef.current + 1;
    validationSeqRef.current = seq;
    setTargetValidation({ checking: true, isDir: false, error: null });
    provider.statPath(targetPath).then(
      (result) => {
        if (validationSeqRef.current !== seq) return;
        if (result.error) setTargetValidation({ checking: false, isDir: false, error: result.error });
        else if (!result.isDir) setTargetValidation({ checking: false, isDir: false, error: null });
        else setTargetValidation({ checking: false, isDir: true, error: null });
      },
      (err: Error) => {
        if (validationSeqRef.current !== seq) return;
        setTargetValidation({ checking: false, isDir: false, error: err.message || 'Validation failed' });
      },
    );
  }, [open, provider, targetPath, pathStyle, targetMatchesCurrent, isSaveMode]);

  // --- Navigation ---
  const navigateToPath = useCallback((path: string) => {
    const normalized = normalizeDirectoryPickerPath(path, pathStyle);
    if (!normalized) return;
    if (isDirectoryPickerRootPath(normalized, pathStyle)) {
      setBrowsePath(normalized);
      setSelectedChild(null);
    } else {
      setBrowsePath(getDirectoryPickerParentPath(normalized, pathStyle));
      setSelectedChild(getDirectoryPickerBaseName(normalized, pathStyle));
    }
    setInputPath(normalized);
    setError(null);
  }, [pathStyle]);

  const handleMillerNavigate = useCallback((newBrowse: string, newChild: string | null, target: string) => {
    setBrowsePath(newBrowse);
    setSelectedChild(newChild);
    setInputPath(target);
    setError(null);
  }, []);

  const handleInputSubmit = async () => {
    if (!provider) { setError('Provider unavailable'); return; }
    const path = normalizeDirectoryPickerPath(inputPath, pathStyle);
    if (!path || !isAbsoluteDirectoryPickerPath(path, pathStyle)) {
      setError('Path must be absolute'); return;
    }
    try {
      const stat = await provider.statPath(path);
      if (stat.error) { setError(stat.error); return; }
      if (!stat.isDir) {
        if (mode === 'openFile') { await onSelect(path); onClose(); return; }
        setError('Path is not a directory'); return;
      }
      navigateToPath(path);
    } catch (err) {
      setError((err as Error).message || 'Failed to navigate');
    }
  };

  const handleConfirm = async () => {
    if (!provider) { setError('Provider unavailable'); return; }
    if (isSaveMode) {
      if (!saveFilePath) { setError('File name is required'); return; }
      setSubmitting(true);
      setError(null);
      try { await onSelect(saveFilePath); onClose(); }
      catch (err) { setError((err as Error).message || 'Failed to save file'); }
      finally { setSubmitting(false); }
      return;
    }
    const path = normalizeDirectoryPickerPath(inputPath, pathStyle);
    if (!path || !isAbsoluteDirectoryPickerPath(path, pathStyle)) {
      setError('Path must be absolute'); return;
    }
    if (targetMatchesCurrent) return;
    if (asyncSelect) {
      onClose();
      void onSelect(path).catch((err) => {
        console.error('Async directory selection failed:', err);
      });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const stat = await provider.statPath(path);
      if (stat.error) { setError(stat.error); return; }
      if (mode === 'openFile' ? stat.isDir : !stat.isDir) { setError(mode === 'openFile' ? 'Choose a file' : 'Not a directory'); return; }
      await onSelect(path);
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Failed to select directory');
    } finally {
      setSubmitting(false);
    }
  };

  // --- Derived UI ---
  const uniqueQuickAccess = useMemo(() => {
    const seen = new Set<string>();
    return quickAccess.filter((item) => {
      const normalized = normalizeDirectoryPickerPath(item.path, pathStyle);
      const key = pathStyle === 'windows' ? normalized.toLowerCase() : normalized;
      if (!normalized || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [pathStyle, quickAccess]);

  const recentPills = useMemo(() => {
    const merged = dedupeDirectoryPickerPaths(
      [normalizedCurrentPath, ...recentPaths].filter((item): item is string => Boolean(item?.trim())),
      pathStyle,
    );
    return merged.slice(0, 6);
  }, [normalizedCurrentPath, pathStyle, recentPaths]);

  const statusMessage = !provider
    ? 'The Host connection is unavailable. Reconnect and try again.'
    : error || (targetMatchesCurrent ? null : targetValidation.error);

  const submitDisabled = isSaveMode
    ? (!provider || submitting || !saveFilePath)
    : (!provider || submitting || !targetPath
      || !isAbsoluteDirectoryPickerPath(targetPath, pathStyle)
      || targetMatchesCurrent
      || targetValidation.checking || Boolean(targetValidation.error)
      || (mode === 'openFile' ? targetValidation.isDir : !targetValidation.isDir));

  if (!open) return null;

  return createPortal(
    <div className="no-drag fixed inset-0 z-[11000] flex items-center justify-center" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!submitting) onClose(); }
      if (event.key === 'Tab') {
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')].filter(control => control.getClientRects().length);
        const target = event.shiftKey && document.activeElement === controls[0] ? controls.at(-1) : !event.shiftKey && document.activeElement === controls.at(-1) ? controls[0] : undefined;
        if (target) { event.preventDefault(); target.focus(); }
      }
    }}>
      <div className="absolute inset-0 bg-black/50" onMouseDown={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex w-[700px] max-w-[calc(100vw-32px)] h-[520px] max-h-[80vh] flex-col overflow-hidden rounded-lg border border-border bg-overlay-bg shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-prime-text">{title}</div>
            {subtitle ? <div className="mt-0.5 truncate text-xs text-secondary-text">{subtitle}</div> : null}
          </div>
          <CloseButton title="Close" onClick={onClose} />
        </div>

        {/* Quick Access */}
        {uniqueQuickAccess.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2">
            {uniqueQuickAccess.map((item) => {
              const isActive = directoryPickerPathsEqual(item.path, browsePath, pathStyle);
              return (
                <button
                  key={item.key}
                  type="button"
                  title={item.path}
                  onClick={() => navigateToPath(item.path)}
                  className={[
                    'ui-capsule-pill transition-colors',
                    isActive ? 'text-[color:var(--color-highlight)]' : 'hover:text-link-text-hover',
                  ].join(' ')}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        ) : null}

        {/* Path input */}
        <div className="border-b border-border px-4 py-2">
          <form onSubmit={(event) => { event.preventDefault(); void handleInputSubmit(); }}>
            <input
              type="text"
              value={inputPath}
              onChange={(event) => { setInputPath(event.target.value); setError(null); }}
              className="w-full rounded border border-border bg-editor-bg px-3 py-1.5 text-sm text-prime-text outline-none focus:border-active-border"
              placeholder={provider?.kind === 'local' ? '/Users/example/code' : '/root/code'}
              autoFocus={!isSaveMode}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
            />
          </form>
        </div>

        {/* Status */}
        {statusMessage ? (
          <div className="shrink-0 px-4 py-1.5 text-sm text-accent">{statusMessage}</div>
        ) : null}

        {/* Miller columns */}
        <div className="flex min-h-0 flex-1 border-b border-border">
          <MillerColumns
            initialPath={initialPath || '/'}
            browsePath={browsePath}
            selectedChild={selectedChild}
            pathStyle={pathStyle}
            provider={provider}
            allowCreate={allowCreate}
            // Default should show both files and folders. If a future caller really wants
            // directory-only behavior, that should be an explicit opt-in at the MillerColumns layer.
            directoriesOnly={false}
            onNavigate={handleMillerNavigate}
          />
        </div>

        {/* Recent pills */}
        {recentPills.length > 0 ? (
          <div className="flex items-center gap-2 border-b border-border px-4 py-2 overflow-hidden">
            <span className="shrink-0 text-xs text-secondary-text">Recent</span>
            <div className="flex gap-1.5 overflow-x-auto">
              {recentPills.map((path) => {
                const isActive = directoryPickerPathsEqual(path, targetPath, pathStyle);
                const isCurrent = directoryPickerPathsEqual(path, normalizedCurrentPath, pathStyle);
                return (
                  <button
                    key={path}
                    type="button"
                    title={path}
                    className={[
                      'ui-capsule-pill shrink-0 transition-colors',
                      isActive ? 'text-[color:var(--color-highlight)]' : 'hover:text-link-text-hover',
                    ].join(' ')}
                    onClick={() => navigateToPath(path)}
                  >
                    {getDirectoryPickerBaseName(path, pathStyle)}
                    {isCurrent ? ' ·' : ''}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Save-file: full path input */}
        {isSaveMode ? (
          <div className="border-t border-border px-4 py-2">
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-xs text-secondary-text">Save as</span>
              <input
                type="text"
                value={saveFilePath}
                onChange={(event) => {
                  const raw = event.target.value;
                  const sep = pathStyle === 'windows' ? '\\' : '/';
                  const lastSep = raw.lastIndexOf(sep);
                  if (lastSep >= 0) {
                    const dirPart = raw.slice(0, lastSep) || sep;
                    const namePart = raw.slice(lastSep + 1);
                    setFileName(namePart);
                    const normalizedDir = normalizeDirectoryPickerPath(dirPart, pathStyle);
                    if (normalizedDir && isAbsoluteDirectoryPickerPath(normalizedDir, pathStyle)) {
                      navigateToPath(normalizedDir);
                    }
                  } else {
                    setFileName(raw);
                  }
                  setError(null);
                }}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void handleConfirm(); } }}
                className="min-w-0 flex-1 rounded border border-border bg-editor-bg px-2 py-1 text-sm text-prime-text outline-none focus:border-active-border"
                placeholder="/path/to/file.md"
                autoFocus={isSaveMode}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          </div>
        ) : null}

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3">
          <button type="button" className="dialog-action-btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="ui-pill-btn-primary op-sg-capsule op-sg--on-overlay px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            disabled={submitDisabled}
            onClick={() => { void handleConfirm(); }}
          >
            {submitting ? 'Working...' : submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
