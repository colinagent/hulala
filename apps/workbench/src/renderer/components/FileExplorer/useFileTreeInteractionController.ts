import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import {
  hasExternalTreeImportPayload,
  readNativeClipboardFilePaths,
} from '../../services/treeImportService';

import { useAppStore } from '../../store/appStore';
import { useToastStore } from '../../store/toastStore';
import { createTreeAutoExpandScheduler } from './treeImportDrop';
import { useFileTreeDndStore } from './fileTreeDndStore';
import { useFileTreeSelectionStore } from './fileTreeSelectionStore';
import {
  canMoveOrCopyIntoTarget,
  dedupeTopLevelItems,
  encodeFileTreeTransfer,
  FILE_TREE_TRANSFER_MIME,
  FILE_TREE_TRANSFER_SENTINEL,
  getBaseName,
  getParentDir,
  getVisibleFileTreePaths,
  hasFileTreeTransfer,
  isEqualOrParent,
  prepareFileTreeTransferOps,
  readFileTreeTransfer,
  type FileTreeTransferItem,
} from './fileTreeTransfer';

type CommitCallback = (affectedDirs: Set<string>) => Promise<void> | void;

type UseFileTreeInteractionControllerOptions = {
  enabled: boolean;
  ensureExpanded?: (dir: string) => void;
  getDefaultPasteTargetDir?: () => string | null;
  /** Clears transient tree selection when the backing workspace/root changes. */
  selectionResetKey?: string | null;
  onTransferCommitted?: CommitCallback;
  /** Finder/system file paste → active-tab tree-import (local or remote runtime). */
  onNativeClipboardPaste?: (absolutePaths: string[], targetDir: string) => Promise<boolean>;
};

function isCopyModifier(event: DragEvent | ReactDragEvent | KeyboardEvent | ReactKeyboardEvent): boolean {
  const isMac = window.hulala?.platform === 'darwin';
  return isMac ? !!event.altKey : !!event.ctrlKey;
}

function getScopeId() {
  return `file-tree-scope-${Math.random().toString(36).slice(2, 10)}`;
}

const FILE_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2Z"/><path d="M14 2v6h6"/></svg>';
const FOLDER_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6l2 2h8a2 2 0 0 1 2 2v11Z"/></svg>';

const GHOST_STYLE = 'position:fixed;top:-9999px;left:-9999px;display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:6px;background:#fff;border:1px solid #ddd;box-shadow:0 2px 8px rgba(0,0,0,0.12);font-size:13px;color:#333;white-space:nowrap;pointer-events:none;z-index:99999;max-width:300px;';
const BADGE_STYLE = 'display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#c87533;color:#fff;font-size:11px;font-weight:600;line-height:1;margin-left:2px;';
const EMPTY_SELECTION = new Set<string>();

function createDragGhost(items: FileTreeTransferItem[]): HTMLElement {
  const ghost = document.createElement('div');
  ghost.setAttribute('style', GHOST_STYLE);

  const first = items[0];
  const name = getBaseName(first.path);
  const iconSvg = first.isDir ? FOLDER_ICON_SVG : FILE_ICON_SVG;

  let html = `${iconSvg}<span style="overflow:hidden;text-overflow:ellipsis">${name}</span>`;
  if (items.length > 1) {
    html += `<span style="${BADGE_STYLE}">${items.length}</span>`;
  }
  ghost.innerHTML = html;

  document.body.appendChild(ghost);
  return ghost;
}

function removeDragGhost(ghost: HTMLElement | null) {
  if (ghost && ghost.parentNode) {
    ghost.parentNode.removeChild(ghost);
  }
}

function readRowMeta(container: HTMLElement | null): Map<string, FileTreeTransferItem> {
  const map = new Map<string, FileTreeTransferItem>();
  if (!container) {
    return map;
  }
  for (const element of Array.from(container.querySelectorAll<HTMLElement>('[data-file-path]'))) {
    const path = (element.dataset.filePath || '').trim();
    if (!path) continue;
    map.set(path, {
      path,
      isDir: element.dataset.fileIsDir === 'true',
    });
  }
  return map;
}

