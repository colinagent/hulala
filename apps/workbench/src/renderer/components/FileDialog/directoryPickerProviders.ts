import type { RemoteSessionInfo } from '../../store/appStore';
import type { DirectoryPickerQuickAccessItem } from './DirectoryPickerDialog';
import type { DirectoryPickerProvider } from './DirectoryPickerDialog';
import { directoryPickerPathsEqual, normalizeDirectoryPickerPath } from './directoryPickerModel';

function dedupeQuickAccess(items: DirectoryPickerQuickAccessItem[]): DirectoryPickerQuickAccessItem[] {
  const result: DirectoryPickerQuickAccessItem[] = [];
  for (const item of items) {
    const path = normalizeDirectoryPickerPath(item.path);
    if (!path) {
      continue;
    }
    if (result.some((candidate) => directoryPickerPathsEqual(candidate.path, path))) {
      continue;
    }
    result.push({ ...item, path });
  }
  return result;
}

export function createLocalDirectoryPickerProvider(): DirectoryPickerProvider | null {
  const api = window.hulala?.localDirectoryPicker;
  if (!api) {
    return null;
  }

  return {
    kind: 'local',
    listDirectory: (path) => api.listDirectory(path),
    statPath: (path) => api.statPath(path),
    getQuickAccess: async () => dedupeQuickAccess(await api.getSpecialDirectories()),
    mkdir: api.mkdir,
    writeFile: api.writeFile,
  };
}

export function createRemoteDirectoryPickerProvider(input: {
  remoteSession: RemoteSessionInfo | null | undefined;
  listDirectory: DirectoryPickerProvider['listDirectory'];
  statPath: DirectoryPickerProvider['statPath'];
  mkdir?: (path: string) => Promise<{ success?: boolean; error?: string }>;
  writeFile?: (path: string, content: string) => Promise<{ error?: string }>;
}): DirectoryPickerProvider {
  return {
    kind: 'remote',
    listDirectory: input.listDirectory,
    statPath: input.statPath,
    mkdir: input.mkdir,
    writeFile: input.writeFile,
    getQuickAccess: async () => dedupeQuickAccess([
      input.remoteSession?.workspaceDir
        ? { key: 'workspace', label: 'Workspace', path: input.remoteSession.workspaceDir }
        : null,
    ].filter((item): item is DirectoryPickerQuickAccessItem => Boolean(item))),
  };
}
