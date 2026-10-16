import React from 'react';

type FileTreeRowProps = {
  depth: number;
  leftContent: React.ReactNode;
  rightContent?: React.ReactNode;
  selected?: boolean;
  multiSelected?: boolean;
  cutItem?: boolean;
  isDotfile?: boolean;
  contextMenuTarget?: boolean;
  externalDropTarget?: boolean;
  internalDropTarget?: boolean;
  title?: string;
  dataFilePath?: string;
  dataFileIsDir?: boolean;
  draggable?: boolean;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  onDoubleClick?: React.MouseEventHandler<HTMLDivElement>;
  onContextMenu?: React.MouseEventHandler<HTMLDivElement>;
  onDragStart?: React.DragEventHandler<HTMLDivElement>;
  onDragEnd?: React.DragEventHandler<HTMLDivElement>;
  onDragOver?: React.DragEventHandler<HTMLDivElement>;
  onDragLeave?: React.DragEventHandler<HTMLDivElement>;
  onDrop?: React.DragEventHandler<HTMLDivElement>;
};

export function FileTreeRow({
  depth,
  leftContent,
  rightContent,
  selected = false,
  multiSelected = false,
  cutItem = false,
  isDotfile = false,
  contextMenuTarget = false,
  externalDropTarget = false,
  internalDropTarget = false,
  title,
  dataFilePath,
  dataFileIsDir,
  draggable,
  onClick,
  onDoubleClick,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: FileTreeRowProps) {
  const rowClassName = [
    'file-tree-item',
    'text-secondary-text',
    selected ? 'selected' : '',
    multiSelected ? 'multi-selected' : '',
    cutItem ? 'cut-item' : '',
    isDotfile ? 'file-tree-dotfile' : '',
    contextMenuTarget ? 'context-menu-target' : '',
    externalDropTarget ? 'external-drop-target' : '',
    internalDropTarget ? 'internal-drop-target' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={rowClassName}
      title={title}
      data-file-path={dataFilePath}
      data-file-is-dir={dataFileIsDir ? 'true' : 'false'}
      draggable={draggable}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="file-tree-item-content" style={{ paddingLeft: `${depth * 12 + 8}px` }}>
        <div className="file-tree-item-main group">
          {leftContent}
        </div>
        {rightContent ? (
          <div className="file-tree-item-right ml-auto flex items-center gap-0.5 group">
            {rightContent}
          </div>
        ) : null}
      </div>
    </div>
  );
}
