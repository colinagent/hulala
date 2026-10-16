import React, { useEffect, useMemo } from 'react';
import { CheckTinyIcon, CodeBlockIcon, CopyIcon, FileIcon, TrashIcon } from '../Icons';
import { PopupMenu, PopupMenuItem, PopupMenuSeparator } from '../PopupMenu';

const MENU_WIDTH = 190;
const MENU_ITEM_HEIGHT = 34;
const MENU_SEPARATOR_HEIGHT = 9;
const MENU_VERTICAL_PADDING = 8;
const IMAGE_WIDTH_OPTIONS = [10, 25, 50, 75, 100, 125, 150] as const;
const IMAGE_ACTION_COUNT = 4;

type ImageContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  currentWidthPercent: number | null;
  onClose: () => void;
  onCopy: () => void | Promise<void>;
  onCopyPath: () => void | Promise<void>;
  onEditSource: () => void;
  onDelete: () => void;
  onSelectWidth: (widthPercent: number) => void;
};

export function ImageContextMenu({
  open,
  x,
  y,
  currentWidthPercent,
  onClose,
  onCopy,
  onCopyPath,
  onEditSource,
  onDelete,
  onSelectWidth,
}: ImageContextMenuProps) {
  const position = useMemo(() => {
    if (!open) {
      return { left: 0, top: 0 };
    }
    const menuHeight =
      (IMAGE_WIDTH_OPTIONS.length + IMAGE_ACTION_COUNT) * MENU_ITEM_HEIGHT +
      MENU_SEPARATOR_HEIGHT +
      MENU_VERTICAL_PADDING;
    return {
      left: Math.min(Math.max(8, x + 8), Math.max(8, window.innerWidth - MENU_WIDTH - 8)),
      top: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - menuHeight - 8)),
    };
  }, [open, x, y]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const menu = document.getElementById('image-context-menu');
      if (menu?.contains(target)) {
        return;
      }
      onClose();
    };
    window.addEventListener('mousedown', onMouseDown, true);
    return () => window.removeEventListener('mousedown', onMouseDown, true);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const activeWidth = currentWidthPercent;

  return (
    <PopupMenu
      id="image-context-menu"
      className="fixed z-[60] min-w-[190px]"
      style={{ left: position.left, top: position.top }}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <PopupMenuItem
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void onCopy();
          onClose();
        }}
      >
        <CopyIcon className="w-4 h-4 opacity-70" />
        <span>Copy</span>
      </PopupMenuItem>
      <PopupMenuItem
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void onCopyPath();
          onClose();
        }}
      >
        <FileIcon className="w-4 h-4 opacity-70" />
        <span>Copy Path</span>
      </PopupMenuItem>
      <PopupMenuItem
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onEditSource();
          onClose();
        }}
      >
        <CodeBlockIcon className="w-4 h-4 opacity-70" />
        <span>Edit source</span>
      </PopupMenuItem>
      <PopupMenuItem
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onDelete();
          onClose();
        }}
      >
        <TrashIcon className="w-4 h-4 opacity-70" />
        <span>Delete</span>
      </PopupMenuItem>
      <PopupMenuSeparator />
      {IMAGE_WIDTH_OPTIONS.map((option) => {
        const active = activeWidth === option;
        return (
          <PopupMenuItem
            key={option}
            active={active}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelectWidth(option);
              onClose();
            }}
          >
            <span className="flex w-4 items-center justify-center">
              {active ? <CheckTinyIcon className="w-3 h-3" /> : null}
            </span>
            <span>{option}%</span>
          </PopupMenuItem>
        );
      })}
    </PopupMenu>
  );
}
