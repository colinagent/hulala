import { LocalPluginRailButton, useLocalRailPluginViews } from '../Plugins/LocalPluginButtons';
import { LocalPluginSidebar } from '../Plugins/LocalPluginSidebar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../store/appStore';
import { useRecentWorkspacesStore, type LocalRecentWorkspace } from '../../store/recentWorkspacesStore';
import { useToastStore } from '../../store/toastStore';
import { useUiStore } from '../../store/uiStore';
import { formatMessengerPendingBadgeCount, selectMessengerPendingRequestTotal, useMessengerStore } from '../../store/messengerStore';
import {
  ClockIcon,
  TerminalIcon,
  ChevronDownIcon,
  SidebarPanelToggleIcon,
  MessengerIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SwitchDirectoryIcon,
  WorkspaceIcon,
} from '../Icons';
import { IconButton } from '../IconButton';
import { TitlebarLogoMenu } from '../TitlebarLogoMenu';
import {
  OP_SG_CAPSULE,
  OP_SG_CAPSULE_COMPACT_SHADOW,
  OP_SG_ON_SIDEBAR,
  UI_PILL_BTN_COMPACT,
  UI_PILL_BTN_FIT,
  UI_PILL_BTN_PRIMARY,
} from '../staticGlassCapsule';
import { useFileTreeSelectionStore } from '../FileExplorer/fileTreeSelectionStore';
import { PopupMenu, PopupMenuItem, PopupMenuSeparator } from '../PopupMenu';
import { MessengerSidebar } from './MessengerSidebar';
import { SearchSidebar } from './SearchSidebar';
import { CronSidebar } from './CronSidebar';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { getDirectoryPickerBaseName } from '../FileDialog/directoryPickerModel';
import {
  getMainSidebarRailItems,
  isMainSidebarRailItemActive,
  isMainSidebarRailItemHighlighted,
  isSidebarMoreRailActive,
  planSidebarRailPluginLayout,
  type SidebarRailItemKey,
} from './sidebarTabs';
import { SidebarRailAlertBadge } from './SidebarRailAlertBadge';
import { sidebarRailAlertCount } from './sidebarRailAlerts';
import { useSidebarRailAlerts } from './useSidebarRailAlerts';

type SidebarProps = {
  workspaceActions: React.ReactNode;
  onOpenSettings: () => void;
  onOpenConfigFiles: () => void | Promise<void>;
  onSwitchLocal: (path: string) => Promise<void>;
  onOpenLocalSwitchDirectory: () => void | Promise<void>;
  onOpenRemoteSwitchDirectory: () => void;
};

function getWorkspaceLabel(entry: LocalRecentWorkspace) {
  const parts = entry.path.split('/');
  return parts[parts.length - 1] || entry.path;
}

function getPathBaseName(path: string | null) {
  return getDirectoryPickerBaseName(path) || 'workspace';
}

/** Matches `.sidebar-activity-rail` width; App shrinks to this when the panel is closed. */
export const SIDEBAR_ACTIVITY_RAIL_WIDTH_PX = 52;

const FOLDER_MENU_WIDTH = 260;
const ROOT_ADD_MENU_WIDTH = 220;
const MENU_ITEM_HEIGHT = 34;
const MENU_SEPARATOR_HEIGHT = 9;
const MENU_VERTICAL_PADDING = 8;
const RECENT_HEADER_HEIGHT = 28;
const RECENT_EMPTY_HEIGHT = 30;
const RECENT_LIST_MAX_HEIGHT = 256;
const RECENT_MENU_ITEM_HEIGHT = 44;

function getSwitchMenuHeight(recentCount: number) {
  const recentSectionHeight = recentCount > 0
    ? Math.min(RECENT_LIST_MAX_HEIGHT, recentCount * RECENT_MENU_ITEM_HEIGHT)
    : RECENT_EMPTY_HEIGHT;
  return MENU_VERTICAL_PADDING + MENU_ITEM_HEIGHT + MENU_SEPARATOR_HEIGHT + RECENT_HEADER_HEIGHT + recentSectionHeight;
}

function getAddMenuHeight() {
  return MENU_VERTICAL_PADDING + MENU_ITEM_HEIGHT * 2;
}

function SidebarRailIconSlot({
  itemKey,
  children,
}: {
  itemKey: string;
  children: React.ReactNode;
}) {
  return (
    <span className="sidebar-rail-icon-slot" data-rail-icon={itemKey}>
      {children}
    </span>
  );
}