export function useFileTreeInteractionController({
  enabled,
  ensureExpanded,
  getDefaultPasteTargetDir,
  selectionResetKey,
  onTransferCommitted,
  onNativeClipboardPaste,
}: UseFileTreeInteractionControllerOptions) {
  const pushToast = useToastStore((state) => state.pushToast);
  const listDirectory = useAppStore((state) => state.listDirectory);
  const statPath = useAppStore((state) => state.statPath);
  const moveEntries = useAppStore((state) => state.moveEntries);
  const copyEntries = useAppStore((state) => state.copyEntries);

  const clipboardItems = useFileTreeDndStore((state) => state.clipboardItems);
  const clipboardMode = useFileTreeDndStore((state) => state.clipboardMode);
  const dragItems = useFileTreeDndStore((state) => state.dragItems);
  const setClipboard = useFileTreeDndStore((state) => state.setClipboard);
  const clearClipboard = useFileTreeDndStore((state) => state.clearClipboard);
  const setGlobalDragItems = useFileTreeDndStore((state) => state.setDragItems);
  const clearGlobalDragItems = useFileTreeDndStore((state) => state.clearDragItems);

  const scopeIdRef = useRef(getScopeId());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragGhostRef = useRef<HTMLElement | null>(null);
  const ensureExpandedRef = useRef(ensureExpanded);
  useEffect(() => { ensureExpandedRef.current = ensureExpanded; }, [ensureExpanded]);
  const autoExpandSchedulerRef = useRef(
    createTreeAutoExpandScheduler((dir) => ensureExpandedRef.current?.(dir)),
  );

  useEffect(() => {
    useFileTreeSelectionStore.getState().ensureScope(scopeIdRef.current);
    return () => {
      autoExpandSchedulerRef.current.cancel();
      useFileTreeSelectionStore.getState().destroyScope(scopeIdRef.current);
      removeDragGhost(dragGhostRef.current);
      dragGhostRef.current = null;
    };
  }, []);

  const selectionResetKeyRef = useRef(selectionResetKey ?? null);
  useEffect(() => {
    const nextKey = selectionResetKey ?? null;
    if (selectionResetKeyRef.current === nextKey) {
      return;
    }
    selectionResetKeyRef.current = nextKey;
    const store = useFileTreeSelectionStore.getState();
    store.clearSelection(scopeIdRef.current);
    store.setDropTargetPath(scopeIdRef.current, null);
  }, [selectionResetKey]);

  const selection = useFileTreeSelectionStore((state) => state.scopes[scopeIdRef.current]?.selection ?? EMPTY_SELECTION);

  const selectionArray = useMemo(() => Array.from(selection), [selection]);

  const focusTree = useCallback(() => {
    containerRef.current?.focus();
  }, []);

  const getVisiblePaths = useCallback(() => getVisibleFileTreePaths(containerRef.current), []);

  const resolveItemsFromPaths = useCallback(async (paths: string[]): Promise<FileTreeTransferItem[]> => {
    const byPath = readRowMeta(containerRef.current);
    const resolved: FileTreeTransferItem[] = [];
    for (const path of paths) {
      const local = byPath.get(path);
      if (local) {
        resolved.push(local);
        continue;
      }
      const stat = await statPath(path);
      if (!stat.error) {
        resolved.push({ path, isDir: stat.isDir === true });
      }
    }
    return dedupeTopLevelItems(resolved);
  }, [statPath]);

  const getActionItems = useCallback(async (fallback?: FileTreeTransferItem): Promise<FileTreeTransferItem[]> => {
    const selectedPaths = Array.from(useFileTreeSelectionStore.getState().scopes[scopeIdRef.current]?.selection ?? new Set<string>());
    const shouldUseSelection = fallback ? selectedPaths.includes(fallback.path) && selectedPaths.length > 0 : selectedPaths.length > 0;
    if (shouldUseSelection) {
      const items = await resolveItemsFromPaths(selectedPaths);
      if (items.length > 0) {
        return items;
      }
    }
    return fallback ? [fallback] : [];
  }, [resolveItemsFromPaths]);

  const getDragItems = useCallback((fallback: FileTreeTransferItem): FileTreeTransferItem[] => {
    const selectedPaths = Array.from(useFileTreeSelectionStore.getState().scopes[scopeIdRef.current]?.selection ?? new Set<string>());
    const byPath = readRowMeta(containerRef.current);
    const shouldUseSelection = selectedPaths.includes(fallback.path) && selectedPaths.length > 0;
    if (!shouldUseSelection) {
      return [fallback];
    }
    const items = selectedPaths
      .map((path) => byPath.get(path))
      .filter((item): item is FileTreeTransferItem => !!item);
    return dedupeTopLevelItems(items.length > 0 ? items : [fallback]);
  }, []);

  const resolveTransferItems = useCallback((dataTransfer: DataTransfer | null | undefined): FileTreeTransferItem[] => {
    const parsed = readFileTreeTransfer(dataTransfer);
    if (parsed.length > 0) {
      return parsed;
    }
    return dragItems;
  }, [dragItems]);

  const applyTransfer = useCallback(async (items: FileTreeTransferItem[], targetDir: string, isCopy: boolean) => {
    if (!enabled) {
      return false;
    }

    const validation = canMoveOrCopyIntoTarget(items, targetDir, isCopy);
    if (!validation.ok) {
      pushToast(validation.reason);
      return false;
    }

    const targetResult = await listDirectory(targetDir);
    if (targetResult.error) {
      pushToast(targetResult.error);
      return false;
    }

    const ops = prepareFileTreeTransferOps({
      items,
      targetDir,
      targetEntries: targetResult.entries || [],
      isCopy,
    });

    if (ops.length === 0) {
      pushToast(isCopy ? 'Nothing to copy' : 'Nothing to move');
      return false;
    }

    const affectedDirs = new Set<string>([targetDir]);
    const result = isCopy
      ? await copyEntries(ops.map((op) => ({ sourcePath: op.sourcePath, targetPath: op.targetPath })))
      : await moveEntries(ops.map((op) => ({ oldPath: op.sourcePath, newPath: op.targetPath })));

    if (!result.success) {
      pushToast(result.error || (isCopy ? 'Copy failed' : 'Move failed'));
      return false;
    }

    for (const op of ops) {
      const sourceDir = op.sourcePath.slice(0, op.sourcePath.lastIndexOf('/')) || '/';
      affectedDirs.add(sourceDir);
      affectedDirs.add(op.targetDir);
    }

    if (!isCopy && clipboardMode === 'cut') {
      clearClipboard();
    }

    // Success feedback. Always include the actual source name + target dir
    // so users can spot mismatches between intent and effect immediately.
    const verb = isCopy ? 'Copied' : 'Moved';
    const targetName = getBaseName(targetDir) || targetDir;
    if (ops.length === 1) {
      const firstName = getBaseName(ops[0].sourcePath);
      pushToast(`${verb} "${firstName}" into "${targetName}"`);
    } else {
      pushToast(`${verb} ${ops.length} items into "${targetName}"`);
    }

    useFileTreeSelectionStore.getState().replaceSelection(
      scopeIdRef.current,
      ops.map((op) => op.targetPath),
      ops[0]?.targetPath ?? null,
    );

    await onTransferCommitted?.(affectedDirs);
    return true;
  }, [clearClipboard, clipboardMode, copyEntries, enabled, listDirectory, moveEntries, onTransferCommitted, pushToast]);

  const handleEntryClick = useCallback(async (
    event: ReactMouseEvent,
    item: FileTreeTransferItem,
    onPrimaryAction: () => void | Promise<void>,
  ) => {
    focusTree();

    if ((event.metaKey || event.ctrlKey) && !event.shiftKey) {
      useFileTreeSelectionStore.getState().select(scopeIdRef.current, item.path, 'toggle');
      return;
    }

    if (event.shiftKey) {
      useFileTreeSelectionStore.getState().select(scopeIdRef.current, item.path, 'range', getVisiblePaths());
      return;
    }

    // Single click without modifiers selects exactly this row, so a subsequent
    // cmd+C/cmd+X always operates on what the user just clicked. Previous
    // behavior replaced selection with an empty set (only updating anchor),
    // which made keyboard copy silently no-op and reuse stale clipboard.
    useFileTreeSelectionStore.getState().replaceSelection(scopeIdRef.current, [item.path], item.path);
    await onPrimaryAction();
  }, [focusTree, getVisiblePaths]);

  const prepareContextSelection = useCallback((path: string) => {
    focusTree();
    useFileTreeSelectionStore.getState().ensureSelected(scopeIdRef.current, path);
  }, [focusTree]);

  const copySelected = useCallback(async (fallback?: FileTreeTransferItem) => {
    const items = await getActionItems(fallback);
    if (items.length === 0) {
      pushToast('Nothing selected to copy');
      return false;
    }
    setClipboard(items, 'copy');
    if (items.length === 1) {
      pushToast(`Copied "${getBaseName(items[0].path)}"`);
    } else {
      pushToast(`Copied ${items.length} items`);
    }
    return true;
  }, [getActionItems, pushToast, setClipboard]);

  const cutSelected = useCallback(async (fallback?: FileTreeTransferItem) => {
    const items = await getActionItems(fallback);
    if (items.length === 0) {
      pushToast('Nothing selected to cut');
      return false;
    }
    setClipboard(items, 'cut');
    if (items.length === 1) {
      pushToast(`Cut "${getBaseName(items[0].path)}"`);
    } else {
      pushToast(`Cut ${items.length} items`);
    }
    return true;
  }, [getActionItems, pushToast, setClipboard]);

  const pasteInto = useCallback(async (targetDir: string) => {
    if (!enabled || clipboardItems.length === 0 || !clipboardMode) {
      if (enabled && clipboardItems.length === 0) {
        pushToast('Clipboard is empty');
      }
      return false;
    }
    return applyTransfer(clipboardItems, targetDir, clipboardMode === 'copy');
  }, [applyTransfer, clipboardItems, clipboardMode, enabled, pushToast]);

  const resolveKeyboardPasteTargetDir = useCallback(async (): Promise<string | null> => {
    const defaultTargetDir = getDefaultPasteTargetDir?.() || null;
    const selectedPaths = Array.from(useFileTreeSelectionStore.getState().scopes[scopeIdRef.current]?.selection ?? new Set<string>());
    const firstSelected = selectedPaths[0];
    if (firstSelected) {
      const rowMeta = readRowMeta(containerRef.current).get(firstSelected);
      const clipboardPaths = new Set(useFileTreeDndStore.getState().clipboardItems.map((item) => item.path));

      if (!rowMeta && defaultTargetDir && !isEqualOrParent(defaultTargetDir, firstSelected)) {
        return defaultTargetDir;
      }

      if (rowMeta?.isDir && clipboardPaths.has(rowMeta.path)) {
        return getParentDir(rowMeta.path);
      }
      if (rowMeta?.isDir) {
        return rowMeta.path;
      }
      if (rowMeta) {
        return getParentDir(rowMeta.path);
      }
      const stat = await statPath(firstSelected);
      if (!stat.error && stat.isDir === true) {
        if (clipboardPaths.has(firstSelected)) {
          return getParentDir(firstSelected);
        }
        return firstSelected;
      }
      return getParentDir(firstSelected);
    }
    return defaultTargetDir;
  }, [getDefaultPasteTargetDir, statPath]);

  const handleDragStart = useCallback((
    event: ReactDragEvent,
    item: FileTreeTransferItem,
  ) => {
    if (!enabled) {
      event.preventDefault();
      return;
    }

    let items = getDragItems(item);
    if (!items.some((candidate) => candidate.path === item.path)) {
      items = [item];
      useFileTreeSelectionStore.getState().replaceSelection(scopeIdRef.current, [item.path], item.path);
    }

    const deduped = dedupeTopLevelItems(items);
    if (deduped.length === 0) {
      event.preventDefault();
      return;
    }

    useFileTreeSelectionStore.getState().setDragItems(scopeIdRef.current, deduped);
    setGlobalDragItems(deduped);
    event.dataTransfer.effectAllowed = 'copyMove';
    event.dataTransfer.setData(FILE_TREE_TRANSFER_MIME, encodeFileTreeTransfer(deduped));
    if (deduped.length === 1) {
      const first = deduped[0];
      const prefix = first.isDir ? 'hulala-dir:' : 'hulala-file:';
      event.dataTransfer.setData('text/plain', `${prefix}${first.path}`);
    } else {
      event.dataTransfer.setData('text/plain', FILE_TREE_TRANSFER_SENTINEL);
    }
    // Custom drag ghost
    removeDragGhost(dragGhostRef.current);
    const ghost = createDragGhost(deduped);
    dragGhostRef.current = ghost;
    event.dataTransfer.setDragImage(ghost, 0, 0);

    event.currentTarget.classList.add('file-tree-item-dragging');
  }, [enabled, getDragItems, setGlobalDragItems]);

  const handleDragEnd = useCallback((event: ReactDragEvent) => {
    autoExpandSchedulerRef.current.cancel();
    useFileTreeSelectionStore.getState().setDragItems(scopeIdRef.current, null);
    useFileTreeSelectionStore.getState().setDropTargetPath(scopeIdRef.current, null);
    clearGlobalDragItems();
    removeDragGhost(dragGhostRef.current);
    dragGhostRef.current = null;
    event.currentTarget.classList.remove('file-tree-item-dragging');
  }, [clearGlobalDragItems]);

  const handleRowDragOver = useCallback((
    event: ReactDragEvent,
    rowPath: string,
    targetDir: string,
    expandDir?: string | null,
  ) => {
    if (!enabled || !hasFileTreeTransfer(event.dataTransfer)) {
      return;
    }

    const items = resolveTransferItems(event.dataTransfer);
    const validation = canMoveOrCopyIntoTarget(items, targetDir, isCopyModifier(event));
    if (!validation.ok) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = isCopyModifier(event) ? 'copy' : 'move';
    useFileTreeSelectionStore.getState().setDropTargetPath(scopeIdRef.current, rowPath);
    autoExpandSchedulerRef.current.schedule(expandDir || null);
  }, [enabled, resolveTransferItems]);

  const handleRowDragLeave = useCallback((event: ReactDragEvent, rowPath: string) => {
    if (!enabled || !hasFileTreeTransfer(event.dataTransfer)) {
      return;
    }
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return;
    }
    const currentDropTarget = useFileTreeSelectionStore.getState().scopes[scopeIdRef.current]?.dropTargetPath ?? null;
    if (currentDropTarget === rowPath) {
      useFileTreeSelectionStore.getState().setDropTargetPath(scopeIdRef.current, null);
    }
    autoExpandSchedulerRef.current.cancel();
  }, [enabled]);

  const handleRowDrop = useCallback(async (event: ReactDragEvent, _rowPath: string, targetDir: string) => {
    if (!enabled || !hasFileTreeTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    autoExpandSchedulerRef.current.cancel();
    useFileTreeSelectionStore.getState().setDropTargetPath(scopeIdRef.current, null);
    const items = resolveTransferItems(event.dataTransfer);
    await applyTransfer(items, targetDir, isCopyModifier(event));
  }, [applyTransfer, enabled, resolveTransferItems]);

  const handleBlankDragOver = useCallback((event: ReactDragEvent, dir: string) => {
    if (!enabled || !hasFileTreeTransfer(event.dataTransfer)) {
      return;
    }

    const items = resolveTransferItems(event.dataTransfer);
    const validation = canMoveOrCopyIntoTarget(items, dir, isCopyModifier(event));
    if (!validation.ok) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = isCopyModifier(event) ? 'copy' : 'move';
    useFileTreeSelectionStore.getState().setDropTargetPath(scopeIdRef.current, dir);
    autoExpandSchedulerRef.current.cancel();
  }, [enabled, resolveTransferItems]);

  const handleBlankDragLeave = useCallback((event: ReactDragEvent, dir: string) => {
    if (!enabled || !hasFileTreeTransfer(event.dataTransfer)) {
      return;
    }
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return;
    }
    const currentDropTarget = useFileTreeSelectionStore.getState().scopes[scopeIdRef.current]?.dropTargetPath ?? null;
    if (currentDropTarget === dir) {
      useFileTreeSelectionStore.getState().setDropTargetPath(scopeIdRef.current, null);
    }
  }, [enabled]);

  const handleBlankDrop = useCallback(async (event: ReactDragEvent, dir: string) => {
    if (!enabled || !hasFileTreeTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    autoExpandSchedulerRef.current.cancel();
    useFileTreeSelectionStore.getState().setDropTargetPath(scopeIdRef.current, null);
    const items = resolveTransferItems(event.dataTransfer);
    await applyTransfer(items, dir, isCopyModifier(event));
  }, [applyTransfer, enabled, resolveTransferItems]);

  const handleKeyDown = useCallback(async (event: ReactKeyboardEvent) => {
    if (!enabled) {
      return;
    }

    const target = event.target as HTMLElement | null;
    const tagName = target?.tagName?.toUpperCase();
    const editable = tagName === 'INPUT' || tagName === 'TEXTAREA' || target?.isContentEditable;
    if (editable) {
      return;
    }

    const primary = window.hulala?.platform === 'darwin' ? event.metaKey : event.ctrlKey;
    if (!primary) {
      return;
    }

    const selectionPaths = selectionArray;
    const key = event.key.toLowerCase();
    if (selectionPaths.length === 0 && key !== 'v' && key !== 'a') {
      return;
    }


    if (key === 'c') {
      event.preventDefault();
      await copySelected();
      return;
    }
    if (key === 'x') {
      event.preventDefault();
      await cutSelected();
      return;
    }
    if (key === 'v') {
      if (clipboardItems.length > 0 && clipboardMode) {
        event.preventDefault();
        const targetDir = await resolveKeyboardPasteTargetDir();
        if (!targetDir) {
          pushToast('No paste target. Click a folder first.');
          return;
        }
        await pasteInto(targetDir);
        return;
      }
      // Electron often omits Finder files from ClipboardEvent.FileList; read OS
      // clipboard paths in keydown and import via the active-tab tree-import path.
      event.preventDefault();
      const targetDir = await resolveKeyboardPasteTargetDir();
      if (!targetDir) {
        pushToast('No paste target. Click a folder first.');
        return;
      }
      const nativePaths = await readNativeClipboardFilePaths();
      if (nativePaths.length > 0) {
        const imported = await onNativeClipboardPaste?.(nativePaths, targetDir);
        if (imported) {
          return;
        }
      }
      pushToast('Clipboard has no files to import');
      return;
    }
    if (key === 'a') {
      event.preventDefault();
      const visiblePaths = getVisiblePaths();
      useFileTreeSelectionStore.getState().replaceSelection(scopeIdRef.current, visiblePaths, visiblePaths[0] ?? null);
    }
  }, [clipboardItems.length, clipboardMode, copySelected, cutSelected, enabled, getVisiblePaths, onNativeClipboardPaste, pasteInto, pushToast, resolveKeyboardPasteTargetDir, selectionArray]);

  const handlePaste = useCallback(async (
    event: ReactClipboardEvent,
    beginImport: (dataTransfer: DataTransfer, targetDir: string) => Promise<void>,
  ) => {
    if (!enabled) {
      return;
    }

    const target = event.target as HTMLElement | null;
    const tagName = target?.tagName?.toUpperCase();
    const editable = tagName === 'INPUT' || tagName === 'TEXTAREA' || target?.isContentEditable;
    if (editable) {
      return;
    }

    if (clipboardItems.length > 0 && clipboardMode) {
      return;
    }

    // Cmd+V already handled native paths in keydown; keep paste as a fallback for
    // environments that expose FileList on ClipboardEvent.
    if (hasExternalTreeImportPayload(event.clipboardData)) {
      event.preventDefault();
      const targetDir = await resolveKeyboardPasteTargetDir();
      if (!targetDir) {
        pushToast('No paste target. Click a folder first.');
        return;
      }
      await beginImport(event.clipboardData, targetDir);
      return;
    }

    const nativePaths = await readNativeClipboardFilePaths();
    if (nativePaths.length > 0) {
      event.preventDefault();
      const targetDir = await resolveKeyboardPasteTargetDir();
      if (!targetDir) {
        pushToast('No paste target. Click a folder first.');
        return;
      }
      await onNativeClipboardPaste?.(nativePaths, targetDir);
    }
  }, [clipboardItems.length, clipboardMode, enabled, onNativeClipboardPaste, pushToast, resolveKeyboardPasteTargetDir]);

  return {
    scopeId: scopeIdRef.current,
    containerRef,
    selectionArray,
    clipboardItems,
    clipboardMode,
    focusTree,
    prepareContextSelection,
    handleEntryClick,
    handleDragStart,
    handleDragEnd,
    handleRowDragOver,
    handleRowDragLeave,
    handleRowDrop,
    handleBlankDragOver,
    handleBlankDragLeave,
    handleBlankDrop,
    handleKeyDown,
    handlePaste,
    getActionItems,
    copySelected,
    cutSelected,
    pasteInto,
    clearClipboard,
    isSelected: (path: string) => useFileTreeSelectionStore.getState().scopes[scopeIdRef.current]?.selection.has(path) ?? false,
    isCut: (path: string) => clipboardMode === 'cut' && clipboardItems.some((item) => item.path === path),
  };
}
