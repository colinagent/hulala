/**
 * Editor context menu: Copy / Paste / Format / Insert.
 * Obsidian-style: minimal, text-first; styling matches FileTreeContextMenu.
 */

import React, { useMemo, useState, useRef, useEffect } from 'react';
import {
  CopyIcon,
  PasteIcon,
  PlusIcon,
  MermaidIcon,
  EditIcon,
  TableIcon,
  ListIcon,
  CodeBlockIcon,
  ChevronRightIcon,
} from '../Icons';
import { PopupMenu, PopupMenuItem, PopupMenuSeparator } from '../PopupMenu';
import type { MarkdownInlineFormat } from './codemirror/utils/inlineFormat';

const MENU_WIDTH = 220;
const MENU_OFFSET_X = 8;
const MENU_ITEM_HEIGHT = 34;
const MENU_SEPARATOR_HEIGHT = 9;
const MENU_VERTICAL_PADDING = 8;

export type EditorContextMenuApi = {
  copySelection: () => void;
  pasteFromClipboard: () => Promise<void>;
  insertAtSelection: (text: string) => void;
  toggleInlineFormat: (format: MarkdownInlineFormat) => void;
  clearInlineFormatting: () => void;
} | null;

type EditorContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  onClose: () => void;
  editorApi: EditorContextMenuApi;
  onExportPdf?: () => Promise<void> | void;
  onInsertRandomID?: () => Promise<void> | void;
  canInsertRandomID?: boolean;
  onInsertExcalidraw?: () => void;
  canInsertExcalidraw?: boolean;
};

const MERMAID_TEMPLATE = [
  '',
  '',
  '```mermaid',
  'graph LR',
  '  A[Rectangle] --> B(Rounded)',
  '  B --> C{Diamond}',
  '  C --> D([Stadium])',
  '  D --> E((Circle))',
  '```',
  '',
].join('\n');
const TABLE_TEMPLATE = '\n\n|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n';
const TASK_LIST_TEMPLATE = '\n- [ ] \n';
const CODE_BLOCK_TEMPLATE = '\n\n```\n\n```\n';

const SUBMENU_CLOSE_DELAY_MS = 120;
type EditorContextSubmenu = 'format' | 'insert';

const FORMAT_ITEMS: Array<{ label: string; format: MarkdownInlineFormat; icon: string; className?: string }> = [
  { label: 'Bold', format: 'bold', icon: 'B', className: 'font-bold' },
  { label: 'Italic', format: 'italic', icon: 'I', className: 'italic' },
  { label: 'Strikethrough', format: 'strikethrough', icon: 'S', className: 'line-through' },
  { label: 'Highlight', format: 'highlight', icon: '=' },
  { label: 'Code', format: 'code', icon: '`' },
];

