import React, { useEffect, useMemo } from 'react';

import type { FileEntry } from '../../services/fileService';
import { useAppStore } from '../../store/appStore';
import { useFileExcludeStore } from '../../store/fileExcludeStore';
import { filterFileEntries } from '../../../shared/fileExcludes';
import { InlineCreateRow } from './InlineCreateRow';
import { FileTreeItem } from './FileTreeItem';
import type { FileTreeTransferItem } from './fileTreeTransfer';
import type { FileTreeContext, InlineCreateState } from './types';

const EMPTY_ENTRIES: FileEntry[] = [];

type FileTreeChildrenProps = {
  dir: string;
  depth: number;
  inlineCreate: InlineCreateState | null;
  onInlineCreateChange: (value: string) => void;
  onInlineCreateCommit: () => void;
  onInlineCreateCancel: () => void;
  onContextMenu: (x: number, y: number, ctx: FileTreeContext) => void;
  contextMenuTargetPath?: string | null;
  showAgentLabels?: boolean;
  isExternalRowDropTarget?: (rowPath: string) => boolean;
  isExternalBlankDropTarget?: (dir: string) => boolean;
  onExternalEntryDragOver?: (event: React.DragEvent, rowPath: string, targetDir: string, expandDir?: string | null) => void;
  onExternalEntryDragLeave?: (event: React.DragEvent, rowPath: string) => void;
  onExternalEntryDrop?: (event: React.DragEvent, targetDir: string) => void;
  onExternalBlankDragOver?: (event: React.DragEvent, dir: string) => void;
  onExternalBlankDragLeave?: (event: React.DragEvent, dir: string) => void;
  onExternalBlankDrop?: (event: React.DragEvent, dir: string) => void;
  scopeId?: string;
  onEntryClick?: (
    event: React.MouseEvent,
    item: FileTreeTransferItem,
    onPrimaryAction: () => void | Promise<void>,
  ) => void | Promise<void>;
  onPrepareContextSelection?: (path: string) => void;
  onInternalDragStart?: (event: React.DragEvent, item: FileTreeTransferItem) => void;
  onInternalDragEnd?: (event: React.DragEvent) => void;
  onInternalEntryDragOver?: (event: React.DragEvent, rowPath: string, targetDir: string, expandDir?: string | null) => void;
  onInternalEntryDragLeave?: (event: React.DragEvent, rowPath: string) => void;
  onInternalEntryDrop?: (event: React.DragEvent, rowPath: string, targetDir: string) => void;
  onInternalBlankDragOver?: (event: React.DragEvent, dir: string) => void;
  onInternalBlankDragLeave?: (event: React.DragEvent, dir: string) => void;
  onInternalBlankDrop?: (event: React.DragEvent, dir: string) => void;
};

