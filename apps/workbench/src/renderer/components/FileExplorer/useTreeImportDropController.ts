import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useToastStore } from '../../store/toastStore';
import type { PreparedTreeImport } from '../../services/treeImportService';
import {
  hasExternalTreeImportPayload,
  prepareTreeImport,
  prepareTreeImportFromLocalPaths,
  prepareTreeImportFromFiles,
} from '../../services/treeImportService';
import {
  createTreeAutoExpandScheduler,
  type ExternalTreeDropTarget,
} from './treeImportDrop';

type UseTreeImportDropControllerOptions = {
  enabled: boolean;
  onImportCommitted?: (targetDir: string) => Promise<void> | void;
  ensureExpanded?: (dir: string) => void;
};

type PendingConflictState = {
  prepared: PreparedTreeImport;
  busy: boolean;
};

export function useTreeImportDropController({
  enabled,
  onImportCommitted,
  ensureExpanded,
}: UseTreeImportDropControllerOptions) {
  const pushToast = useToastStore((state) => state.pushToast);
  const [dropTarget, setDropTarget] = useState<ExternalTreeDropTarget | null>(null);
  const [pendingConflict, setPendingConflict] = useState<PendingConflictState | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [progress, setProgress] = useState<{ name: string; loaded: number; total: number } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const ensureExpandedRef = useRef(ensureExpanded);
  useEffect(() => {
    ensureExpandedRef.current = ensureExpanded;
  }, [ensureExpanded]);

  const autoExpandSchedulerRef = useRef(
    createTreeAutoExpandScheduler((dir) => {
      ensureExpandedRef.current?.(dir);
    }),
  );

  const clearDropTarget = useCallback(() => {
    autoExpandSchedulerRef.current.cancel();
    setDropTarget(null);
  }, []);

  useEffect(() => clearDropTarget, [clearDropTarget]);

  const finalizeImport = useCallback(async (prepared: PreparedTreeImport, overwrite: boolean | 'skip') => {
    setImportBusy(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await prepared.commit(overwrite, { signal: controller.signal, onProgress: (name, loaded, total) => setProgress({ name, loaded, total }) });
      await onImportCommitted?.(prepared.targetDir);
      const importedCount = result.importedFiles + result.importedDirs;
      pushToast(importedCount > 0 ? `Imported ${importedCount} item${importedCount === 1 ? '' : 's'}` : 'Import completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Import failed';
      pushToast(message + ' Files already imported remain in the Workspace. Retry to review remaining conflicts.');
    } finally {
      abort.current = null;
      setProgress(null);
      await onImportCommitted?.(prepared.targetDir);
      setImportBusy(false);
    }
  }, [onImportCommitted, pushToast]);

  const runPreparedImport = useCallback(async (
    prepare: () => Promise<PreparedTreeImport>,
  ) => {
    if (!enabled) {
      return false;
    }
    if (importBusy) {
      pushToast('An import is already in progress');
      return false;
    }
    setImportBusy(true);
    try {
      const prepared = await prepare();
      if (prepared.conflicts.length > 0) {
        setPendingConflict({ prepared, busy: false });
        return true;
      }
      setImportBusy(false);
      await finalizeImport(prepared, false);
      return true;
    } catch (error) {
      setImportBusy(false);
      const message = error instanceof Error ? error.message : 'Import failed';
      pushToast(message);
      return false;
    }
  }, [enabled, finalizeImport, importBusy, pushToast]);

  const beginImport = useCallback(async (dataTransfer: DataTransfer, targetDir: string) => {
    await runPreparedImport(() => prepareTreeImport(targetDir, dataTransfer));
  }, [runPreparedImport]);

  const beginImportFromLocalPaths = useCallback(async (absolutePaths: string[], targetDir: string) => {
    if (absolutePaths.length === 0) {
      return false;
    }
    return runPreparedImport(() => prepareTreeImportFromLocalPaths(targetDir, absolutePaths));
  }, [runPreparedImport]);

  const beginImportFromFiles = useCallback((files: File[], targetDir: string) => runPreparedImport(() => prepareTreeImportFromFiles(targetDir, files)), [runPreparedImport]);

  const handleRowDragOver = useCallback((
    event: DragEvent,
    rowPath: string,
    targetDir: string,
    expandDir?: string | null,
  ) => {
    if (!enabled || !hasExternalTreeImportPayload(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setDropTarget((prev) => (
      prev?.kind === 'row' && prev.rowPath === rowPath && prev.targetDir === targetDir
        ? prev
        : { kind: 'row', rowPath, targetDir }
    ));
    autoExpandSchedulerRef.current.schedule(expandDir || null);
  }, [enabled]);

  const handleRowDragLeave = useCallback((event: DragEvent, rowPath: string) => {
    if (!enabled || !hasExternalTreeImportPayload(event.dataTransfer)) {
      return;
    }
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return;
    }
    setDropTarget((prev) => (
      prev?.kind === 'row' && prev.rowPath === rowPath ? null : prev
    ));
    autoExpandSchedulerRef.current.cancel();
  }, [enabled]);

  const handleRowDrop = useCallback((event: DragEvent, targetDir: string) => {
    if (!enabled || !hasExternalTreeImportPayload(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    clearDropTarget();
    void beginImport(event.dataTransfer, targetDir);
  }, [beginImport, clearDropTarget, enabled]);

  const handleBlankDragOver = useCallback((event: DragEvent, dir: string) => {
    if (!enabled || !hasExternalTreeImportPayload(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setDropTarget((prev) => (
      prev?.kind === 'blank' && prev.dir === dir ? prev : { kind: 'blank', dir }
    ));
    autoExpandSchedulerRef.current.cancel();
  }, [enabled]);

  const handleBlankDragLeave = useCallback((event: DragEvent, dir: string) => {
    if (!enabled || !hasExternalTreeImportPayload(event.dataTransfer)) {
      return;
    }
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return;
    }
    setDropTarget((prev) => (
      prev?.kind === 'blank' && prev.dir === dir ? null : prev
    ));
  }, [enabled]);

  const handleBlankDrop = useCallback((event: DragEvent, dir: string) => {
    if (!enabled || !hasExternalTreeImportPayload(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    clearDropTarget();
    void beginImport(event.dataTransfer, dir);
  }, [beginImport, clearDropTarget, enabled]);

  const cancelPendingConflict = useCallback(async () => {
    if (!pendingConflict) {
      return;
    }
    const { prepared } = pendingConflict;
    setPendingConflict(null);
    setImportBusy(false);
    await prepared.cancel().catch(() => undefined);
  }, [pendingConflict]);

  const confirmPendingConflict = useCallback(async (overwrite: boolean | 'skip' = true) => {
    if (!pendingConflict || pendingConflict.busy) {
      return;
    }
    const prepared = pendingConflict.prepared;
    setPendingConflict({ prepared, busy: true });
    setImportBusy(false);
    try {
      await finalizeImport(prepared, overwrite);
    } finally {
      setPendingConflict(null);
    }
  }, [finalizeImport, pendingConflict]);

  return {
    importBusy,
    progress,
    cancelImport: () => abort.current?.abort(),
    pendingConflict,
    beginImport,
    beginImportFromLocalPaths,
    beginImportFromFiles,
    isRowDropTarget: (rowPath: string) => dropTarget?.kind === 'row' && dropTarget.rowPath === rowPath,
    isBlankDropTarget: (dir: string) => dropTarget?.kind === 'blank' && dropTarget.dir === dir,
    handleRowDragOver,
    handleRowDragLeave,
    handleRowDrop,
    handleBlankDragOver,
    handleBlankDragLeave,
    handleBlankDrop,
    cancelPendingConflict,
    confirmPendingConflict,
  };
}
