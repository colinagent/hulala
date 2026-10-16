import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { rendererI18n } from '../../../i18n/renderer';
import {
  getEditorDocuments,
  useAppStore,
  useWorkspaceViewId,
  type EditorPane,
} from '../../store/appStore';
import { writeClipboardText } from '../../services/clipboardService';
import { BROWSER_REFERENCE_MIME, decodeBrowserReference, encodeBrowserReference, pinBrowserReference } from '../../services/browserReferences';
import { useDismissOnOutsideInteraction } from '../../hooks/useDismissOnOutsideInteraction';
import { hasFileLikeEditorIdentity } from '../../utils/setiFileIcon';
import { FileTypeIcon } from '../FileTypeIcon';
import {
  AgentSparkIcon,
  CloseButton,
  ListIcon,
  PlusIcon,
} from '../Icons';
import { IconButton } from '../IconButton';
import { PopupMenu, PopupMenuItem, PopupMenuSeparator } from '../PopupMenu';
import { CompressibleTabStrip } from '../CompressibleTabStrip';
import { EditorTabSaveIndicator } from '../EditorTabSaveIndicator';
import {
  TAB_ITEM_FLEX_STYLE,
  TAB_CLOSE_BUTTON_DELAYED_REVEAL_CLASS,
  getTabCloseButtonClassName,
  getTabShellClassName,
} from '../tabLayout';

export const EDITOR_TAB_DRAG_MIME = 'application/x-hulala-editor-tab';

const TAB_CONTEXT_MENU_WIDTH = 220;
const TAB_CONTEXT_MENU_ITEM_HEIGHT = 34;
const TAB_CONTEXT_MENU_SEPARATOR_HEIGHT = 9;
const TAB_CONTEXT_MENU_VERTICAL_PADDING = 8;

type TabContextMenuState = {
  x: number;
  y: number;
  tabId: string;
};

type EditorTabBarProps = {
  pane?: EditorPane;
  rightWorkspaceControl?: React.ReactNode;
  onTabDragStateChange?: (tabId: string | null) => void;
  onMoveTabToPane?: (tabId: string, pane: EditorPane) => void;
};

