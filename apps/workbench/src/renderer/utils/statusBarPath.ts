export type StatusBarPathDisplay = {
  label: string;
  fullLabel: string;
};

const STATUS_BAR_PATH_PREFIX_CHARS = 18;
const STATUS_BAR_PATH_SUFFIX_CHARS = 25;
const STATUS_BAR_PATH_MAX_CHARS = STATUS_BAR_PATH_PREFIX_CHARS + STATUS_BAR_PATH_SUFFIX_CHARS + 1;

function normalizePath(path: string | null | undefined): string {
  return (path || '').trim().replace(/[\\/]+$/, '');
}

function compactFileNameInPath(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (separatorIndex < 0) {
    return compactStatusBarPath(path);
  }

  const directory = path.slice(0, separatorIndex + 1);
  const name = path.slice(separatorIndex + 1);
  return `${directory}${compactStatusBarPath(name)}`;
}

export function compactStatusBarPath(path: string): string {
  const characters = Array.from(path);
  if (characters.length <= STATUS_BAR_PATH_MAX_CHARS) {
    return path;
  }
  return `${characters.slice(0, STATUS_BAR_PATH_PREFIX_CHARS).join('')}…${characters.slice(-STATUS_BAR_PATH_SUFFIX_CHARS).join('')}`;
}

function pathDisplay(label: string, fullLabel = label): StatusBarPathDisplay {
  return {
    label,
    fullLabel,
  };
}

export function formatStatusBarPathDisplay(
  workspaceDir: string | null | undefined,
  filePath: string | null | undefined,
): StatusBarPathDisplay {
  const dir = normalizePath(workspaceDir);
  const file = normalizePath(filePath);

  if (!file) {
    return pathDisplay(dir || 'No folder');
  }

  return pathDisplay(compactFileNameInPath(file), file);
}