function SidebarRailIcon({ itemKey }: { itemKey: SidebarRailItemKey }) {
  switch (itemKey) {
    case 'workspace':
      return (
        <SidebarRailIconSlot itemKey={itemKey}>
          <WorkspaceIcon className="w-5 h-5" />
        </SidebarRailIconSlot>
      );
    case 'messenger':
      return (
        <SidebarRailIconSlot itemKey={itemKey}>
          <MessengerIcon className="w-5 h-5" />
        </SidebarRailIconSlot>
      );
    case 'cron':
      return (
        <SidebarRailIconSlot itemKey={itemKey}>
          <ClockIcon className="w-5 h-5" />
        </SidebarRailIconSlot>
      );
  }
}

export function Sidebar({
  workspaceActions,
  onOpenSettings,
  onOpenConfigFiles,
  onSwitchLocal,
  onOpenLocalSwitchDirectory,
  onOpenRemoteSwitchDirectory,
}: SidebarProps) {
  const [menuKind, setMenuKind] = useState<'switch' | 'add' | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const pendingRequestCount = useMessengerStore((state) => selectMessengerPendingRequestTotal(state));
  const unreadMessageCount = useMessengerStore((state) => state.unreadCount);
  const railAlerts = useSidebarRailAlerts();
  /** When set, menu was opened by right-click; position is used for fixed placement. */
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const switchTriggerRef = useRef<HTMLDivElement | null>(null);
  const addTriggerRef = useRef<HTMLDivElement | null>(null);

  /** Compute fixed position for a popup anchored to a trigger element's right edge. */
  const getFixedMenuPosition = (
    triggerRef: React.RefObject<HTMLDivElement | null>,
    menuWidth: number,
    menuHeight: number,
  ): { left: number; top: number } | null => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const left = Math.min(rect.right + 4, window.innerWidth - menuWidth - 8);
    const top = Math.min(Math.max(8, rect.top), window.innerHeight - menuHeight - 8);
    return { left, top };
  };

  const currentDir = useAppStore((state) => state.currentDir);
  const remoteSession = useAppStore((state) => state.remoteSession);
  const setRequestRootAction = useAppStore((state) => state.setRequestRootAction);
  const refreshVisibleWorkspaceTree = useAppStore((state) => state.refreshVisibleWorkspaceTree);
  const recent = useRecentWorkspacesStore((state) => state.recent.local);
  const loadRecent = useRecentWorkspacesStore((state) => state.load);
  const recordLocalRecent = useRecentWorkspacesStore((state) => state.recordLocal);
  const pushToast = useToastStore((state) => state.pushToast);
  const view = useUiStore((state) => state.sidebarView);
  const setView = useUiStore((state) => state.setSidebarView);
  const openConversation = useUiStore((state) => state.openConversation);
  const sidebarPanelOpen = useUiStore((state) => state.sidebarPanelOpen);
  const setSidebarPanelOpen = useUiStore((state) => state.setSidebarPanelOpen);
  const isRemoteWorkspace = !!remoteSession;
  const currentDirLabel = getPathBaseName(currentDir);
  const canCreateAtRoot = Boolean(currentDir);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  // Merge current directory into recent list if not already present
  const displayRecent = useMemo(() => {
    if (!currentDir) {
      return recent;
    }
    const currentInRecent = recent.some((entry) => entry.path === currentDir);
    if (currentInRecent) {
      return recent;
    }
    const currentEntry: LocalRecentWorkspace = {
      path: currentDir,
      lastOpenedAt: Date.now(),
    };
    return [currentEntry, ...recent];
  }, [recent, currentDir]);

  const mainRailItems = useMemo(() => getMainSidebarRailItems(), []);
  const railPluginViews = useLocalRailPluginViews();
  const railPluginLayout = useMemo(
    () => planSidebarRailPluginLayout(railPluginViews, mainRailItems.length + 1),
    [railPluginViews, mainRailItems.length],
  );

  useEffect(() => {
    if (!railPluginLayout.folding) {
      setMoreMenuOpen(false);
    }
  }, [railPluginLayout.folding]);
  const closeMenu = () => {
    setMenuKind(null);
    setContextMenuPosition(null);
  };

  const openSwitchMenu = () => {
    if (isRemoteWorkspace) {
      onOpenRemoteSwitchDirectory();
      closeMenu();
      return;
    }
    setContextMenuPosition(null);
    setMenuKind((prev) => (prev === 'switch' ? null : 'switch'));
  };

  const openAddMenu = () => {
    if (!currentDir) {
      return;
    }
    setContextMenuPosition(null);
    setMenuKind((prev) => (prev === 'add' ? null : 'add'));
  };

  const openRootChat = () => {
    if (!currentDir) {
      return;
    }

    closeMenu();
    openConversation({ kind: 'workspace' });
  };

  const handleSelectRecent = async (entry: LocalRecentWorkspace) => {
    await onSwitchLocal(entry.path);
    await recordLocalRecent({ path: entry.path });
    closeMenu();
  };

  const handleSwitchDirectory = async () => {
    if (isRemoteWorkspace) {
      onOpenRemoteSwitchDirectory();
      closeMenu();
      return;
    }
    await onOpenLocalSwitchDirectory();
    closeMenu();
  };

  const handleWorkspaceClick = () => {
    setView('workspace');
    closeMenu();
  };

  const handleBuiltinViewClick = (nextView: SidebarRailItemKey) => {
    if (isMainSidebarRailItemActive(view, nextView) && sidebarPanelOpen) {
      setSidebarPanelOpen(false);
      closeMenu();
      return;
    }
    setSidebarPanelOpen(true);
    if (nextView === 'workspace') {
      handleWorkspaceClick();
      return;
    }
    setView(nextView);
    closeMenu();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isRemoteWorkspace) {
      onOpenRemoteSwitchDirectory();
      closeMenu();
      return;
    }
    const menuHeight = getSwitchMenuHeight(displayRecent.length);
    // 光标菜单：从触发点右侧偏移少量像素后展开（弹窗设计 §3）
    const x = Math.min(
      Math.max(8, e.clientX + 8),
      window.innerWidth - FOLDER_MENU_WIDTH - 8
    );
    const y = Math.min(
      Math.max(8, e.clientY),
      window.innerHeight - menuHeight - 8
    );
    setContextMenuPosition({ x, y });
    setMenuKind('switch');
  };

  const handleRootAddContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentDir) {
      return;
    }
    const menuHeight = getAddMenuHeight();
    const x = Math.min(
      Math.max(8, e.clientX + 8),
      window.innerWidth - ROOT_ADD_MENU_WIDTH - 8
    );
    const y = Math.min(
      Math.max(8, e.clientY),
      window.innerHeight - menuHeight - 8
    );
    setContextMenuPosition({ x, y });
    setMenuKind('add');
  };

  // Close menu when clicking outside (Switch panel or right-click menu)
  useEffect(() => {
    if (!menuKind) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      closeMenu();
    };
    window.addEventListener('mousedown', onMouseDown, true);
    return () => window.removeEventListener('mousedown', onMouseDown, true);
  }, [menuKind]);

  const dropdownContent = (
    <PopupMenu
      substrate="sidebar"
      className="w-full min-w-0"
      onContextMenu={(e) => e.preventDefault()}
    >
      <PopupMenuItem onClick={handleSwitchDirectory}>
        <SwitchDirectoryIcon className="w-4 h-4 opacity-70" />
        <span>Switch Directory…</span>
      </PopupMenuItem>
      {isRemoteWorkspace ? null : (
        <>
          <PopupMenuSeparator />
          <div className="px-2 py-1 text-xs uppercase tracking-wider text-secondary-text">
            Recent
          </div>
          {displayRecent.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-secondary-text">No recent workspaces</div>
          ) : (
            <div className="max-h-64 overflow-auto">
              {displayRecent.map((entry) => (
                <PopupMenuItem
                  key={entry.path}
                  onClick={() => handleSelectRecent(entry)}
                >
                  <div className="flex flex-col items-stretch gap-0.5 min-w-0">
                    <span className="text-sm truncate">{getWorkspaceLabel(entry)}</span>
                    <span className="text-xs text-tertiary-text truncate">{entry.path}</span>
                  </div>
                </PopupMenuItem>
              ))}
            </div>
          )}
        </>
      )}
    </PopupMenu>
  );

  const addMenuContent = (
    <PopupMenu substrate="sidebar" className="w-[220px]" onContextMenu={(e) => e.preventDefault()}>
      <PopupMenuItem
        disabled={!canCreateAtRoot}
        onClick={() => {
          if (!currentDir) {
            return;
          }
          closeMenu();
          setRequestRootAction('new-file');
        }}
      >
        New File
      </PopupMenuItem>
      <PopupMenuItem
        disabled={!canCreateAtRoot}
        onClick={() => {
          if (!currentDir) {
            return;
          }
          closeMenu();
          setRequestRootAction('new-folder');
        }}
      >
        New Folder
      </PopupMenuItem>
    </PopupMenu>
  );

  const workspaceToolbarActions = (
    <>
      <IconButton
        onClick={(event) => {
          event.stopPropagation();
          void refreshVisibleWorkspaceTree();
        }}
        title="Refresh Directory"
      >
        <RefreshIcon className="w-3.5 h-3.5" />
      </IconButton>
      <IconButton
        onClick={(event) => {
          event.stopPropagation();
          setSidebarPanelOpen(false);
        }}
        title="Collapse Sidebar"
        aria-label="Collapse Sidebar"
      >
        <SidebarPanelToggleIcon className="w-3.5 h-3.5" />
      </IconButton>
      <div
        ref={switchTriggerRef}
        className="relative"
        onClick={(event) => event.stopPropagation()}
      >
        <IconButton
          onClick={(event) => {
            event.stopPropagation();
            openSwitchMenu();
          }}
          title="Switch Directory"
        >
          <SwitchDirectoryIcon className="w-3.5 h-3.5" />
        </IconButton>
        {menuKind === 'switch' && !contextMenuPosition && !isRemoteWorkspace && (() => {
          const pos = getFixedMenuPosition(switchTriggerRef, FOLDER_MENU_WIDTH, getSwitchMenuHeight(displayRecent.length));
          if (!pos) return null;
          return createPortal(
            <div
              ref={menuRef}
              style={{ position: 'fixed', left: pos.left, top: pos.top, width: FOLDER_MENU_WIDTH, zIndex: 9999 }}
              onClick={(event) => event.stopPropagation()}
            >
              {dropdownContent}
            </div>,
            document.body
          );
        })()}
      </div>
      <div ref={addTriggerRef} className="relative" onClick={(event) => event.stopPropagation()}>
        <IconButton
          onClick={openAddMenu}
          title="Add"
        >
          <PlusIcon className="w-3.5 h-3.5" />
        </IconButton>
        {menuKind === 'add' && !contextMenuPosition ? (() => {
          const pos = getFixedMenuPosition(addTriggerRef, ROOT_ADD_MENU_WIDTH, getAddMenuHeight());
          if (!pos) return null;
          return createPortal(
            <div
              ref={menuRef}
              style={{ position: 'fixed', left: pos.left, top: pos.top, width: ROOT_ADD_MENU_WIDTH, zIndex: 9999 }}
              onClick={(event) => event.stopPropagation()}
            >
              {addMenuContent}
            </div>,
            document.body
          );
        })() : null}
      </div>
      <IconButton
        onClick={(event) => {
          event.stopPropagation();
          setView('search');
          closeMenu();
        }}
        title="Search"
      >
        <SearchIcon className="w-3.5 h-3.5" />
      </IconButton>
    </>
  );

  return (
    <div
      className="sidebar-hover-area flex h-full min-w-0"
      onMouseLeave={() => {
        useFileTreeSelectionStore.getState().clearAllSelections();
      }}
    >
      <div
        className="sidebar-activity-rail flex shrink-0 flex-col items-center"
        style={{ width: SIDEBAR_ACTIVITY_RAIL_WIDTH_PX }}
      >
        <div className="flex shrink-0 flex-col items-center gap-1 pt-2">
          {workspaceActions}
        </div>
        <div className="sidebar-activity-rail-items flex flex-col items-center gap-1">
          {mainRailItems.map((item) => {
            const selected = isMainSidebarRailItemActive(view, item.key);
            const highlighted = isMainSidebarRailItemHighlighted(view, item.key, sidebarPanelOpen);
            const railTitle = !sidebarPanelOpen && selected
              ? `${item.label} — Expand Sidebar`
              : item.label;
            return (
              <IconButton
                key={item.key}
                size={34}
                className={`sidebar-activity-button${highlighted ? ' is-active' : ''}`}
                data-sidebar-rail-item={item.key}
                aria-label={railTitle}
                aria-current={highlighted ? 'page' : undefined}
                title={railTitle}
                onClick={() => handleBuiltinViewClick(item.key)}
              >
                <SidebarRailIcon itemKey={item.key} />
                <SidebarRailAlertBadge count={sidebarRailAlertCount(railAlerts, item.key)} />
                {item.key === 'messenger' && Math.max(pendingRequestCount, unreadMessageCount) > 0 ? (
                  <span className="sidebar-messenger-badge">{formatMessengerPendingBadgeCount(Math.max(pendingRequestCount, unreadMessageCount))}</span>
                ) : null}
              </IconButton>
            );
          })}
          <IconButton size={34} className="sidebar-activity-button" aria-label="Commands" title="Commands" onClick={() => useAppStore.getState().openCommandsTab()}><TerminalIcon className="w-5 h-5" /></IconButton>
          {railPluginLayout.visible.map((pluginView) => (
            <LocalPluginRailButton key={pluginView.key} view={pluginView} group="current" />
          ))}
          {railPluginLayout.folding ? (
            <IconButton
              size={34}
              className={`sidebar-activity-button sidebar-more-toggle${isSidebarMoreRailActive(view, moreMenuOpen) ? ' is-active' : ''}${moreMenuOpen ? ' is-expanded' : ''}`}
              data-sidebar-rail-more
              aria-expanded={moreMenuOpen}
              onClick={(event) => {
                event.stopPropagation();
                setMoreMenuOpen((open) => !open);
              }}
              title={moreMenuOpen ? 'Collapse' : 'Expand'}
              aria-label={moreMenuOpen ? 'Collapse' : 'Expand'}
            >
              <ChevronDownIcon className="w-5 h-5 sidebar-more-chevron" />
            </IconButton>
          ) : null}
          {railPluginLayout.folding && moreMenuOpen
            ? railPluginLayout.overflow.map((pluginView) => (
                <LocalPluginRailButton key={pluginView.key} view={pluginView} group="overflow" />
              ))
            : null}
        </div>
        <div className="sidebar-activity-rail-account mt-auto flex shrink-0 items-center justify-center">
          <TitlebarLogoMenu
            onOpenSettings={onOpenSettings}
            onOpenConfigFiles={onOpenConfigFiles}
          />
        </div>
      </div>

      {sidebarPanelOpen ? (
      <div className="flex min-w-0 flex-1 flex-col">
        {view === 'workspace' && (
          <>
          <div
            className="ui-tabbar sidebar-root-header flex shrink-0 items-center gap-1 overflow-hidden px-2 text-secondary-text"
            title={currentDir || undefined}
            onContextMenu={handleRootAddContextMenu}
          >
            <div className="flex min-w-0 flex-1 items-center">
              <span className="ui-chrome-row-label truncate">{currentDirLabel}</span>
              <button
                type="button"
                className={`${UI_PILL_BTN_PRIMARY} ${OP_SG_CAPSULE} ${OP_SG_ON_SIDEBAR} ${OP_SG_CAPSULE_COMPACT_SHADOW} ${UI_PILL_BTN_COMPACT} ${UI_PILL_BTN_FIT} workspace-root-chat-button ml-2 shrink-0`}
                disabled={!currentDir}
                title={`Chat in ${currentDirLabel}`}
                aria-label={`Open chat in ${currentDirLabel}`}
                onClick={(event) => {
                  event.stopPropagation();
                  openRootChat();
                }}
              >
                Chat
              </button>
            </div>
          </div>
          <div
            role="toolbar"
            aria-label="Workspace actions"
            className="sidebar-workspace-toolbar flex h-8 shrink-0 items-center gap-1 px-2 text-secondary-text"
          >
            {workspaceToolbarActions}
          </div>
          </>
        )}

        {menuKind === 'switch' && contextMenuPosition && !isRemoteWorkspace && createPortal(
          <div
            ref={menuRef}
            className="w-[260px] z-50"
            style={{
              position: 'fixed',
              left: contextMenuPosition.x,
              top: contextMenuPosition.y,
              width: FOLDER_MENU_WIDTH,
              zIndex: 9999,
            }}
          >
            {dropdownContent}
          </div>,
          document.body
        )}

        {menuKind === 'add' && contextMenuPosition && createPortal(
          <div
            ref={menuRef}
            className="z-50"
            style={{
              position: 'fixed',
              left: contextMenuPosition.x,
              top: contextMenuPosition.y,
              width: ROOT_ADD_MENU_WIDTH,
              zIndex: 9999,
            }}
          >
            {addMenuContent}
          </div>,
          document.body
        )}

        <div className="flex-1 overflow-hidden">
          {view.startsWith('plugin:')
            ? <LocalPluginSidebar pluginId={view.slice(7)} />
            : view === 'workspace'
            ? <WorkspaceSidebar />
            : view === 'messenger'
                    ? <MessengerSidebar />
                    : view === 'search'
                      ? <SearchSidebar />
                      : <CronSidebar />}
        </div>
      </div>
      ) : null}
    </div>
  );
}