export function EditorContextMenu({
  open,
  x,
  y,
  onClose,
  editorApi,
  onExportPdf,
  onInsertRandomID,
  canInsertRandomID = true,
  onInsertExcalidraw,
  canInsertExcalidraw = true,
}: EditorContextMenuProps) {
  const [openSubmenu, setOpenSubmenu] = useState<EditorContextSubmenu | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSubmenuClose = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setOpenSubmenu(null);
    }, SUBMENU_CLOSE_DELAY_MS);
  };

  const cancelSubmenuClose = (submenu: EditorContextSubmenu) => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpenSubmenu(submenu);
  };

  const hasEditor = editorApi != null;
  const hasExportPdf = typeof onExportPdf === 'function';
  const canRunRandomID = hasEditor && typeof onInsertRandomID === 'function' && canInsertRandomID;
  const mainMenuHeight = MENU_ITEM_HEIGHT * (hasExportPdf ? 5 : 4)
    + MENU_SEPARATOR_HEIGHT * (hasExportPdf ? 2 : 1)
    + MENU_VERTICAL_PADDING;
  const mainPosition = useMemo(() => {
    if (!open) return { left: 0, top: 0 };
    const left = Math.min(
      Math.max(8, x + MENU_OFFSET_X),
      Math.max(8, window.innerWidth - MENU_WIDTH - 8)
    );
    const top = Math.min(
      Math.max(8, y),
      Math.max(8, window.innerHeight - mainMenuHeight - 8)
    );
    return { left, top };
  }, [mainMenuHeight, open, x, y]);

  // Clear close timer when menu closes
  useEffect(() => {
    if (!open && closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (!open) {
      setOpenSubmenu(null);
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) {
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

  const runAndClose = (fn: () => void | Promise<void>) => {
    Promise.resolve(fn()).then(onClose);
  };

  return (
    <>
      <PopupMenu
        ref={menuRef}
        className="fixed z-50 min-w-[220px]"
        style={{ left: mainPosition.left, top: mainPosition.top }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <PopupMenuItem
          disabled={!hasEditor}
          onClick={() => runAndClose(() => editorApi?.copySelection())}
        >
          <CopyIcon className="w-4 h-4 opacity-70" />
          <span>Copy</span>
          <span className="ml-auto text-xs opacity-50">⌘C</span>
        </PopupMenuItem>
        <PopupMenuItem
          disabled={!hasEditor}
          onClick={() => runAndClose(() => editorApi?.pasteFromClipboard())}
        >
          <PasteIcon className="w-4 h-4 opacity-70" />
          <span>Paste</span>
          <span className="ml-auto text-xs opacity-50">⌘V</span>
        </PopupMenuItem>

        {hasExportPdf && (
          <>
            <PopupMenuSeparator />
            <PopupMenuItem onClick={() => runAndClose(() => onExportPdf?.())}>
              <span>Export PDF</span>
            </PopupMenuItem>
          </>
        )}

        <PopupMenuSeparator />

        <div
          className="relative w-full"
          onMouseEnter={() => cancelSubmenuClose('format')}
          onMouseLeave={scheduleSubmenuClose}
        >
          <PopupMenuItem
            disabled={!hasEditor}
            onClick={() => {
              setOpenSubmenu(openSubmenu === 'format' ? null : 'format');
            }}
          >
            <span className="w-4 text-center text-sm font-semibold opacity-70">A</span>
            <span className="flex-1">Format</span>
            <ChevronRightIcon className="w-3.5 h-3.5 opacity-50" />
          </PopupMenuItem>

          {openSubmenu === 'format' && hasEditor && (
            <PopupMenu
              className="absolute left-full top-0 ml-1 z-[51] min-w-[190px]"
              onMouseEnter={() => cancelSubmenuClose('format')}
              onMouseLeave={scheduleSubmenuClose}
            >
              {FORMAT_ITEMS.map((item) => (
                <PopupMenuItem
                  key={item.format}
                  onClick={() =>
                    runAndClose(() => editorApi?.toggleInlineFormat(item.format))
                  }
                >
                  <span className={`w-4 text-center opacity-70 ${item.className || ''}`}>{item.icon}</span>
                  <span>{item.label}</span>
                </PopupMenuItem>
              ))}
              <PopupMenuSeparator />
              <PopupMenuItem
                onClick={() =>
                  runAndClose(() => editorApi?.clearInlineFormatting())
                }
              >
                <span className="w-4 text-center text-xs opacity-70">Tx</span>
                <span>Clear formatting</span>
              </PopupMenuItem>
            </PopupMenu>
          )}
        </div>

        <div
          className="relative w-full"
          onMouseEnter={() => cancelSubmenuClose('insert')}
          onMouseLeave={scheduleSubmenuClose}
        >
          <PopupMenuItem
            disabled={!hasEditor}
            onClick={() => {
              setOpenSubmenu(openSubmenu === 'insert' ? null : 'insert');
            }}
          >
            <PlusIcon className="w-4 h-4 opacity-70" />
            <span className="flex-1">Insert</span>
            <ChevronRightIcon className="w-3.5 h-3.5 opacity-50" />
          </PopupMenuItem>

          {openSubmenu === 'insert' && hasEditor && (
            <PopupMenu
              className="absolute left-full bottom-0 ml-1 z-[51] min-w-[180px]"
              onMouseEnter={() => cancelSubmenuClose('insert')}
              onMouseLeave={scheduleSubmenuClose}
            >
              <PopupMenuItem
                disabled={!canRunRandomID}
                onClick={() =>
                  runAndClose(() => onInsertRandomID?.())
                }
              >
                <span className="w-4 text-center text-xs font-semibold opacity-70">ID</span>
                <span>Random ID</span>
              </PopupMenuItem>
              <PopupMenuItem
                onClick={() =>
                  runAndClose(() => editorApi?.insertAtSelection(MERMAID_TEMPLATE))
                }
              >
                <MermaidIcon className="w-4 h-4 opacity-70" />
                <span>Mermaid Diagram</span>
              </PopupMenuItem>
              <PopupMenuItem
                disabled={!onInsertExcalidraw || !canInsertExcalidraw}
                onClick={() => runAndClose(() => onInsertExcalidraw?.())}
              >
                <EditIcon className="w-4 h-4 opacity-70" />
                <span>Excalidraw</span>
              </PopupMenuItem>
              <PopupMenuItem
                onClick={() =>
                  runAndClose(() => editorApi?.insertAtSelection(TABLE_TEMPLATE))
                }
              >
                <TableIcon className="w-4 h-4 opacity-70" />
                <span>Table</span>
              </PopupMenuItem>
              <PopupMenuItem
                onClick={() =>
                  runAndClose(() => editorApi?.insertAtSelection(TASK_LIST_TEMPLATE))
                }
              >
                <ListIcon className="w-4 h-4 opacity-70" />
                <span>Task List</span>
              </PopupMenuItem>
              <PopupMenuItem
                onClick={() =>
                  runAndClose(() => editorApi?.insertAtSelection(CODE_BLOCK_TEMPLATE))
                }
              >
                <CodeBlockIcon className="w-4 h-4 opacity-70" />
                <span>Code Block</span>
              </PopupMenuItem>
            </PopupMenu>
          )}
        </div>
      </PopupMenu>
    </>
  );
}
