import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import {
  FolderIcon,
  PlusIcon,
  RemoteIcon,
  SidebarPanelToggleIcon,
} from './Icons';
import { IconButton } from './IconButton';
import { PopupMenu, PopupMenuItem } from './PopupMenu';
import { useDismissOnOutsideInteraction } from '../hooks/useDismissOnOutsideInteraction';
import { resolveHostLabel, type SshHost } from '../store/tabManagerStore';
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

function getLocalWorkspaceLabel(entry: LocalRecentWorkspace): string {
  return getPathBaseName(entry.path);
}

type WorkspaceActionsProps = {
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

export const WorkspaceActions: React.FC<WorkspaceActionsProps> = ({
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
  const [menuPosition, setMenuPosition] = useState({ left: 50, top: 8 });
  const [submenuType, setSubmenuType] = useState<'folder' | 'remote' | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
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
    insideRefs: [menuRef, triggerRef],
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
    const actionRect = triggerRef.current?.getBoundingClientRect();
    if (actionRect) {
      setMenuPosition({ left: actionRect.right + 6, top: actionRect.top });
    }
    setMenuOpen(true);
  };

  const newTabAction = (
    <>
        <IconButton
          ref={triggerRef}
          size={34}
          className={`sidebar-activity-button${menuOpen ? ' is-active' : ''}`}
          onClick={handleToggleNewTabMenu}
          title={t('workspaceTab.newTab')}
          aria-label={t('workspaceTab.newTab')}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <PlusIcon className="h-5 w-5" />
        </IconButton>
        {menuOpen && createPortal(
          <div ref={menuRef} className="fixed z-50" style={menuPosition}>
          <PopupMenu
            substrate="sidebar"
            className="text-secondary-text"
            style={{ width: MAIN_MENU_WIDTH }}
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
                    substrate="sidebar"
                    className="absolute top-0 left-full ml-1 z-[51]"
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
                    substrate="sidebar"
                    className="absolute top-0 left-full ml-1 z-[51]"
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
          </div>,
          document.body,
        )}
    </>
  );

  return (
    <>
      {newTabAction}
        <IconButton
          size={34}
          className={`sidebar-activity-button${rightPaneOpen ? ' is-active' : ''}`}
          onClick={onToggleRightPane}
          title={t(rightPaneOpen ? 'workspaceTab.hideRightWorkspace' : 'workspaceTab.showRightWorkspace')}
          aria-label={t(rightPaneOpen ? 'workspaceTab.hideRightWorkspace' : 'workspaceTab.showRightWorkspace')}
          aria-pressed={rightPaneOpen}
        >
          <SidebarPanelToggleIcon className="h-5 w-5" />
        </IconButton>
    </>
  );
};
