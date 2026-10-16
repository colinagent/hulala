export type RecentRemoteHost = {
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

export type LocalRecentWorkspace = {
  path: string;
  lastOpenedAt: number;
};

export type RemoteRecentWorkspace = {
  path: string;
  lastOpenedAt: number;
};

export type RemoteRecentWorkspaceBucket = {
  instanceID: string;
  host: RecentRemoteHost;
  label?: string;
  lastOpenedAt: number;
  directories: RemoteRecentWorkspace[];
};

export type RecentWorkspaces = {
  local: LocalRecentWorkspace[];
  remote: Record<string, RemoteRecentWorkspaceBucket>;
};

export type RecordRemoteRecentInput = {
  instanceID: string;
  host: RecentRemoteHost;
  label?: string;
  path?: string;
  lastOpenedAt?: number;
};

const MAX_RECENT = 10;

export function createEmptyRecentWorkspaces(): RecentWorkspaces {
  return {
    local: [],
    remote: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizePath(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const path = value.trim();
  return path ? path : null;
}

function normalizeHost(value: unknown): RecentRemoteHost | null {
  if (!isRecord(value) || typeof value.alias !== 'string' || !value.alias.trim()) {
    return null;
  }
  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id.trim() : undefined,
    alias: value.alias.trim(),
    hostname: typeof value.hostname === 'string' && value.hostname.trim() ? value.hostname.trim() : undefined,
    user: typeof value.user === 'string' && value.user.trim() ? value.user.trim() : undefined,
    port: typeof value.port === 'string' && value.port.trim() ? value.port.trim() : undefined,
    identityFile:
      typeof value.identityFile === 'string' && value.identityFile.trim() ? value.identityFile.trim() : undefined,
    source: typeof value.source === 'string' && value.source.trim() ? value.source.trim() : undefined,
    authMethod:
      value.authMethod === 'agent' || value.authMethod === 'keyFile' || value.authMethod === 'password'
        ? value.authMethod
        : undefined,
    credentialID:
      typeof value.credentialID === 'string' && value.credentialID.trim() ? value.credentialID.trim() : undefined,
    hasPassword: value.hasPassword === true,
    hasPassphrase: value.hasPassphrase === true,
  };
}

function dedupeLocal(entries: LocalRecentWorkspace[]): LocalRecentWorkspace[] {
  const seen = new Set<string>();
  const next: LocalRecentWorkspace[] = [];
  for (const entry of entries) {
    const path = normalizePath(entry.path);
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    next.push({
      path,
      lastOpenedAt: normalizeTimestamp(entry.lastOpenedAt),
    });
    if (next.length >= MAX_RECENT) {
      break;
    }
  }
  return next;
}

function dedupeRemoteDirectories(entries: RemoteRecentWorkspace[]): RemoteRecentWorkspace[] {
  const seen = new Set<string>();
  const next: RemoteRecentWorkspace[] = [];
  for (const entry of entries) {
    const path = normalizePath(entry.path);
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    next.push({
      path,
      lastOpenedAt: normalizeTimestamp(entry.lastOpenedAt),
    });
    if (next.length >= MAX_RECENT) {
      break;
    }
  }
  return next;
}

export function normalizeRecentWorkspaces(value: unknown): RecentWorkspaces {
  if (!isRecord(value)) {
    return createEmptyRecentWorkspaces();
  }

  const local = Array.isArray(value.local)
    ? dedupeLocal(
        value.local
          .filter(isRecord)
          .map((entry) => ({
            path: typeof entry.path === 'string' ? entry.path : '',
            lastOpenedAt: normalizeTimestamp(entry.lastOpenedAt),
          }))
      )
    : [];

  const remoteSource = isRecord(value.remote) ? value.remote : {};
  const remote = Object.entries(remoteSource).reduce<Record<string, RemoteRecentWorkspaceBucket>>((acc, [key, raw]) => {
    if (!isRecord(raw)) {
      return acc;
    }
    const instanceID = normalizePath(raw.instanceID) || key.trim();
    const host = normalizeHost(raw.host);
    if (!instanceID || !host) {
      return acc;
    }
    const directories = Array.isArray(raw.directories)
      ? dedupeRemoteDirectories(
          raw.directories
            .filter(isRecord)
            .map((entry) => ({
              path: typeof entry.path === 'string' ? entry.path : '',
              lastOpenedAt: normalizeTimestamp(entry.lastOpenedAt),
            }))
        )
      : [];
    acc[instanceID] = {
      instanceID,
      host,
      label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : undefined,
      lastOpenedAt: normalizeTimestamp(raw.lastOpenedAt),
      directories,
    };
    return acc;
  }, {});

  return { local, remote };
}

export function upsertLocalRecent(recent: RecentWorkspaces, entry: LocalRecentWorkspace): RecentWorkspaces {
  const path = normalizePath(entry.path);
  if (!path) {
    return recent;
  }
  return {
    local: dedupeLocal([{ path, lastOpenedAt: normalizeTimestamp(entry.lastOpenedAt) }, ...recent.local]),
    remote: recent.remote,
  };
}

export function upsertRemoteRecent(recent: RecentWorkspaces, entry: RecordRemoteRecentInput): RecentWorkspaces {
  const instanceID = normalizePath(entry.instanceID);
  if (!instanceID) {
    return recent;
  }

  const currentBucket = recent.remote[instanceID];
  const nextBucket: RemoteRecentWorkspaceBucket = {
    instanceID,
    host: entry.host,
    label: entry.label,
    lastOpenedAt: normalizeTimestamp(entry.lastOpenedAt),
    directories: currentBucket?.directories || [],
  };

  const path = normalizePath(entry.path);
  if (path) {
    nextBucket.directories = dedupeRemoteDirectories([
      { path, lastOpenedAt: normalizeTimestamp(entry.lastOpenedAt) },
      ...nextBucket.directories,
    ]);
  }

  return {
    local: recent.local,
    remote: {
      ...recent.remote,
      [instanceID]: nextBucket,
    },
  };
}

export function getSortedRemoteBuckets(recent: RecentWorkspaces): RemoteRecentWorkspaceBucket[] {
  return Object.values(recent.remote).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export function getRemoteBucketByInstanceID(
  recent: RecentWorkspaces,
  instanceID: string | null | undefined
): RemoteRecentWorkspaceBucket | null {
  const key = typeof instanceID === 'string' ? instanceID.trim() : '';
  if (!key) {
    return null;
  }
  return recent.remote[key] || null;
}
