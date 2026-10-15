import { create } from 'zustand';
import {
  createEmptyRecentWorkspaces,
  normalizeRecentWorkspaces,
  type LocalRecentWorkspace,
  type RecentWorkspaces,
  type RecordRemoteRecentInput,
  type RemoteRecentWorkspaceBucket,
} from '../types/recentWorkspaces';

type RecordLocalRecentInput = {
  path: string;
  lastOpenedAt?: number;
};

type RecentWorkspacesState = {
  recent: RecentWorkspaces;
  loaded: boolean;
  load: () => Promise<void>;
  recordLocal: (entry: RecordLocalRecentInput) => Promise<void>;
  recordRemote: (entry: RecordRemoteRecentInput) => Promise<void>;
};

function upsertLocalEntry(list: LocalRecentWorkspace[], entry: LocalRecentWorkspace): LocalRecentWorkspace[] {
  const next = [entry, ...list.filter((item) => item.path !== entry.path)];
  return next.slice(0, 10);
}

function upsertRemoteBucket(recent: RecentWorkspaces, entry: RecordRemoteRecentInput): RecentWorkspaces {
  const currentBucket = recent.remote[entry.instanceID];
  const lastOpenedAt = entry.lastOpenedAt ?? Date.now();
  const directories = entry.path
    ? [{ path: entry.path, lastOpenedAt }, ...(currentBucket?.directories || [])]
        .filter((item, index, list) => list.findIndex((candidate) => candidate.path === item.path) === index)
        .slice(0, 10)
    : currentBucket?.directories || [];

  return {
    local: recent.local,
    remote: {
      ...recent.remote,
      [entry.instanceID]: {
        instanceID: entry.instanceID,
        host: entry.host,
        label: entry.label,
        lastOpenedAt,
        directories,
      },
    },
  };
}

function getSettingsRecent(settings: { user?: { recentWorkspaces?: unknown } } | null | undefined): RecentWorkspaces {
  return normalizeRecentWorkspaces(settings?.user?.recentWorkspaces);
}

async function persistRecent(recent: RecentWorkspaces) {
  if (!window.hulala?.settings?.set) {
    return;
  }
  await window.hulala.settings.set({
    user: {
      recentWorkspaces: recent,
    },
  });
}

export { getRemoteBucketByInstanceID, getSortedRemoteBuckets } from '../types/recentWorkspaces';
export type { LocalRecentWorkspace, RecentWorkspaces, RecordRemoteRecentInput, RemoteRecentWorkspaceBucket };

export const useRecentWorkspacesStore = create<RecentWorkspacesState>((set, get) => ({
  recent: createEmptyRecentWorkspaces(),
  loaded: false,
  load: async () => {
    if (!window.hulala?.settings?.get) {
      return;
    }
    const settings = await window.hulala.settings.get();
    set({ recent: getSettingsRecent(settings), loaded: true });
  },
  recordLocal: async ({ path, lastOpenedAt }) => {
    let current = get().recent;
    if (!get().loaded && window.hulala?.settings?.get) {
      const settings = await window.hulala.settings.get();
      current = getSettingsRecent(settings);
    }
    const next = {
      local: upsertLocalEntry(current.local, { path, lastOpenedAt: lastOpenedAt ?? Date.now() }),
      remote: current.remote,
    };
    set({ recent: next, loaded: true });
    await persistRecent(next);
  },
  recordRemote: async (entry) => {
    let current = get().recent;
    if (!get().loaded && window.hulala?.settings?.get) {
      const settings = await window.hulala.settings.get();
      current = getSettingsRecent(settings);
    }
    const next = upsertRemoteBucket(current, {
      ...entry,
      lastOpenedAt: entry.lastOpenedAt ?? Date.now(),
    });
    set({ recent: next, loaded: true });
    await persistRecent(next);
  },
}));