export const EditorTabBar: React.FC<EditorTabBarProps> = ({
  pane = 'main',
  rightWorkspaceControl,
  onTabDragStateChange,
  onMoveTabToPane,
}) => {
  const workspaceViewId = useWorkspaceViewId();
  const documents = useAppStore((state) => state.documents);
  const connectionState = useAppStore((state) => state.connectionState);
  const tabs = useMemo(() => getEditorDocuments(documents, pane), [documents, pane]);
  const activeTabId = useAppStore((state) =>
    pane === 'right' ? state.rightActiveTabId : state.mainActiveTabId,
  );
  const rightPaneActiveTabKey = useAppStore((state) => state.rightPaneActiveTabKey);
  const outlineTabOpen = useAppStore((state) => state.outlineTabOpen);
  const activityPanelPinnedRight = useAppStore((state) => state.activityPanelPinnedRight);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const selectRightPaneTab = useAppStore((state) => state.selectRightPaneTab);
  const closeOutlineInRightPane = useAppStore((state) => state.closeOutlineInRightPane);
  const setActivityPanelPinnedRight = useAppStore((state) => state.setActivityPanelPinnedRight);
  const moveTabToPane = useAppStore((state) => state.moveTabToPane);
  const closeTab = useAppStore((state) => state.closeTab);
  const closeOtherTabs = useAppStore((state) => state.closeOtherTabs);
  const closeAllTabs = useAppStore((state) => state.closeAllTabs);
  const openUntitledTab = useAppStore((state) => state.openUntitledTab);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const tabContextMenuRef = useRef<HTMLDivElement | null>(null);
  const targetPane: EditorPane = pane === 'main' ? 'right' : 'main';
  const moveTab = (tabId: string, destination: EditorPane) => {
    if (onMoveTabToPane) {
      onMoveTabToPane(tabId, destination);
      return;
    }
    moveTabToPane(tabId, destination);
  };

  useDismissOnOutsideInteraction({
    active: tabContextMenu !== null,
    onDismiss: () => setTabContextMenu(null),
    insideRefs: [tabContextMenuRef],
  });

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (pane !== 'main') return;
    if ((event.target as HTMLElement).closest('[data-tab-item], [data-tabbar-action]')) return;
    openUntitledTab();
  };

  const openTabContextMenu = (event: React.MouseEvent, tabId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setTabContextMenu({ x: event.clientX, y: event.clientY, tabId });
  };

  const contextTab = tabContextMenu
    ? tabs.find((tab) => tab.id === tabContextMenu.tabId) || null
    : null;
  const contextFilePath = (contextTab?.filePath || '').trim();

  const runContextAction = (action: () => void | Promise<void>) => {
    setTabContextMenu(null);
    void action();
  };

  const moveLabel = pane === 'main'
    ? rendererI18n.t('shell:editorPane.moveRight')
    : rendererI18n.t('shell:editorPane.moveMain');
  const tabContextMenuNode = (() => {
    if (!tabContextMenu || !contextTab) return null;
    const itemCount = 5;
    const menuHeight = TAB_CONTEXT_MENU_VERTICAL_PADDING
      + itemCount * TAB_CONTEXT_MENU_ITEM_HEIGHT
      + TAB_CONTEXT_MENU_SEPARATOR_HEIGHT;
    const left = Math.min(
      Math.max(8, tabContextMenu.x),
      Math.max(8, window.innerWidth - TAB_CONTEXT_MENU_WIDTH - 8),
    );
    const top = Math.min(
      Math.max(8, tabContextMenu.y),
      Math.max(8, window.innerHeight - menuHeight - 8),
    );
    return createPortal(
      <PopupMenu
        substrate="sidebar"
        ref={tabContextMenuRef}
        className="fixed z-50 overflow-hidden"
        style={{ left, top, width: TAB_CONTEXT_MENU_WIDTH }}
        onMouseDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <PopupMenuItem
          disabled={!contextFilePath}
          onClick={() => runContextAction(() => {
            moveTab(contextTab.id, targetPane);
          })}
        >
          {moveLabel}
        </PopupMenuItem>
        <PopupMenuItem
          disabled={!contextFilePath}
          onClick={() => runContextAction(() => writeClipboardText(contextFilePath))}
        >
          Copy Path
        </PopupMenuItem>
        <PopupMenuSeparator />
        <PopupMenuItem onClick={() => runContextAction(() => closeTab(contextTab.id, { focusEditor: true }))}>
          Close
        </PopupMenuItem>
        <PopupMenuItem
          disabled={tabs.length < 2}
          onClick={() => runContextAction(() => closeOtherTabs(contextTab.id, { focusEditor: true }))}
        >
          Close Others
        </PopupMenuItem>
        <PopupMenuItem onClick={() => runContextAction(() => closeAllTabs())}>
          Close All
        </PopupMenuItem>
      </PopupMenu>,
      document.body,
    );
  })();

  const action = (
    <div className="flex shrink-0 items-center gap-0.5 pr-1">
      {pane === 'main' ? (
        <IconButton
          data-tabbar-action
          size={24}
          className="shrink-0 text-secondary-text"
          onClick={openUntitledTab}
          title="New tab"
          aria-label="New tab"
        >
          <PlusIcon className="w-3.5 h-3.5" />
        </IconButton>
      ) : null}
    </div>
  );

  return (
    <div
      className={`ui-tabbar editor-tabbar editor-file-tabbar flex items-center editor-pane-tabbar is-${pane}`}
      data-editor-pane={pane}
      onDoubleClick={handleDoubleClick}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(EDITOR_TAB_DRAG_MIME)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }
      }}
      onDrop={(event) => {
        const reference = decodeBrowserReference(event.dataTransfer.getData(BROWSER_REFERENCE_MIME));
        const localTab = event.dataTransfer.getData(EDITOR_TAB_DRAG_MIME).trim();
        if (reference && !documents.some(document => document.id === localTab)) {
          event.preventDefault();
          void pinBrowserReference(reference).catch(error => window.dispatchEvent(new CustomEvent('hulala:notice', { detail: String(error) })));
          return;
        }
        const tabId = event.dataTransfer.getData(EDITOR_TAB_DRAG_MIME).trim();
        if (!tabId) return;
        event.preventDefault();
        moveTab(tabId, pane);
        onTabDragStateChange?.(null);
      }}
    >
      <CompressibleTabStrip
        activeItemKey={pane === 'right' ? rightPaneActiveTabKey : activeTabId}
        stripClassName="editor-file-tab-strip"
        tabContainerClassName="h-full"
        action={action}
      >
        {pane === 'right' && outlineTabOpen ? (
          <div
            key="outline"
            data-tab-item
            data-tab-strip-active={rightPaneActiveTabKey === 'outline' ? 'true' : 'false'}
            className={getTabShellClassName(
              rightPaneActiveTabKey === 'outline',
              'editor-file-tab cursor-pointer',
            )}
            style={TAB_ITEM_FLEX_STYLE}
            onPointerDown={(event) => {
              if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return;
              selectRightPaneTab('outline');
            }}
          >
            <ListIcon className="mr-1.5 h-3.5 w-3.5 shrink-0" />
            <span className="ui-chrome-row-label flex-1 min-w-0 truncate text-secondary-text">
              {rendererI18n.t('shell:editorPane.outline')}
            </span>
            <CloseButton
              className={getTabCloseButtonClassName('bg-secondary-bg', TAB_CLOSE_BUTTON_DELAYED_REVEAL_CLASS)}
              onClick={(event) => {
                event.stopPropagation();
                closeOutlineInRightPane();
              }}
              variant="inline"
            />
          </div>
        ) : null}
        {pane === 'right' && activityPanelPinnedRight ? (
          <div
            key="activity"
            data-tab-item
            data-tab-strip-active={rightPaneActiveTabKey === 'activity' ? 'true' : 'false'}
            className={getTabShellClassName(
              rightPaneActiveTabKey === 'activity',
              'editor-file-tab cursor-pointer',
            )}
            style={TAB_ITEM_FLEX_STYLE}
            onPointerDown={(event) => {
              if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return;
              selectRightPaneTab('activity');
            }}
          >
            <AgentSparkIcon className="mr-1.5 h-3.5 w-3.5 shrink-0" />
            <span className="ui-chrome-row-label flex-1 min-w-0 truncate text-secondary-text">
              {rendererI18n.t('shell:editorPane.activity')}
            </span>
            <CloseButton
              className={getTabCloseButtonClassName('bg-secondary-bg', TAB_CLOSE_BUTTON_DELAYED_REVEAL_CLASS)}
              onClick={(event) => {
                event.stopPropagation();
                setActivityPanelPinnedRight(false);
              }}
              variant="inline"
            />
          </div>
        ) : null}
        {tabs.map((tab) => {
          const tabKey = pane === 'right' ? `file:${tab.id}` : tab.id;
          const isActive = pane === 'right'
            ? rightPaneActiveTabKey === tabKey
            : tab.id === activeTabId;
          const hasFileTypeIcon = hasFileLikeEditorIdentity(tab.filePath, tab.editorId);
          const tabTitle = tab.missing ? `${tab.title} (deleted)` : tab.title;
          const tabTooltip = tab.missing
            ? `${tab.filePath || tab.title}\nFile was deleted on disk`
            : (tab.filePath || tab.title);
          return (
            <div
              key={tabKey}
              data-tab-item
              data-tab-strip-active={isActive ? 'true' : 'false'}
              draggable={Boolean(tab.filePath)}
              title={tabTooltip}
              className={getTabShellClassName(isActive, 'editor-file-tab cursor-pointer')}
              style={TAB_ITEM_FLEX_STYLE}
              onDragStart={(event) => {
                if (!tab.filePath) {
                  event.preventDefault();
                  return;
                }
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData(EDITOR_TAB_DRAG_MIME, tab.id);
                event.dataTransfer.setData(BROWSER_REFERENCE_MIME, encodeBrowserReference(workspaceViewId, tab.filePath));
                onTabDragStateChange?.(tab.id);
              }}
              onDragEnd={() => onTabDragStateChange?.(null)}
              onPointerDown={(event) => {
                if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return;
                if (pane === 'right') {
                  selectRightPaneTab(`file:${tab.id}`);
                } else {
                  setActiveTab(tab.id, { focusEditor: true });
                }
              }}
              onContextMenu={(event) => openTabContextMenu(event, tab.id)}
            >
              {hasFileTypeIcon ? (
                <FileTypeIcon
                  filePath={tab.filePath}
                  fileName={tab.filePath ? undefined : tab.title}
                  editorId={tab.editorId}
                  className="mr-1.5"
                />
              ) : null}
              <span className={`ui-chrome-row-label flex-1 min-w-0 truncate cursor-pointer ${
                isActive ? 'text-prime-text' : 'text-secondary-text'
              } ${tab.missing ? 'italic opacity-70' : ''}`}>
                {tabTitle}
              </span>
              <EditorTabSaveIndicator document={tab} connectionState={connectionState} />
              <CloseButton
                className={getTabCloseButtonClassName(
                  'bg-secondary-bg',
                  TAB_CLOSE_BUTTON_DELAYED_REVEAL_CLASS,
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id, { focusEditor: true });
                }}
                variant="inline"
              />
            </div>
          );
        })}
      </CompressibleTabStrip>
      {rightWorkspaceControl ? <div data-tabbar-action className="ml-auto shrink-0 pr-1">{rightWorkspaceControl}</div> : null}
      {tabContextMenuNode}
    </div>
  );
};
