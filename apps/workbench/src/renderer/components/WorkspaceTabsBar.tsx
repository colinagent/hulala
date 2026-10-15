import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import {
  CloseButton,
  FolderIcon,
  PlusIcon,
  RemoteIcon,
  SidebarPanelToggleIcon,
} from './Icons';
import { IconButton } from './IconButton';
import { PopupMenu, PopupMenuItem } from './PopupMenu';
import { useDismissOnOutsideInteraction } from '../hooks/useDismissOnOutsideInteraction';
import {
  TAB_CLOSE_BUTTON_DELAYED_REVEAL_CLASS,
  WORKSPACE_TAB_ITEM_FLEX_STYLE,
  getTabCloseButtonClassName,
} from './tabLayout';
import {
  OP_SG_CAPSULE,
  OP_SG_CAPSULE_COMPACT_SHADOW,
  OP_SG_ON_TITLEBAR,
} from './staticGlassCapsule';
import { getWorkspaceStore } from '../store/appStore';
import { resolveHostLabel, type SshHost, type WorkspaceTab } from '../store/tabManagerStore';
import { CompressibleTabStrip } from './CompressibleTabStrip';
import {
  getSortedRemoteBuckets,
  useRecentWorkspacesStore,
  type LocalRecentWorkspace,
  type RemoteRecentWorkspaceBucket,
} from '../store/recentWorkspacesStore';