export function FileTreeChildren({
  dir,
  depth,
  inlineCreate,
  onInlineCreateChange,
  onInlineCreateCommit,
  onInlineCreateCancel,
  onContextMenu,
  contextMenuTargetPath,
  showAgentLabels: _showAgentLabels = true,
  isExternalRowDropTarget,
  isExternalBlankDropTarget,
  onExternalEntryDragOver,
  onExternalEntryDragLeave,
  onExternalEntryDrop,
  onExternalBlankDragOver,
  onExternalBlankDragLeave,
  onExternalBlankDrop,
  scopeId,
  onEntryClick,
  onPrepareContextSelection,
  onInternalDragStart,
  onInternalDragEnd,
  onInternalEntryDragOver,
  onInternalEntryDragLeave,
  onInternalEntryDrop,
  onInternalBlankDragOver,
  onInternalBlankDragLeave,
  onInternalBlankDrop,
}: FileTreeChildrenProps) {
  const children = useAppStore((state) => state.dirEntries.get(dir) ?? EMPTY_ENTRIES);
  const hasDirectorySnapshot = useAppStore((state) => state.dirEntries.has(dir));
  const loading = useAppStore((state) => state.dirLoading.has(dir));
  const loadError = useAppStore((state) => state.dirErrors.get(dir) ?? null);
  const fileExcludePatterns = useFileExcludeStore((state) => state.patterns);
  const loadDirectory = useAppStore((state) => state.loadDirectory);

  useEffect(() => {
    loadDirectory(dir);
  }, [dir, loadDirectory]);

  const visibleChildren = useMemo(
    () => filterFileEntries(children, dir, fileExcludePatterns),
    [children, dir, fileExcludePatterns],
  );

  const showInlineCreate = inlineCreate && inlineCreate.dir === dir;

  if ((!hasDirectorySnapshot || loading) && visibleChildren.length === 0 && !showInlineCreate) {
    return (
      <div className="text-secondary-text py-1" style={{ paddingLeft: `${depth * 12 + 24}px` }}>
        Loading...
      </div>
    );
  }

  if (loadError && visibleChildren.length === 0 && !showInlineCreate) {
    return (
      <div className="py-1 text-red-400/90" style={{ paddingLeft: `${depth * 12 + 24}px` }}>
        {loadError}
      </div>
    );
  }

  if (hasDirectorySnapshot && visibleChildren.length === 0 && !showInlineCreate) {
    return null;
  }

  return (
    <div
      className={isExternalBlankDropTarget?.(dir) ? 'file-tree-blank-drop-target' : undefined}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(event.clientX, event.clientY, { kind: 'blank', dir, depthForCreate: depth });
      }}
      onDragOver={(event) => {
        onInternalBlankDragOver?.(event, dir);
        if (!event.defaultPrevented) {
          onExternalBlankDragOver?.(event, dir);
        }
      }}
      onDragLeave={(event) => {
        onInternalBlankDragLeave?.(event, dir);
        onExternalBlankDragLeave?.(event, dir);
      }}
      onDrop={(event) => {
        onInternalBlankDrop?.(event, dir);
        if (!event.defaultPrevented) {
          onExternalBlankDrop?.(event, dir);
        }
      }}
    >
      {showInlineCreate ? (
        <InlineCreateRow
          depth={inlineCreate.depth}
          value={inlineCreate.value}
          placeholder={inlineCreate.kind === 'file' ? 'New file name' : 'New folder name'}
          error={inlineCreate.error}
          onChange={onInlineCreateChange}
          onCommit={onInlineCreateCommit}
          onCancel={onInlineCreateCancel}
        />
      ) : null}

      {visibleChildren.map((entry) => {
        const fullPath = `${dir}/${entry.name}`;
        return (
        <FileTreeItem
          key={entry.name}
          entry={entry}
          parentDir={dir}
          depth={depth}
          onContextMenu={onContextMenu}
          contextMenuTargetPath={contextMenuTargetPath}
          externalDropTarget={Boolean(isExternalRowDropTarget?.(fullPath))}
          onExternalDragOver={onExternalEntryDragOver}
          onExternalDragLeave={onExternalEntryDragLeave}
          onExternalDrop={onExternalEntryDrop}
          scopeId={scopeId}
          onEntryClick={onEntryClick}
          onPrepareContextSelection={onPrepareContextSelection}
          onInternalDragStart={onInternalDragStart}
          onInternalDragEnd={onInternalDragEnd}
          onInternalDragOver={onInternalEntryDragOver}
          onInternalDragLeave={onInternalEntryDragLeave}
          onInternalDrop={onInternalEntryDrop}
          renderChildren={(childDir, nextDepth) => (
            <FileTreeChildren
              dir={childDir}
              depth={nextDepth}
              inlineCreate={inlineCreate}
              onInlineCreateChange={onInlineCreateChange}
              onInlineCreateCommit={onInlineCreateCommit}
              onInlineCreateCancel={onInlineCreateCancel}
              onContextMenu={onContextMenu}
              contextMenuTargetPath={contextMenuTargetPath}
              showAgentLabels={false}
              isExternalRowDropTarget={isExternalRowDropTarget}
              isExternalBlankDropTarget={isExternalBlankDropTarget}
              onExternalEntryDragOver={onExternalEntryDragOver}
              onExternalEntryDragLeave={onExternalEntryDragLeave}
              onExternalEntryDrop={onExternalEntryDrop}
              onExternalBlankDragOver={onExternalBlankDragOver}
              onExternalBlankDragLeave={onExternalBlankDragLeave}
              onExternalBlankDrop={onExternalBlankDrop}
              scopeId={scopeId}
              onEntryClick={onEntryClick}
              onPrepareContextSelection={onPrepareContextSelection}
              onInternalDragStart={onInternalDragStart}
              onInternalDragEnd={onInternalDragEnd}
              onInternalEntryDragOver={onInternalEntryDragOver}
              onInternalEntryDragLeave={onInternalEntryDragLeave}
              onInternalEntryDrop={onInternalEntryDrop}
              onInternalBlankDragOver={onInternalBlankDragOver}
              onInternalBlankDragLeave={onInternalBlankDragLeave}
              onInternalBlankDrop={onInternalBlankDrop}
            />
          )}
        />
        );
      })}
    </div>
  );
}
