import { useMemo, useState } from 'react';
import { dedupeDeleteTargets, type FileTreeDeleteTarget } from './fileTreeDelete';
import type { ContextMenuState, FileTreeContext, InlineCreateState } from './types';

type DeleteOptions = {
  useTrash?: boolean;
  recursive?: boolean;
};

type RenameResult = { success: boolean; error?: string };
type CrudResult = { success: boolean; error?: string };

type UseFileTreeCrudControllerOptions = {
  connected: boolean;
  expandedDirs: Set<string>;
  toggleDir: (path: string) => void;
  createFile: (path: string) => Promise<CrudResult>;
  createFolder: (path: string) => Promise<CrudResult>;
  deleteEntry: (path: string, isDir: boolean, options?: DeleteOptions) => Promise<CrudResult>;
  renameEntry: (oldPath: string, newPath: string) => Promise<RenameResult>;
  openFile?: (path: string, options?: { focusEditor?: boolean }) => Promise<void>;
};

type RenameDialogState = {
  path: string;
  parentDir: string;
  value: string;
  busy: boolean;
  error?: string;
};

function getBaseName(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Name is required';
  if (trimmed === '.' || trimmed === '..') return 'Invalid name';
  if (trimmed.includes('/')) return 'Name cannot contain "/"';
  return null;
}

