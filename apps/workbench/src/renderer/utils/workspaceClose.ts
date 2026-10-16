import type { WorkspaceTab } from '../store/tabManagerStore';

type WorkspacePathAPI = {
  getDefaultDir?: () => Promise<string>;
};

type ReplacementWorkspaceStoreState = {
  connect: () => void;
  setCurrentDir: (dir: string) => void;
  ensureDirectory: (dir: string) => Promise<void>;
};

type ReplacementWorkspaceStore = {
  getState: () => ReplacementWorkspaceStoreState;
};

type CloseWorkspaceTabDeps = {
  workspaceTabs: WorkspaceTab[];
  createWorkspaceTab: (init: { kind: 'local'; workspacePath?: string }) => WorkspaceTab;
  getWorkspaceStore: (tabId: string) => ReplacementWorkspaceStore;
  disconnectRemote: (tabId: string) => Promise<void>;
  setWorkspaceActive: (tabId: string, active: boolean) => void;
  removeWorkspaceStore: (tabId: string) => void;
  closeWorkspaceTab: (tabId: string) => void;
  resolveDefaultLocalWorkspacePath?: () => Promise<string>;
};

function normalizeNonEmptyString(value: string | null | undefined): string | null {
  const trimmed = (value || '').trim();
  return trimmed || null;
}

export async function resolveDefaultLocalWorkspacePath(
  hulala: WorkspacePathAPI | undefined = globalThis.window?.hulala,
): Promise<string> {
  const defaultDir = normalizeNonEmptyString(await hulala?.getDefaultDir?.());
  if (defaultDir) {
    return defaultDir;
  }
  throw new Error('Runtime did not provide a default workspace');
}

export async function closeWorkspaceTabWithDefaultFallback(
  tabId: string,
  deps: CloseWorkspaceTabDeps,
): Promise<void> {
  const shouldReplaceClosingTab = deps.workspaceTabs.length === 1 && deps.workspaceTabs[0]?.id === tabId;

  deps.setWorkspaceActive(tabId, false);

  if (shouldReplaceClosingTab) {
    let nextWorkspacePath: string | undefined;
    try {
      nextWorkspacePath = await (deps.resolveDefaultLocalWorkspacePath
        ? deps.resolveDefaultLocalWorkspacePath()
        : resolveDefaultLocalWorkspacePath());
    } catch {
      nextWorkspacePath = undefined;
    }
    const nextTab = deps.createWorkspaceTab({
      kind: 'local',
      workspacePath: nextWorkspacePath,
    });
    const nextStore = deps.getWorkspaceStore(nextTab.id).getState();
    nextStore.connect();
    if (nextWorkspacePath) {
      nextStore.setCurrentDir(nextWorkspacePath);
    }
  }

  try {
    await deps.disconnectRemote(tabId);
  } catch {
    // Ignore disconnect failures during close so the UI can still recover to a local workspace.
  }

  deps.removeWorkspaceStore(tabId);
  deps.closeWorkspaceTab(tabId);
}
