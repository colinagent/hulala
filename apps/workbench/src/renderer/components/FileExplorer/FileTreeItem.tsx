import React from 'react';

import type { FileEntry } from '../../services/fileService';
import { useAppStore } from '../../store/appStore';
import { FileTypeIcon } from '../FileTypeIcon';
import { ChevronRightIcon } from '../Icons';
import { FileTreeRow } from './FileTreeRow';
import { useFileTreeDndStore } from './fileTreeDndStore';
import { useFileTreeSelectionStore } from './fileTreeSelectionStore';
import type { FileTreeTransferItem } from './fileTreeTransfer';
import type { FileTreeContext } from './types';

const FILE_TREE_AGENT_PILL_CLASS = 'ui-pill-btn-secondary file-tree-agent-pill';

type FileTreeItemProps = {
  entry: FileEntry;
  parentDir: string;
  depth: number;
  onContextMenu: (x: number, y: number, ctx: FileTreeContext) => void;
  renderChildren: (dir: string, depth: number) => React.ReactNode;
  rightLabel?: string | null;
  onRightLabelClick?: () => void;
  agentLabelPlacement?: 'inline' | 'right';
  contextMenuTargetPath?: string | null;
  externalDropTarget?: boolean;
  onExternalDragOver?: (event: React.DragEvent, rowPath: string, targetDir: string, expandDir?: string | null) => void;
  onExternalDragLeave?: (event: React.DragEvent, rowPath: string) => void;
  onExternalDrop?: (event: React.DragEvent, targetDir: string) => void;
  scopeId?: string;
  onEntryClick?: (
    event: React.MouseEvent,
    item: FileTreeTransferItem,
    onPrimaryAction: () => void | Promise<void>,
  ) => void | Promise<void>;
  onPrepareContextSelection?: (path: string) => void;
  onInternalDragStart?: (event: React.DragEvent, item: FileTreeTransferItem) => void;
  onInternalDragEnd?: (event: React.DragEvent) => void;
  onInternalDragOver?: (event: React.DragEvent, rowPath: string, targetDir: string, expandDir?: string | null) => void;
  onInternalDragLeave?: (event: React.DragEvent, rowPath: string) => void;
  onInternalDrop?: (event: React.DragEvent, rowPath: string, targetDir: string) => void;
};

function isEpubPackagePath(path: string, isDir: boolean): boolean {
  return isDir && path.trim().toLowerCase().endsWith('.epub');
}

