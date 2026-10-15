import { create } from 'zustand';

export const WORKSPACE_TABS_SESSION_VERSION = 4;

export type WorkspaceTabKind = 'local' | 'remote';

export type SshHost = {
  id?: string;
  alias: string;
  hostname?: string;
  user?: string;
  port?: string;
  identityFile?: string;
  source?: string;
  authMethod?: 'agent' | 'keyFile' | 'password';
  credentialID?: string;
  hasPassword?: boolean;
  hasPassphrase?: boolean;
};

export type WorkspaceTab = {
  id: string;
  label: string;
  kind: WorkspaceTabKind;
  workspaceId: string;
  workspacePath?: string;
  remoteHost?: SshHost;
  activeSessionId?: string;
  openSessionIds?: string[];
};

export type WorkspaceTabSession = {
  id: string;
  label: string;
  kind: WorkspaceTabKind;
  workspaceId: string;
  workspacePath?: string;
  remoteHost?: SshHost;
  currentDir?: string;
  openEditorFilePaths?: string[];
  openEditors?: Array<{ path: string; pane?: 'main' | 'right'; active?: boolean }>;
  openTools?: Array<{ editorId: string; title?: string; active?: boolean }>;
  activeSessionId?: string;
  openSessionIds?: string[];
};

export type WorkspaceTabsSessionState = {
  version: number;
  activeTabId: string;
  tabs: WorkspaceTabSession[];
};

type WorkspaceTabInit = {
  id?: string;
  kind: WorkspaceTabKind;
  workspacePath?: string;
  remoteHost?: SshHost;
  label?: string;
  workspaceId?: string;
};