function normalizeWorkspacePath(path: string | undefined): string {
  const normalized = (path || '').trim().replace(/\\/g, '/');
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

function getPathBaseName(path: string | undefined): string {
  const normalized = normalizeWorkspacePath(path);
  if (!normalized) {
    return '';
  }
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}

function shouldRegenerateWorkspaceTabLabel(label: string | undefined): boolean {
  return !label || label === 'Untitled';
}

function useTabDisplayState(tab: WorkspaceTab): { label: string; workspacePath?: string } {
  const store = getWorkspaceStore(tab.id);
  const currentDir = useStore(store, (s) => s.currentDir);
  const remoteHostLabel = useStore(store, (s) => s.remoteSession?.hostLabel ?? null);

  if (tab.kind === 'remote') {
    return {
      label: remoteHostLabel ?? tab.label,
      workspacePath: tab.workspacePath,
    };
  }

  const workspacePath = tab.workspacePath || currentDir || undefined;
  const label = shouldRegenerateWorkspaceTabLabel(tab.label)
    ? getPathBaseName(workspacePath) || tab.label || 'Untitled'
    : tab.label;
  return { label, workspacePath };
}

function WorkspaceTabRow({
  tab,
  isActive,
  shortcut,
  onSelect,
  onClose,
}: {
  tab: WorkspaceTab;
  isActive: boolean;
  shortcut: { label: string; aria: string } | null;
  onSelect: () => void;
  onClose: () => void;
}) {
  const { label } = useTabDisplayState(tab);
  return (
    <div
      className={`workspace-tab-shell no-drag group relative flex items-center gap-1 px-2.5 text-secondary-text ${
        isActive ? `is-active ${OP_SG_CAPSULE} ${OP_SG_ON_TITLEBAR} ${OP_SG_CAPSULE_COMPACT_SHADOW}` : ''
      }`}
      style={WORKSPACE_TAB_ITEM_FLEX_STYLE}
      data-tab-strip-active={isActive ? 'true' : 'false'}
    >
      <button
        type="button"
        className="workspace-tab-label no-drag flex h-full min-w-0 flex-1 items-center gap-1.5"
        onClick={onSelect}
        title={shortcut ? `${label} (${shortcut.label})` : label}
        aria-keyshortcuts={shortcut?.aria}
      >
        <span className="min-w-0 truncate">{label}</span>
        {shortcut ? (
          <span className="shrink-0 text-[11px] text-secondary-text opacity-70" aria-hidden="true">
            {shortcut.label}
          </span>
        ) : null}
      </button>
      <CloseButton
        className={getTabCloseButtonClassName(
          'bg-secondary-bg',
          `${TAB_CLOSE_BUTTON_DELAYED_REVEAL_CLASS} no-drag`,
        )}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        title="Close tab"
        variant="inline"
      />
    </div>
  );
}

function getLocalWorkspaceLabel(entry: LocalRecentWorkspace): string {
  return getPathBaseName(entry.path);
}

type WorkspaceTabsBarProps = {
  tabs: WorkspaceTab[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCreateWorkspace: () => void;
  onNewFolder: () => void;
  onNewRemote: () => void;
  onOpenRecentLocal: (path: string) => Promise<void>;
  onOpenRecentRemote: (host: SshHost, path?: string) => Promise<void>;
  rightPaneOpen: boolean;
  onToggleRightPane: () => void;
};

const HOVER_LEAVE_MS = 120;
const MAIN_MENU_WIDTH = 220;
const RECENT_PANEL_WIDTH = 300;
const MENU_PANEL_GAP = 4;
const RECENT_LIST_MAX_H = 320;

function RemoteRecentGroup({
  group,
  onSelect,
}: {
  group: RemoteRecentWorkspaceBucket;
  onSelect: (host: SshHost, path?: string) => void;
}) {
  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-prime-text hover:bg-hover-bg"
        onClick={() => onSelect(group.host)}
      >
        <RemoteIcon className="w-4 h-4 opacity-70 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm truncate">{group.label || resolveHostLabel(group.host)}</div>
          <div className="text-xs text-secondary-text truncate opacity-70">{resolveHostLabel(group.host)}</div>
        </div>
      </button>
      {group.directories.map((entry) => (
        <button
          key={`${group.instanceID}-${entry.path}`}
          type="button"
          className="flex w-full items-center gap-2 pl-8 pr-2 py-1.5 text-left text-secondary-text hover:bg-hover-bg hover:text-prime-text"
          onClick={() => onSelect(group.host, entry.path)}
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm truncate">{getPathBaseName(entry.path)}</div>
            <div className="text-xs truncate opacity-70">{entry.path}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

export const WorkspaceTabsBar: React.FC<WorkspaceTabsBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onCreateWorkspace,
  onNewFolder,
  onNewRemote,
  onOpenRecentLocal,
  onOpenRecentRemote,
  rightPaneOpen,
  onToggleRightPane,
}) => {
  const { t } = useTranslation('menu');
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuOpensLeft, setMenuOpensLeft] = useState(false);
  const [submenuType, setSubmenuType] = useState<'folder' | 'remote' | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const hoverLeaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recent = useRecentWorkspacesStore((s) => s.recent);
  const loadRecent = useRecentWorkspacesStore((s) => s.load);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  const recentLocal = useMemo(() => recent.local, [recent.local]);
  const recentRemoteGroups = useMemo(() => getSortedRemoteBuckets(recent), [recent]);

  useEffect(() => {
    if (!menuOpen) {
      setSubmenuType(null);
      if (hoverLeaveRef.current) {
        clearTimeout(hoverLeaveRef.current);
        hoverLeaveRef.current = null;
      }
    }
  }, [menuOpen]);

  const clearHoverTimers = useCallback(() => {
    if (hoverLeaveRef.current) {
      clearTimeout(hoverLeaveRef.current);
      hoverLeaveRef.current = null;
    }
  }, []);

  const closeMenu = useCallback(() => {
    clearHoverTimers();
    setSubmenuType(null);
    setMenuOpen(false);
  }, [clearHoverTimers]);

  useDismissOnOutsideInteraction({
    active: menuOpen,
    onDismiss: closeMenu,
    insideRefs: [menuRef],
  });

  const handleRecentLocalClick = async (path: string) => {
    await onOpenRecentLocal(path);
    setMenuOpen(false);
  };

  const handleRecentRemoteClick = async (host: SshHost, path?: string) => {
    await onOpenRecentRemote(host, path);
    setMenuOpen(false);
  };

  const handleToggleNewTabMenu = () => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const actionRect = menuRef.current?.getBoundingClientRect();
    if (actionRect) {
      const totalMenuWidth = MAIN_MENU_WIDTH + MENU_PANEL_GAP + RECENT_PANEL_WIDTH;
      setMenuOpensLeft(actionRect.left + totalMenuWidth > window.innerWidth - 8);
    }
    setMenuOpen(true);
  };

  const newTabAction = (
    <div ref={menuRef}>
        <IconButton
          size={24}
          className={`no-drag text-xl ${menuOpen ? 'bg-hover-bg text-brand' : 'text-secondary-text'}`}
          onClick={handleToggleNewTabMenu}
          title={t('workspaceTab.newTab')}
          aria-label={t('workspaceTab.newTab')}
        >
          +
        </IconButton>
        {menuOpen && (
          <PopupMenu
            substrate="titlebar"
            className={`absolute top-full mt-1 w-[220px] text-secondary-text no-drag z-50 ${menuOpensLeft ? 'right-0' : 'left-0'}`}
          >
            <div>
              <PopupMenuItem
                onClick={() => {
                  onCreateWorkspace();
                  setMenuOpen(false);
                }}
              >
                <PlusIcon className="w-4 h-4 opacity-70" />
                <span>{t('workspaceTab.createWorkspace')}</span>
              </PopupMenuItem>
              <div
                className="relative"
                onMouseEnter={() => {
                  clearHoverTimers();
                  setSubmenuType('folder');
                }}
                onMouseLeave={() => {
                  clearHoverTimers();
                  hoverLeaveRef.current = setTimeout(() => {
                    setSubmenuType((current) => (current === 'folder' ? null : current));
                  }, HOVER_LEAVE_MS);
                }}
              >
                <PopupMenuItem
                  onClick={() => {
                    onNewFolder();
                    setMenuOpen(false);
                  }}
                >
                  <FolderIcon className="w-4 h-4 opacity-70" />
                  <span>{t('workspaceTab.openFolder')}</span>
                </PopupMenuItem>
                {submenuType === 'folder' && (
                  <PopupMenu
                    substrate="titlebar"
                    className={`absolute top-0 z-[51] ${
                      menuOpensLeft ? 'right-full mr-1' : 'left-full ml-1'
                    }`}
                    style={{ width: RECENT_PANEL_WIDTH }}
                    onMouseEnter={clearHoverTimers}
                    onMouseLeave={() => {
                      hoverLeaveRef.current = setTimeout(() => setSubmenuType(null), HOVER_LEAVE_MS);
                    }}
                  >
                    <div className="px-2 py-1.5 border-b border-border text-xs uppercase tracking-wider text-secondary-text mb-1">
                      Recent
                    </div>
                    {recentLocal.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-secondary-text">No recent folders</div>
                    ) : (
                      <div className="overflow-auto" style={{ maxHeight: RECENT_LIST_MAX_H }}>
                        {recentLocal.map((entry) => (
                          <PopupMenuItem
                            key={entry.path}
                            className="group"
                            onClick={() => handleRecentLocalClick(entry.path)}
                          >
                            <FolderIcon className="w-4 h-4 opacity-70 flex-shrink-0" />
                            <div className="flex flex-col min-w-0 flex-1">
                              <div className="text-sm truncate">{getLocalWorkspaceLabel(entry)}</div>
                              <div className="text-xs text-secondary-text group-hover:text-prime-text truncate opacity-70">
                                {entry.path}
                              </div>
                            </div>
                          </PopupMenuItem>
                        ))}
                      </div>
                    )}
                  </PopupMenu>
                )}
              </div>
              <div
                className="relative"
                onMouseEnter={() => {
                  clearHoverTimers();
                  setSubmenuType('remote');
                }}
                onMouseLeave={() => {
                  clearHoverTimers();
                  hoverLeaveRef.current = setTimeout(() => {
                    setSubmenuType((current) => (current === 'remote' ? null : current));
                  }, HOVER_LEAVE_MS);
                }}
              >
                <PopupMenuItem
                  onClick={() => {
                    onNewRemote();
                    setMenuOpen(false);
                  }}
                >
                  <RemoteIcon className="w-4 h-4 opacity-70" />
                  <span>{t('workspaceTab.connectRemote')}</span>
                </PopupMenuItem>
                {submenuType === 'remote' && (
                  <PopupMenu
                    substrate="titlebar"
                    className={`absolute top-0 z-[51] ${
                      menuOpensLeft ? 'right-full mr-1' : 'left-full ml-1'
                    }`}
                    style={{ width: RECENT_PANEL_WIDTH }}
                    onMouseEnter={clearHoverTimers}
                    onMouseLeave={() => {
                      hoverLeaveRef.current = setTimeout(() => setSubmenuType(null), HOVER_LEAVE_MS);
                    }}
                  >
                    <div className="px-2 py-1.5 border-b border-border text-xs uppercase tracking-wider text-secondary-text mb-1">
                      Recent
                    </div>
                    {recentRemoteGroups.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-secondary-text">No recent remotes</div>
                    ) : (
                      <div className="overflow-auto" style={{ maxHeight: RECENT_LIST_MAX_H }}>
                        {recentRemoteGroups.map((group) => (
                          <RemoteRecentGroup
                            key={group.instanceID}
                            group={group}
                            onSelect={handleRecentRemoteClick}
                          />
                        ))}
                      </div>
                    )}
                  </PopupMenu>
                )}
              </div>
            </div>
          </PopupMenu>
        )}
    </div>
  );

  return (
    <div className="flex h-full w-full min-w-0 items-center">
      <div className="h-full min-w-0 flex-1">
        <div className="flex h-full items-center gap-2 px-3">
          <span data-testid="workspace-name" className="min-w-0 flex-1 truncate" style={{ color: 'var(--color-highlight)' }}>
            {tabs.find(tab => tab.id === activeTabId)?.label || 'Workspace'}
          </span>
          {newTabAction}
        </div>
      </div>
      <div className="flex h-full shrink-0 items-center pr-3">
        <IconButton
          size={28}
          className={`workspace-right-pane-toggle no-drag ${rightPaneOpen ? 'is-active' : ''}`}
          onClick={onToggleRightPane}
          title={t(rightPaneOpen ? 'workspaceTab.hideRightWorkspace' : 'workspaceTab.showRightWorkspace')}
          aria-label={t(rightPaneOpen ? 'workspaceTab.hideRightWorkspace' : 'workspaceTab.showRightWorkspace')}
          aria-pressed={rightPaneOpen}
        >
          <SidebarPanelToggleIcon className="h-[18px] w-[18px]" />
        </IconButton>
      </div>
    </div>
  );
};
