import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { writeClipboardText } from '../../services/clipboardService';
import {
  getConnectionStateText,
  getDisplayConnectionState,
  useAppStore,
} from '../../store/appStore';
import { useTabManagerStore } from '../../store/tabManagerStore';
import { useToastStore } from '../../store/toastStore';
import { FileTreeChildren } from './FileTreeChildren';
import { DeleteConfirmDialog } from './DeleteConfirmDialog';
import { FileTreeContextMenu } from './FileTreeContextMenu';
import { RenameEntryDialog } from './RenameEntryDialog';
import { TreeImportConflictDialog } from './TreeImportConflictDialog';
import { formatDeleteConfirmMessage } from './fileTreeDelete';
import { buildFileTreeEntryMenu } from './fileTreeMenuActions';
import { useFileTreeInteractionController } from './useFileTreeInteractionController';
import { useTreeImportDropController } from './useTreeImportDropController';
import { downloadWorkspaceFile } from '../../services/fileDownload';
import { useFileTreeCrudController } from './useFileTreeCrudController';

type FileExplorerProps = {
  showHeader?: boolean;
  startDepth?: number;
};

export const FileExplorer: React.FC<FileExplorerProps> = ({ showHeader = true, startDepth = 0 }) => {
  const activeWorkspaceTabId = useTabManagerStore((state) => state.activeTabId);
  const currentDir = useAppStore((state) => state.currentDir);
  const connectionState = useAppStore((state) => state.connectionState);
  const displayConnectionState = useAppStore(getDisplayConnectionState);
  const remoteSession = useAppStore((state) => state.remoteSession);
  const hasCurrentDirSnapshot = useAppStore((state) => (state.currentDir ? state.dirEntries.has(state.currentDir) : false));
  const currentDirLoading = useAppStore((state) => (state.currentDir ? state.dirLoading.has(state.currentDir) : false));
  const setCurrentDir = useAppStore((state) => state.setCurrentDir);
  const currentFilePath = useAppStore((state) => state.currentFilePath);
  const refreshVisibleWorkspaceTree = useAppStore((state) => state.refreshVisibleWorkspaceTree);
  const revealInSidebar = useAppStore((state) => state.revealInSidebar);
  const loadDirectory = useAppStore((state) => state.loadDirectory);

  const expandedDirs = useAppStore((state) => state.expandedDirs);
  const toggleDir = useAppStore((state) => state.toggleDir);

  const createFile = useAppStore((state) => state.createFile);
  const createFolder = useAppStore((state) => state.createFolder);
  const deleteEntry = useAppStore((state) => state.deleteEntry);
  const renameEntry = useAppStore((state) => state.renameEntry);
  const openFile = useAppStore((state) => state.openFile);
  const requestRootAction = useAppStore((state) => state.requestRootAction);
  const setRequestRootAction = useAppStore((state) => state.setRequestRootAction);

  const pushToast = useToastStore((state) => state.pushToast);

  const connected = connectionState === 'connected';
  const displayConnected = displayConnectionState === 'connected';
  const showTreeShell = Boolean(
    currentDir
      && (
        displayConnectionState === 'connecting'
        || connected
        || hasCurrentDirSnapshot
        || currentDirLoading
      ),
  );
  const connectionHint = !displayConnected && currentDir && showTreeShell
    ? getConnectionStateText(displayConnectionState)
    : null;
  const [newDirInput, setNewDirInput] = useState('');
  const [showDirInput, setShowDirInput] = useState(false);


  const crud = useFileTreeCrudController({
    connected,
    expandedDirs,
    toggleDir,
    createFile,
    createFolder,
    deleteEntry,
    renameEntry,
    openFile,
  });

  const treeImport = useTreeImportDropController({
    enabled: connected && !!currentDir,
    ensureExpanded: (dir) => {
      if (!expandedDirs.has(dir)) {
        toggleDir(dir);
      }
    },
    onImportCommitted: async (targetDir) => {
      await loadDirectory(targetDir);
      await refreshVisibleWorkspaceTree();
    },
  });

  const interaction = useFileTreeInteractionController({
    enabled: connected && !!currentDir,
    ensureExpanded: (dir) => {
      if (!expandedDirs.has(dir)) {
        toggleDir(dir);
      }
    },
    getDefaultPasteTargetDir: () => currentDir || null,
    selectionResetKey: `${activeWorkspaceTabId}:${currentDir || ''}`,
    onTransferCommitted: async () => {},
    onNativeClipboardPaste: (absolutePaths, targetDir) => (
      treeImport.beginImportFromLocalPaths(absolutePaths, targetDir)
    ),
  });

  const handleDirChange = (e: React.FormEvent) => {
    e.preventDefault();
    if (newDirInput.trim()) {
      setCurrentDir(newDirInput.trim());
      setShowDirInput(false);
    }
  };

  const openRootContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    interaction.focusTree();
    if (!currentDir) {
      return;
    }
    crud.openContextMenuAt(event.clientX, event.clientY, {
      kind: 'blank',
      dir: currentDir,
      depthForCreate: startDepth,
    });
  };

  useEffect(() => {
    if (!currentDir || !currentFilePath) {
      return;
    }
    const normalizedCurrentDir = currentDir !== '/' ? currentDir.replace(/\/+$/, '') : currentDir;
    const pathPrefix = normalizedCurrentDir === '/' ? '/' : `${normalizedCurrentDir}/`;
    if (currentFilePath !== normalizedCurrentDir && !currentFilePath.startsWith(pathPrefix)) {
      return;
    }
    void revealInSidebar(currentFilePath);
  }, [currentDir, currentFilePath, revealInSidebar]);

  useEffect(() => {
    if (!requestRootAction || !currentDir || !connected) return;
    if (requestRootAction === 'new-file' || requestRootAction === 'new-folder') {
      crud.startInlineCreateAtDir(
        currentDir,
        requestRootAction === 'new-file' ? 'file' : 'folder',
        startDepth,
      );
    }
    setRequestRootAction(null);
  }, [requestRootAction, currentDir, connected, crud, setRequestRootAction, startDepth]);

  const context = crud.contextMenu.ctx;
  const contextKind = context?.kind;
  const entryContext = contextKind === 'entry' ? context : null;
  const contextEntryPath = entryContext?.path ?? null;
  const contextSelectionCount = interaction.selectionArray.length;
  const contextDirTarget = contextKind === 'blank'
    ? (context?.dir ?? null)
    : entryContext
      ? (entryContext.isDir && !entryContext.isPackage ? entryContext.path : entryContext.parentDir)
      : null;
  const isMac = window.hulala?.platform === 'darwin';
  const canRevealInFinder = Boolean(isMac && !remoteSession && contextEntryPath);
  const canPaste = connected && !!contextDirTarget && interaction.clipboardItems.length > 0;

  const baseCreateActions = useMemo(() => {
    const canUseCwd = connected && !!crud.activeCwd;
    return [
      {
        label: 'New File...',
        disabled: !canUseCwd,
        onClick: () => crud.startInlineCreate('file'),
      },
      {
        label: 'New Folder...',
        disabled: !canUseCwd,
        onClick: () => crud.startInlineCreate('folder'),
      },
      {
        label: 'Paste',
        disabled: !canPaste,
        onClick: async () => {
          crud.closeContextMenu();
          if (contextDirTarget) {
            await interaction.pasteInto(contextDirTarget);
          }
        },
      },
    ];
  }, [canPaste, connected, contextDirTarget, crud, interaction]);

  const blankActions = baseCreateActions;

  const entryActions = useMemo(() => {
    const canRename = connected && !!crud.activeRenameTarget && contextSelectionCount <= 1;
    const canDelete = connected && !!crud.activeDeleteTarget;
    if (contextKind !== 'entry' || !contextEntryPath) {
      return [];
    }

    const { actions: descriptors } = buildFileTreeEntryMenu({
      isDir: Boolean(entryContext?.isDir && !entryContext?.isPackage),
      canOpenInSidebar: connected,
      canRename,
      canDelete,
      canCut: connected,
      canCopy: true,
      canPaste,
      canCopyPath: true,
      canRevealInFinder,
    });

    return descriptors.map((descriptor) => {
      switch (descriptor.key) {
        case 'open-in-sidebar':
          return {
            label: descriptor.label,
            disabled: descriptor.disabled,
            onClick: async () => {
              crud.closeContextMenu();
              await openFile(contextEntryPath, {
                pane: 'right',
                focusEditor: true,
              });
            },
          };
        case 'new-file':
          return {
            label: descriptor.label,
            disabled: descriptor.disabled,
            onClick: () => crud.startInlineCreate('file'),
          };
        case 'new-folder':
          return {
            label: descriptor.label,
            disabled: descriptor.disabled,
            onClick: () => crud.startInlineCreate('folder'),
          };
        case 'cut':
          return {
            label: descriptor.label,
            disabled: descriptor.disabled,
            onClick: async () => {
              crud.closeContextMenu();
              await interaction.cutSelected({ path: contextEntryPath, isDir: entryContext?.isDir ?? false });
            },
          };
        case 'copy':
          return {
            label: descriptor.label,
            disabled: descriptor.disabled,
            onClick: async () => {
              crud.closeContextMenu();
              await interaction.copySelected({ path: contextEntryPath, isDir: entryContext?.isDir ?? false });
            },
          };
        case 'paste':
          return {
            label: descriptor.label,
            disabled: descriptor.disabled,
            onClick: async () => {
              crud.closeContextMenu();
              if (contextDirTarget) {
                await interaction.pasteInto(contextDirTarget);
              }
            },
          };
        case 'rename':
          return {
            label: descriptor.label,
            disabled: descriptor.disabled,
            onClick: crud.openRenameDialog,
          };
        case 'delete':
          return {
            label: descriptor.label,
            disabled: descriptor.disabled,
            onClick: async () => {
              const targets = await interaction.getActionItems({
                path: contextEntryPath,
                isDir: entryContext?.isDir ?? false,
              });
              crud.requestDeleteTargets(targets);
            },
          };
        case 'copy-path':
          return {
            label: descriptor.label,
            disabled: descriptor.disabled,
            onClick: async () => {
              crud.closeContextMenu();
              try {
                await writeClipboardText(contextEntryPath);
                pushToast('Path copied');
              } catch {
                pushToast('Failed to copy path');
              }
            },
          };
        case 'reveal-in-finder':
          return {
            label: descriptor.label,
            disabled: descriptor.disabled,
            onClick: async () => {
              crud.closeContextMenu();
              const result = await window.hulala?.revealInFileManager?.(contextEntryPath);
              if (!result?.success) {
                pushToast(result?.error || 'Failed to reveal item in Finder');
              }
            },
          };
      }
    });
  }, [
    canPaste,
    canRevealInFinder,
    connected,
    contextDirTarget,
    contextEntryPath,
    contextKind,
    contextSelectionCount,
    crud,
    entryContext?.isDir,
    entryContext?.isPackage,
    interaction,
    openFile,
    pushToast,
  ]);

  const menuActions = contextKind === 'blank' ? blankActions : [
    ...entryActions,
    ...(!entryContext?.isDir && contextEntryPath ? [{ label: 'Download', disabled: !connected, onClick: () => { crud.closeContextMenu(); void downloadWorkspaceFile(contextEntryPath).catch(error => pushToast(String(error))); } }] : []),
  ];
  const splitIndex = useMemo(() => {
    if (contextKind !== 'entry' || !contextEntryPath) {
      return undefined;
    }
    return buildFileTreeEntryMenu({
      isDir: Boolean(entryContext?.isDir && !entryContext?.isPackage),
      canOpenInSidebar: connected,
      canRename: connected && !!crud.activeRenameTarget && contextSelectionCount <= 1,
      canDelete: connected && !!crud.activeDeleteTarget,
      canCut: connected,
      canCopy: true,
      canPaste,
      canCopyPath: true,
      canRevealInFinder,
    }).splitIndex;
  }, [
    canPaste,
    canRevealInFinder,
    connected,
    contextEntryPath,
    contextKind,
    contextSelectionCount,
    crud.activeDeleteTarget,
    crud.activeRenameTarget,
    entryContext?.isDir,
    entryContext?.isPackage,
  ]);

  return (
    <div className="flex flex-col h-full">
      {window.hulala?.kind === 'browser' && treeImport.importBusy ? <div className="px-3 py-1 text-xs text-secondary-text">
        <span role="status">{treeImport.progress ? `${treeImport.progress.name}: ${Math.round(100 * treeImport.progress.loaded / Math.max(1, treeImport.progress.total))}%` : 'Preparing import…'} <button type="button" className="underline" onClick={treeImport.cancelImport}>Cancel import</button></span>
      </div> : null}
      {showHeader ? (
        <div className="px-3 h-8 font-semibold uppercase tracking-wider text-secondary-text border-b border-border flex items-center justify-start">
          <button
            className="text-secondary-text no-drag"
            onClick={() => setShowDirInput(!showDirInput)}
            title="Change directory"
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2A1.75 1.75 0 0 0 5 1H1.75Zm5.75 6h5v1.5h-5V7Z" />
            </svg>
          </button>
          <button
            className="ml-2 text-secondary-text no-drag disabled:opacity-50 disabled:cursor-not-allowed hover:text-link-text-hover"
            title="Refresh Explorer"
            disabled={!connected || !currentDir}
            onClick={() => {
              if (!connected || !currentDir) {
                return;
              }
              void refreshVisibleWorkspaceTree();
            }}
          >
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 2.25a5.75 5.75 0 0 1 5.429 3.862.75.75 0 0 1-1.417.49A4.25 4.25 0 1 0 8 12.25h.816l-1.286-1.286a.75.75 0 1 1 1.06-1.06l2.566 2.566a.75.75 0 0 1 0 1.06L8.59 16.096a.75.75 0 0 1-1.06-1.06l1.286-1.286H8a5.75 5.75 0 1 1 0-11.5Z" />
            </svg>
          </button>
        </div>
      ) : null}

      {showHeader && showDirInput ? (
        <form onSubmit={handleDirChange} className="p-2 border-b border-border">
          <input
            type="text"
            value={newDirInput}
            onChange={(e) => setNewDirInput(e.target.value)}
            placeholder="Enter directory path..."
            className="w-full px-2 py-1 bg-editor-bg border border-border rounded focus:outline-none focus:border-accent"
            autoFocus
          />
        </form>
      ) : null}

      {connectionHint ? (
        <div className="px-3 py-1 text-xs text-secondary-text border-b border-border">
          {connectionHint}
        </div>
      ) : null}

      <div
        ref={interaction.containerRef}
        tabIndex={0}
        data-file-tree-scope={interaction.scopeId}
        className={`flex-1 overflow-auto pb-1 outline-none ${currentDir && treeImport.isBlankDropTarget(currentDir) ? 'file-tree-blank-drop-target' : ''}`}
        onKeyDown={(event) => void interaction.handleKeyDown(event)}
        onPaste={(event) => void interaction.handlePaste(event, treeImport.beginImport)}
        onContextMenu={openRootContextMenu}
        onDragOver={(event) => {
          if (currentDir) {
            interaction.handleBlankDragOver(event, currentDir);
            if (!event.defaultPrevented) {
              treeImport.handleBlankDragOver(event, currentDir);
            }
          }
        }}
        onDragLeave={(event) => {
          if (currentDir) {
            interaction.handleBlankDragLeave(event, currentDir);
            treeImport.handleBlankDragLeave(event, currentDir);
          }
        }}
        onDrop={(event) => {
          if (currentDir) {
            void interaction.handleBlankDrop(event, currentDir);
            if (!event.defaultPrevented) {
              treeImport.handleBlankDrop(event, currentDir);
            }
          }
        }}
      >
        {!currentDir ? (
          <div className="px-3 py-4 text-center text-secondary-text">
            <p>No folder open</p>
            <p className="mt-1">Click the folder icon above</p>
          </div>
        ) : showTreeShell ? (
          <FileTreeChildren
            dir={currentDir}
            depth={startDepth}
            inlineCreate={crud.inlineCreate}
            contextMenuTargetPath={crud.contextMenuTargetPath}
            onInlineCreateChange={(value) => {
              crud.setInlineCreate((prev) => (prev ? { ...prev, value, error: undefined } : prev));
            }}
            onInlineCreateCommit={crud.commitInlineCreate}
            onInlineCreateCancel={() => crud.setInlineCreate(null)}
            onContextMenu={crud.openContextMenuAt}
            isExternalRowDropTarget={treeImport.isRowDropTarget}
            isExternalBlankDropTarget={treeImport.isBlankDropTarget}
            onExternalEntryDragOver={treeImport.handleRowDragOver}
            onExternalEntryDragLeave={treeImport.handleRowDragLeave}
            onExternalEntryDrop={treeImport.handleRowDrop}
            onExternalBlankDragOver={treeImport.handleBlankDragOver}
            onExternalBlankDragLeave={treeImport.handleBlankDragLeave}
            onExternalBlankDrop={treeImport.handleBlankDrop}
            scopeId={interaction.scopeId}
            onEntryClick={interaction.handleEntryClick}
            onPrepareContextSelection={interaction.prepareContextSelection}
            onInternalDragStart={interaction.handleDragStart}
            onInternalDragEnd={interaction.handleDragEnd}
            onInternalEntryDragOver={interaction.handleRowDragOver}
            onInternalEntryDragLeave={interaction.handleRowDragLeave}
            onInternalEntryDrop={interaction.handleRowDrop}
            onInternalBlankDragOver={interaction.handleBlankDragOver}
            onInternalBlankDragLeave={interaction.handleBlankDragLeave}
            onInternalBlankDrop={interaction.handleBlankDrop}
          />
        ) : (
          <div className="px-3 py-4 text-center text-secondary-text">
            <p>{getConnectionStateText(displayConnectionState)}</p>
            <p className="mt-1">Waiting to restore the file tree</p>
          </div>
        )}
      </div>

      <FileTreeContextMenu
        open={crud.contextMenu.open}
        x={crud.contextMenu.x}
        y={crud.contextMenu.y}
        actions={menuActions}
        splitIndex={splitIndex}
        onDismiss={crud.closeContextMenu}
      />

      <DeleteConfirmDialog
        open={!!crud.deleteDialog}
        title="Delete"
        message={
          crud.deleteDialog ? formatDeleteConfirmMessage(crud.deleteDialog) : ''
        }
        error={crud.deleteError}
        primaryLabel="Move to Trash"
        secondaryLabel="Delete Permanently"
        busy={crud.deleteBusy}
        onCancel={() => {
          if (crud.deleteBusy) return;
          crud.setDeleteDialog(null);
          crud.setDeleteError(null);
        }}
        onPrimary={() => void crud.confirmDelete(true)}
        onSecondary={() => void crud.confirmDelete(false)}
      />

      <RenameEntryDialog
        open={!!crud.renameDialog}
        path={crud.renameDialog?.path || null}
        value={crud.renameDialog?.value || ''}
        error={crud.renameDialog?.error || null}
        busy={crud.renameDialog?.busy}
        onChange={(value) =>
          crud.setRenameDialog((prev) => (prev ? { ...prev, value, error: undefined } : prev))
        }
        onCancel={() => {
          if (crud.renameDialog?.busy) return;
          crud.setRenameDialog(null);
        }}
        onSubmit={() => void crud.submitRename()}
      />

      <TreeImportConflictDialog
        open={!!treeImport.pendingConflict}
        targetDir={treeImport.pendingConflict?.prepared.targetDir || null}
        conflicts={treeImport.pendingConflict?.prepared.conflicts || []}
        busy={treeImport.pendingConflict?.busy}
        onCancel={() => void treeImport.cancelPendingConflict()}
        onConfirm={() => void treeImport.confirmPendingConflict()}
        onSkip={() => void treeImport.confirmPendingConflict('skip')}
      />
    </div>
  );
};
