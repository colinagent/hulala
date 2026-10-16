function normalizeDirPath(input: string): string {
  const value = input.trim();
  if (!value) {
    return '';
  }
  if (value === '/') {
    return '/';
  }
  return value.replace(/\/+$/, '');
}

function normalizeLeafName(input: string): string {
  return input.trim().replace(/^\/+/, '').replace(/\/+$/, '');
}

export function joinBaseDirResourcePath(baseDir: string, leafName: string): string {
  const root = normalizeDirPath(baseDir);
  const leaf = normalizeLeafName(leafName);
  if (!leaf) {
    return root || '/';
  }
  if (!root || root === '/') {
    return `/${leaf}`;
  }
  return `${root}/${leaf}`;
}

export function getBaseDirResourceMissingMessage(rootLabel: string): string {
  return `No ${rootLabel} directory available`;
}

export function getBaseDirResourceEmptyMessage(rootLabel: string): string {
  return `No ${rootLabel} installed yet`;
}