export function useFileTreeCrudController({
  connected,
  expandedDirs,
  toggleDir,
  createFile,
  createFolder,
  deleteEntry,
  renameEntry,
  openFile,
}: UseFileTreeCrudControllerOptions) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ open: false, x: 0, y: 0, ctx: null });
  const [inlineCreate, setInlineCreate] = useState<InlineCreateState | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<FileTreeDeleteTarget[] | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null);

  const activeCwd = useMemo(() => {
    const ctx = contextMenu.ctx;
    if (!ctx) return null;
    if (ctx.kind === 'blank') return ctx.dir;
    return ctx.isDir && !ctx.isPackage ? ctx.path : ctx.parentDir;
  }, [contextMenu.ctx]);

  const activeDeleteTarget = useMemo(() => {
    const ctx = contextMenu.ctx;
    if (!ctx || ctx.kind !== 'entry') return null;
    return { path: ctx.path, isDir: ctx.isDir };
  }, [contextMenu.ctx]);

  const activeRenameTarget = useMemo(() => {
    const ctx = contextMenu.ctx;
    if (!ctx || ctx.kind !== 'entry') return null;
    return { path: ctx.path, parentDir: ctx.parentDir };
  }, [contextMenu.ctx]);

  const contextMenuTargetPath =
    contextMenu.open && contextMenu.ctx?.kind === 'entry' ? contextMenu.ctx.path : null;

  const openContextMenuAt = (x: number, y: number, ctx: FileTreeContext) => {
    setContextMenu({ open: true, x, y, ctx });
  };

  const closeContextMenu = () => {
    setContextMenu((prev) => ({ ...prev, open: false }));
  };

  const resolveCreateTarget = (ctx: FileTreeContext | null) => {
    if (!ctx) {
      return null;
    }
    if (ctx.kind === 'blank') {
      return { dir: ctx.dir, depth: ctx.depthForCreate };
    }
    return { dir: ctx.isDir && !ctx.isPackage ? ctx.path : ctx.parentDir, depth: ctx.depthForCreate };
  };

  const startInlineCreate = (kind: InlineCreateState['kind']) => {
    const target = resolveCreateTarget(contextMenu.ctx);
    if (!connected || !target?.dir) {
      return;
    }

    const ctx = contextMenu.ctx;
    if (ctx?.kind === 'entry' && ctx.isDir && !ctx.isPackage && !expandedDirs.has(ctx.path)) {
      toggleDir(ctx.path);
    }

    closeContextMenu();
    setInlineCreate({ dir: target.dir, kind, depth: target.depth, value: '', error: undefined });
  };

  const startInlineCreateAtDir = (dir: string, kind: InlineCreateState['kind'], depth = 0) => {
    if (!connected || !dir) return;
    setInlineCreate({ dir, kind, depth, value: '', error: undefined });
  };

  const commitInlineCreate = async () => {
    if (!inlineCreate) {
      return;
    }

    const err = validateName(inlineCreate.value);
    if (err) {
      setInlineCreate({ ...inlineCreate, error: err });
      return;
    }

    const name = inlineCreate.value.trim();
    const fullPath = `${inlineCreate.dir}/${name}`;

    if (inlineCreate.kind === 'file') {
      const result = await createFile(fullPath);
      if (!result.success) {
        setInlineCreate({ ...inlineCreate, error: result.error || 'Failed to create file' });
        return;
      }
      setInlineCreate(null);
      if (openFile) {
        await openFile(fullPath, { focusEditor: true });
      }
      return;
    }

    const result = await createFolder(fullPath);
    if (!result.success) {
      setInlineCreate({ ...inlineCreate, error: result.error || 'Failed to create folder' });
      return;
    }
    setInlineCreate(null);
    if (!expandedDirs.has(fullPath)) {
      toggleDir(fullPath);
    }
  };

  const requestDeleteFromContext = () => {
    const target = activeDeleteTarget;
    closeContextMenu();
    if (!connected || !target) return;
    setDeleteError(null);
    setDeleteDialog([target]);
  };

  const requestDeleteTargets = (targets: FileTreeDeleteTarget[]) => {
    closeContextMenu();
    if (!connected) return;
    const nextTargets = dedupeDeleteTargets(targets);
    if (nextTargets.length === 0) return;
    setDeleteError(null);
    setDeleteDialog(nextTargets);
  };

  const confirmDelete = async (useTrash: boolean) => {
    const targets = deleteDialog;
    if (!targets || targets.length === 0 || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const result = await deleteEntry(target.path, target.isDir, { useTrash, recursive: true });
      if (!result.success) {
        setDeleteBusy(false);
        setDeleteDialog(targets.slice(index));
        const fallback = useTrash ? 'Failed to move to Trash' : 'Failed to delete permanently';
        setDeleteError(`${target.path}\n${result.error || fallback}`);
        return;
      }
    }
    setDeleteBusy(false);
    setDeleteDialog(null);
  };

  const openRenameDialog = () => {
    const target = activeRenameTarget;
    closeContextMenu();
    if (!connected || !target) return;
    setRenameDialog({
      path: target.path,
      parentDir: target.parentDir,
      value: getBaseName(target.path),
      busy: false,
      error: undefined,
    });
  };

  const submitRename = async () => {
    const target = renameDialog;
    if (!target || target.busy) return;

    const err = validateName(target.value);
    if (err) {
      setRenameDialog({ ...target, error: err });
      return;
    }

    const trimmed = target.value.trim();
    const nextPath = `${target.parentDir}/${trimmed}`;
    if (nextPath === target.path) {
      setRenameDialog(null);
      return;
    }

    setRenameDialog({ ...target, busy: true, error: undefined });
    const result = await renameEntry(target.path, nextPath);
    if (!result.success) {
      setRenameDialog({ ...target, busy: false, error: result.error || 'Failed to rename entry' });
      return;
    }
    setRenameDialog(null);
  };

  return {
    contextMenu,
    contextMenuTargetPath,
    inlineCreate,
    activeCwd,
    activeDeleteTarget,
    activeRenameTarget,
    deleteDialog,
    deleteBusy,
    deleteError,
    renameDialog,
    setDeleteDialog,
    setDeleteError,
    setInlineCreate,
    setRenameDialog,
    openContextMenuAt,
    closeContextMenu,
    startInlineCreate,
    startInlineCreateAtDir,
    commitInlineCreate,
    requestDeleteFromContext,
    requestDeleteTargets,
    confirmDelete,
    openRenameDialog,
    submitRename,
  };
}
