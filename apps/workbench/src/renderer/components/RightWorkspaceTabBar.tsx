import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { rendererI18n } from '../../i18n/renderer';
import type { DocumentTab } from '../store/appStore';
import type { ConnectionState } from '../services/desktopConnection';
import {
  rightWorkspaceFileKey,
  type RightWorkspaceFileRef,
  type RightWorkspaceTabKey,
} from '../store/rightWorkspaceStore';
import { useDismissOnOutsideInteraction } from '../hooks/useDismissOnOutsideInteraction';
import { AgentSparkIcon, CloseButton, ListIcon } from './Icons';
import { FileTypeIcon } from './FileTypeIcon';
import { PopupMenu, PopupMenuItem, PopupMenuSeparator } from './PopupMenu';
import { CompressibleTabStrip } from './CompressibleTabStrip';
import { EditorTabSaveIndicator } from './EditorTabSaveIndicator';
import { EDITOR_TAB_DRAG_MIME } from './Editor/EditorTabBar';
import { BROWSER_REFERENCE_MIME, encodeBrowserReference } from '../services/browserReferences';
import { useTabManagerStore } from '../store/tabManagerStore';
import {
  TAB_ITEM_FLEX_STYLE,
  TAB_CLOSE_BUTTON_DELAYED_REVEAL_CLASS,
  getTabCloseButtonClassName,
  getTabShellClassName,
} from './tabLayout';

export type RightWorkspaceFileTab = {
  ref: RightWorkspaceFileRef;
  document: DocumentTab;
  connectionState: ConnectionState;
};

type Props = {
  rightWorkspaceControl: React.ReactNode;
  onAddReference?: () => void;
  files: RightWorkspaceFileTab[];
  activeTabKey?: RightWorkspaceTabKey;
  outlineOpen: boolean;
  activityPinned: boolean;
  onSelect: (key: RightWorkspaceTabKey) => void;
  onCloseFile: (file: RightWorkspaceFileTab) => void;
  onMoveFileToMain: (file: RightWorkspaceFileTab) => void;
  onCloseOutline: () => void;
  onCloseActivity: () => void;
};

type ContextMenuState = { x: number; y: number; file: RightWorkspaceFileTab };

export function RightWorkspaceTabBar({
  rightWorkspaceControl,
  onAddReference,
  files,
  activeTabKey,
  outlineOpen,
  activityPinned,
  onSelect,
  onCloseFile,
  onMoveFileToMain,
  onCloseOutline,
  onCloseActivity,
}: Props) {
  const currentWorkspaceView = useTabManagerStore(state => state.activeTabId);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutsideInteraction({
    active: contextMenu !== null,
    onDismiss: () => setContextMenu(null),
    insideRefs: [contextMenuRef],
  });

  const toolTab = (
    key: 'outline' | 'activity',
    label: string,
    icon: React.ReactNode,
    onClose: () => void,
  ) => {
    const active = activeTabKey === key;
    return (
      <div
        key={key}
        data-tab-item
        data-tab-strip-active={active ? 'true' : 'false'}
        className={getTabShellClassName(active, 'editor-file-tab cursor-pointer')}
        style={TAB_ITEM_FLEX_STYLE}
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return;
          onSelect(key);
        }}
      >
        {icon}
        <span className="ui-chrome-row-label min-w-0 flex-1 truncate text-secondary-text">{label}</span>
        <CloseButton
          className={getTabCloseButtonClassName('bg-secondary-bg', TAB_CLOSE_BUTTON_DELAYED_REVEAL_CLASS)}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          variant="inline"
        />
      </div>
    );
  };

  return (
    <div className="ui-tabbar editor-tabbar editor-file-tabbar editor-pane-tabbar is-right flex items-center">
      <CompressibleTabStrip
        activeItemKey={activeTabKey}
        stripClassName="editor-file-tab-strip"
        tabContainerClassName="h-full"
        action={onAddReference ? <button type="button" className="px-2 text-xs text-secondary-text hover:text-link-text" onClick={onAddReference} title="Add a reference from a Workspace">Reference file…</button> : null}
      >
        {outlineOpen
          ? toolTab(
              'outline',
              rendererI18n.t('shell:editorPane.outline'),
              <ListIcon className="mr-1.5 h-3.5 w-3.5 shrink-0" />,
              onCloseOutline,
            )
          : null}
        {activityPinned
          ? toolTab(
              'activity',
              rendererI18n.t('shell:editorPane.activity'),
              <AgentSparkIcon className="mr-1.5 h-3.5 w-3.5 shrink-0" />,
              onCloseActivity,
            )
          : null}
        {files.map((file) => {
          const key = rightWorkspaceFileKey(file.ref);
          const active = activeTabKey === key;
          return (
            <div
              key={key}
              data-tab-item
              data-tab-strip-active={active ? 'true' : 'false'}
              draggable
              className={getTabShellClassName(active, 'editor-file-tab cursor-pointer')}
              style={TAB_ITEM_FLEX_STYLE}
              title={[file.ref.source?.label, file.document.filePath || file.document.title].filter(Boolean).join(' · ')}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData(EDITOR_TAB_DRAG_MIME, file.ref.tabId);
                if (file.document.filePath) event.dataTransfer.setData(BROWSER_REFERENCE_MIME, encodeBrowserReference(file.ref.workspaceTabId, file.document.filePath));
              }}
              onPointerDown={(event) => {
                if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return;
                onSelect(key);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({ x: event.clientX, y: event.clientY, file });
              }}
            >
              <FileTypeIcon
                filePath={file.document.filePath}
                editorId={file.document.editorId}
                className="mr-1.5"
              />
              <span className="ui-chrome-row-label min-w-0 flex-1 truncate text-secondary-text">
                {file.ref.source?.label ? `${file.ref.source.label} / ` : ''}{file.document.title}
              </span>
              <EditorTabSaveIndicator document={file.document} connectionState={file.connectionState} />
              <CloseButton
                className={getTabCloseButtonClassName('bg-secondary-bg', TAB_CLOSE_BUTTON_DELAYED_REVEAL_CLASS)}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseFile(file);
                }}
                variant="inline"
              />
            </div>
          );
        })}
      </CompressibleTabStrip>
      <div data-tabbar-action className="ml-auto shrink-0 pr-1">{rightWorkspaceControl}</div>
      {contextMenu ? createPortal(
        <PopupMenu
          substrate="sidebar"
          ref={contextMenuRef}
          className="fixed z-50 w-[190px] overflow-hidden"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <PopupMenuItem onClick={() => {
            onMoveFileToMain(contextMenu.file);
            setContextMenu(null);
          }}>
            {contextMenu.file.ref.workspaceTabId === currentWorkspaceView ? 'Move to Main' : 'Open source Workspace'}
          </PopupMenuItem>
          <PopupMenuSeparator />
          <PopupMenuItem onClick={() => {
            onCloseFile(contextMenu.file);
            setContextMenu(null);
          }}>
            Close
          </PopupMenuItem>
        </PopupMenu>,
        document.body,
      ) : null}
    </div>
  );
}
