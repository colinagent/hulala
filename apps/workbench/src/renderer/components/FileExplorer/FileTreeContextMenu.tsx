import React, { useMemo, useRef } from 'react';

import { useDismissOnOutsideInteraction } from '../../hooks/useDismissOnOutsideInteraction';
import { PopupMenu, PopupMenuItem, PopupMenuSeparator } from '../PopupMenu';

export type FileTreeMenuAction = {
  label: string;
  disabled: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>;
};

type FileTreeContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  actions: FileTreeMenuAction[];
  splitIndex?: number;
  onDismiss: () => void;
};

export function FileTreeContextMenu({ open, x, y, actions, splitIndex, onDismiss }: FileTreeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useDismissOnOutsideInteraction({
    active: open,
    onDismiss,
    insideRefs: [menuRef],
  });

  const menuPosition = useMemo(() => {
    if (!open) {
      return { left: 0, top: 0 };
    }
    const menuWidth = 240;
    const menuItemHeight = 36;
    const menuOffsetX = 8;
    const dividerCount = splitIndex !== undefined && splitIndex > 0 && splitIndex < actions.length ? 1 : 0;
    const menuHeight = menuItemHeight * actions.length + dividerCount;
    const left = Math.min(Math.max(8, x + menuOffsetX), Math.max(8, window.innerWidth - menuWidth - 8));
    const top = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - menuHeight - 8));
    return { left, top };
  }, [open, x, y, actions.length, splitIndex]);

  if (!open) {
    return null;
  }

  return (
    <PopupMenu
      substrate="sidebar"
      ref={menuRef}
      className="fixed z-50 min-w-[240px] overflow-hidden"
      style={{ left: menuPosition.left, top: menuPosition.top }}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {actions.map((action, index) => (
        <React.Fragment key={`${action.label}-${index}`}>
          {splitIndex !== undefined && splitIndex === index ? <PopupMenuSeparator /> : null}
          <PopupMenuItem
            className="px-3 py-2 gap-0"
            disabled={action.disabled}
            onClick={(event) => {
              void action.onClick(event);
            }}
          >
            {action.label}
          </PopupMenuItem>
        </React.Fragment>
      ))}
    </PopupMenu>
  );
}