type TabManagerState = {
  tabs: WorkspaceTab[];
  activeTabId: string;
  createTab: (init: WorkspaceTabInit) => WorkspaceTab;
  setActiveTab: (tabId: string) => void;
  updateTabWorkspace: (tabId: string, init: WorkspaceTabInit) => void;
  updateActiveTabWorkspace: (init: WorkspaceTabInit) => void;
  closeTab: (tabId: string) => void;
  updateTabConversation: (tabId: string, activeSessionId: string | undefined, openSessionIds: string[]) => void;
  replaceSession: (session: WorkspaceTabsSessionState) => void;
  getSessionSnapshot: (resolveCurrentDir?: (tabId: string) => string | null | undefined) => WorkspaceTabsSessionState;
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function resolveHostLabel(host?: SshHost): string {
  if (!host) {
    return 'remote';
  }
  if (host.user && host.hostname) {
    return `${host.user}@${host.hostname}`;
  }
  if (host.hostname) {
    return host.hostname;
  }
  return host.alias;
}

function resolveWorkspaceId(kind: WorkspaceTabKind, workspacePath?: string, remoteHost?: SshHost): string {
  if (kind === 'remote') {
    const remoteIdentity = remoteHost?.id
      ? `${remoteHost.source || 'remote'}:${remoteHost.id}`
      : resolveHostLabel(remoteHost);
    return hashString(`remote:${remoteIdentity}`);
  }
  if (workspacePath) {
    return hashString(`local:${workspacePath}`);
  }
  return hashString(`local:empty:${Date.now()}`);
}

function resolveTabLabel(kind: WorkspaceTabKind, workspacePath?: string, remoteHost?: SshHost): string {
  if (kind === 'remote') {
    return resolveHostLabel(remoteHost);
  }
  if (workspacePath) {
    const normalized = workspacePath.trim().replace(/\\/g, '/');
    const withoutTrailingSlash = normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
    const parts = withoutTrailingSlash.split('/');
    return parts[parts.length - 1] || 'Untitled';
  }
  return 'Untitled';
}

function shouldRegenerateLabel(label: string | undefined): boolean {
  return !label || label === 'Untitled';
}

function normalizedWorkspacePath(path: string | undefined): string {
  const normalized = (path || '').trim().replace(/\\/g, '/');
  const withoutTrailingSlash = normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
  return /^[A-Za-z]:\//.test(withoutTrailingSlash) ? withoutTrailingSlash.toLowerCase() : withoutTrailingSlash;
}

function conversationWorkspaceIdentity(kind: WorkspaceTabKind, workspacePath?: string, remoteHost?: SshHost): string {
  const remoteIdentity = kind === 'remote'
    ? [remoteHost?.source, remoteHost?.id, remoteHost?.alias, remoteHost?.user, remoteHost?.hostname, remoteHost?.port]
      .map((value) => value || '')
      .join('\u0000')
    : '';
  return `${kind}\u0000${remoteIdentity}\u0000${normalizedWorkspacePath(workspacePath)}`;
}

function buildTab(init: WorkspaceTabInit): WorkspaceTab {
  const kind = init.kind;
  return {
    id: init.id || createId('tab'),
    kind,
    workspacePath: init.workspacePath,
    remoteHost: init.remoteHost,
    label: init.label || resolveTabLabel(kind, init.workspacePath, init.remoteHost),
    workspaceId: init.workspaceId || resolveWorkspaceId(kind, init.workspacePath, init.remoteHost),
  };
}

function createDefaultTab(): WorkspaceTab {
  return buildTab({ kind: 'local' });
}

function normalizeSession(session: WorkspaceTabsSessionState | null | undefined): WorkspaceTabsSessionState {
  const fallback = createDefaultTab();
  if (!session || !Array.isArray(session.tabs)) {
    return {
      version: WORKSPACE_TABS_SESSION_VERSION,
      activeTabId: fallback.id,
      tabs: [fallback],
    };
  }

  const seen = new Set<string>();
  const tabs = session.tabs.reduce<WorkspaceTab[]>((acc, raw) => {
    const id = typeof raw?.id === 'string' ? raw.id.trim() : '';
    if (!id || seen.has(id)) {
      return acc;
    }
    const kind = raw?.kind === 'remote' ? 'remote' : 'local';
    const workspacePath = typeof raw?.workspacePath === 'string' && raw.workspacePath.trim()
      ? raw.workspacePath.trim()
      : undefined;
    const remoteHost = raw?.remoteHost;
    const rawLabel = typeof raw?.label === 'string' && raw.label.trim() ? raw.label.trim() : undefined;
    const label = shouldRegenerateLabel(rawLabel) ? undefined : rawLabel;
    const workspaceId = typeof raw?.workspaceId === 'string' && raw.workspaceId.trim() ? raw.workspaceId.trim() : undefined;
    const activeSessionId = typeof raw?.activeSessionId === 'string' && raw.activeSessionId.trim()
      ? raw.activeSessionId.trim()
      : undefined;
    const openSessionIds = Array.isArray(raw?.openSessionIds)
      ? Array.from(new Set(raw.openSessionIds.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map(value => value.trim())))
      : undefined;
    const tab = buildTab({
      id,
      kind,
      workspacePath,
      remoteHost,
      label,
      workspaceId,
    });
    tab.activeSessionId = activeSessionId;
    tab.openSessionIds = openSessionIds;
    seen.add(tab.id);
    acc.push(tab);
    return acc;
  }, []);

  if (tabs.length === 0) {
    return {
      version: WORKSPACE_TABS_SESSION_VERSION,
      activeTabId: fallback.id,
      tabs: [fallback],
    };
  }

  const activeTabId = tabs.some((tab) => tab.id === session.activeTabId)
    ? session.activeTabId
    : tabs[0].id;

  return {
    version: WORKSPACE_TABS_SESSION_VERSION,
    activeTabId,
    tabs: tabs.map((tab) => ({ ...tab })),
  };
}

const initialTab = createDefaultTab();

export const useTabManagerStore = create<TabManagerState>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,
  createTab: (init) => {
    const tab = buildTab(init);
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
    }));
    return tab;
  },
  setActiveTab: (tabId) => {
    set((state) => {
      if (state.activeTabId === tabId) {
        return state;
      }
      if (!state.tabs.some((tab) => tab.id === tabId)) {
        return state;
      }
      return { ...state, activeTabId: tabId };
    });
  },
  updateTabWorkspace: (tabId, init) => {
    set((state) => {
      const nextTabs = state.tabs.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }
        const kind = init.kind ?? tab.kind;
        const workspacePath = init.workspacePath ?? tab.workspacePath;
        const remoteHost = init.remoteHost ?? tab.remoteHost;
        const workspaceChanged = conversationWorkspaceIdentity(tab.kind, tab.workspacePath, tab.remoteHost)
          !== conversationWorkspaceIdentity(kind, workspacePath, remoteHost);
        return {
          ...tab,
          kind,
          workspacePath,
          remoteHost,
          label: init.label || resolveTabLabel(kind, workspacePath, remoteHost),
          workspaceId: init.workspaceId || resolveWorkspaceId(kind, workspacePath, remoteHost),
          ...(workspaceChanged ? { activeSessionId: undefined, openSessionIds: [] } : {}),
        };
      });
      return { ...state, tabs: nextTabs };
    });
  },
  updateActiveTabWorkspace: (init) => {
    const activeTabId = get().activeTabId;
    get().updateTabWorkspace(activeTabId, init);
  },
  closeTab: (tabId) => {
    set((state) => {
      const nextTabs = state.tabs.filter((tab) => tab.id !== tabId);
      if (nextTabs.length === 0) {
        const fallback = createDefaultTab();
        return { ...state, tabs: [fallback], activeTabId: fallback.id };
      }
      const nextActiveTabId =
        state.activeTabId === tabId ? nextTabs[0]?.id || state.activeTabId : state.activeTabId;
      return { ...state, tabs: nextTabs, activeTabId: nextActiveTabId };
    });
  },
  updateTabConversation: (tabId, activeSessionId, openSessionIds) => {
    set((state) => {
      const normalized = Array.from(new Set(openSessionIds.filter(Boolean)));
      let changed = false;
      const tabs = state.tabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        const same = tab.activeSessionId === activeSessionId
          && (tab.openSessionIds?.length ?? 0) === normalized.length
          && normalized.every((id, index) => tab.openSessionIds?.[index] === id);
        if (same) return tab;
        changed = true;
        return {
          ...tab,
          ...(activeSessionId ? { activeSessionId } : { activeSessionId: undefined }),
          openSessionIds: normalized,
        };
      });
      return changed ? { ...state, tabs } : state;
    });
  },
  replaceSession: (session) => {
    const normalized = normalizeSession(session);
    set({
      tabs: normalized.tabs,
      activeTabId: normalized.activeTabId,
    });
  },
  getSessionSnapshot: (resolveCurrentDir) => {
    const state = get();
    return {
      version: WORKSPACE_TABS_SESSION_VERSION,
      activeTabId: state.tabs.some((tab) => tab.id === state.activeTabId)
        ? state.activeTabId
        : state.tabs[0]?.id || '',
      tabs: state.tabs.map((tab) => {
        const currentDir = resolveCurrentDir?.(tab.id);
        const workspacePath = tab.workspacePath || (tab.kind === 'local' ? currentDir || undefined : undefined);
        const label = shouldRegenerateLabel(tab.label)
          ? resolveTabLabel(tab.kind, workspacePath, tab.remoteHost)
          : tab.label;
        return {
          ...tab,
          label,
          workspacePath,
          currentDir: currentDir || undefined,
        };
      }),
    };
  },
}));