export function FileTreeItem({
  entry,
  parentDir,
  depth,
  onContextMenu,
  renderChildren,
  rightLabel,
  onRightLabelClick,
  agentLabelPlacement = 'right',
  contextMenuTargetPath,
  externalDropTarget = false,
  onExternalDragOver,
  onExternalDragLeave,
  onExternalDrop,
  scopeId,
  onEntryClick,
  onPrepareContextSelection,
  onInternalDragStart,
  onInternalDragEnd,
  onInternalDragOver,
  onInternalDragLeave,
  onInternalDrop,
}: FileTreeItemProps) {
  const currentFilePath = useAppStore((state) => state.currentFilePath);
  const expandedDirs = useAppStore((state) => state.expandedDirs);
  const toggleDir = useAppStore((state) => state.toggleDir);
  const openFile = useAppStore((state) => state.openFile);

  const fullPath = `${parentDir}/${entry.name}`;
  const transferItem = { path: fullPath, isDir: entry.isDir } satisfies FileTreeTransferItem;
  const isEpubPackage = isEpubPackagePath(fullPath, entry.isDir);

  const isExpanded = expandedDirs.has(fullPath);
  const isCurrentFile = currentFilePath === fullPath;
  const isMultiSelected = useFileTreeSelectionStore((state) => (
    scopeId ? state.scopes[scopeId]?.selection.has(fullPath) === true : false
  ));
  const isInternalDropTarget = useFileTreeSelectionStore((state) => (
    scopeId ? state.scopes[scopeId]?.dropTargetPath === fullPath : false
  ));
  const isCutItem = useFileTreeDndStore((state) => (
    state.clipboardMode === 'cut' && state.clipboardItems.some((item) => item.path === fullPath)
  ));
  const isContextMenuTarget = contextMenuTargetPath === fullPath;
  const isAgentMarker = entry.isDir && entry.name === '.agent';
  const isDotfile = entry.name.startsWith('.') && !isAgentMarker;

  const handlePrimaryClick = () => {
    if (entry.isDir && !isEpubPackage) {
      toggleDir(fullPath);
      return;
    }
    openFile(fullPath);
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onPrepareContextSelection?.(fullPath);
    const ctx: FileTreeContext = {
      kind: 'entry',
      path: fullPath,
      isDir: entry.isDir,
      isPackage: isEpubPackage,
      parentDir,
      depth,
      depthForCreate: entry.isDir ? depth + 1 : depth,
    };
    onContextMenu(event.clientX, event.clientY, ctx);
  };

  return (
    <div>
      <FileTreeRow
        depth={depth}
        selected={isCurrentFile}
        multiSelected={isMultiSelected}
        cutItem={isCutItem}
        isDotfile={isDotfile}
        contextMenuTarget={isContextMenuTarget}
        externalDropTarget={externalDropTarget}
        internalDropTarget={isInternalDropTarget}
        dataFilePath={fullPath}
        dataFileIsDir={entry.isDir && !isEpubPackage}
        draggable={true}
        onDragStart={(event) => onInternalDragStart?.(event, transferItem)}
        onDragEnd={(event) => onInternalDragEnd?.(event)}
        onDragOver={(event) => {
          const targetDir = entry.isDir && !isEpubPackage ? fullPath : parentDir;
          const expandDir = entry.isDir && !isEpubPackage ? fullPath : null;
          onInternalDragOver?.(event, fullPath, targetDir, expandDir);
          if (!event.defaultPrevented) {
            onExternalDragOver?.(event, fullPath, targetDir, expandDir);
          }
        }}
        onDragLeave={(event) => {
          onInternalDragLeave?.(event, fullPath);
          onExternalDragLeave?.(event, fullPath);
        }}
        onDrop={(event) => {
          const targetDir = entry.isDir && !isEpubPackage ? fullPath : parentDir;
          onInternalDrop?.(event, fullPath, targetDir);
          if (!event.defaultPrevented) {
            onExternalDrop?.(event, targetDir);
          }
        }}
        onClick={(event) => {
          if (onEntryClick) {
            void onEntryClick(event, transferItem, handlePrimaryClick);
            return;
          }
          void handlePrimaryClick();
        }}
        onDoubleClick={() => {
          if (!entry.isDir || isEpubPackage) {
            openFile(fullPath);
          }
        }}
        onContextMenu={handleContextMenu}
        leftContent={(
          <>
            {entry.isDir && !isEpubPackage ? (
              <span className={`mr-1 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                <ChevronRightIcon className="w-3 h-3" />
              </span>
            ) : (
              <FileTypeIcon filePath={fullPath} className="file-tree-icon" />
            )}
            <span className="truncate">{entry.name}</span>
            {rightLabel && agentLabelPlacement === 'inline' ? (
              onRightLabelClick ? (
                <button
                  type="button"
                  className={`${FILE_TREE_AGENT_PILL_CLASS} file-tree-agent-inline-pill ml-1.5`}
                  data-onboarding-target="workspace-dir-agent-pill"
                  title={rightLabel}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onRightLabelClick();
                  }}
                >
                  {rightLabel}
                </button>
              ) : (
                <span
                  className={`${FILE_TREE_AGENT_PILL_CLASS} file-tree-agent-inline-pill ml-1.5`}
                  title={rightLabel}
                >
                  {rightLabel}
                </span>
              )
            ) : null}
          </>
        )}
        rightContent={rightLabel && agentLabelPlacement === 'right' ? (
          <>
            {rightLabel ? (
              onRightLabelClick ? (
                <button
                  type="button"
                  className={FILE_TREE_AGENT_PILL_CLASS}
                  data-onboarding-target="workspace-dir-agent-pill"
                  title={rightLabel}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onRightLabelClick();
                  }}
                >
                  {rightLabel}
                </button>
              ) : (
                <span className={FILE_TREE_AGENT_PILL_CLASS} title={rightLabel}>
                  {rightLabel}
                </span>
              )
            ) : null}
          </>
        ) : null}
      />

      {entry.isDir && !isEpubPackage && isExpanded ? renderChildren(fullPath, depth + 1) : null}
    </div>
  );
}
