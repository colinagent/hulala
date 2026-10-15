export type DirectoryPickerPathStyle = 'posix' | 'windows';

export type DirectoryPickerEntry = {
  name: string;
  isDir: boolean;
  size: number;
  modTime: number;
};

export type DirectoryPickerParsedInput = {
  normalizedInput: string;
  browseDir: string;
  filter: string;
  valid: boolean;
};

export type DirectoryPickerRow = {
  key: string;
  label: string;
  path: string;
  isParent: boolean;
};

export type DirectoryPickerBreadcrumb = {
  key: string;
  label: string;
  path: string;
  isRoot: boolean;
};

const WINDOWS_DRIVE_PREFIX_RE = /^[a-zA-Z]:/;
const WINDOWS_DRIVE_ROOT_RE = /^[a-zA-Z]:\\$/;

export function detectDirectoryPickerPathStyle(input: string | null | undefined): DirectoryPickerPathStyle {
  const value = (input || '').trim();
  if (value.includes('\\') || WINDOWS_DRIVE_PREFIX_RE.test(value)) {
    return 'windows';
  }
  return 'posix';
}

export function normalizeDirectoryPickerPath(
  input: string | null | undefined,
  explicitStyle?: DirectoryPickerPathStyle,
): string {
  const trimmed = (input || '').trim();
  if (!trimmed) {
    return '';
  }

  const style = explicitStyle || detectDirectoryPickerPathStyle(trimmed);

  if (style === 'windows') {
    let normalized = trimmed.replace(/\//g, '\\');
    if (WINDOWS_DRIVE_PREFIX_RE.test(normalized)) {
      const drivePrefix = normalized.slice(0, 2);
      let rest = normalized.slice(2).replace(/\\+/g, '\\');
      if (!rest) {
        return `${drivePrefix}\\`;
      }
      if (!rest.startsWith('\\')) {
        rest = `\\${rest}`;
      }
      normalized = `${drivePrefix}${rest}`;
    } else {
      normalized = normalized.replace(/\\+/g, '\\');
    }

    if (normalized.endsWith('\\') && !WINDOWS_DRIVE_ROOT_RE.test(normalized)) {
      normalized = normalized.replace(/\\+$/, '');
    }
    return normalized;
  }

  const collapsed = trimmed.replace(/\/+/g, '/');
  if (collapsed === '/') {
    return '/';
  }
  return collapsed.replace(/\/+$/, '');
}

export function isAbsoluteDirectoryPickerPath(
  input: string | null | undefined,
  explicitStyle?: DirectoryPickerPathStyle,
): boolean {
  const normalized = normalizeDirectoryPickerPath(input, explicitStyle);
  if (!normalized) {
    return false;
  }

  const style = explicitStyle || detectDirectoryPickerPathStyle(normalized);
  if (style === 'windows') {
    return WINDOWS_DRIVE_ROOT_RE.test(normalized) || /^[a-zA-Z]:\\/.test(normalized) || normalized.startsWith('\\\\');
  }
  return normalized.startsWith('/');
}

export function isDirectoryPickerRootPath(
  input: string | null | undefined,
  explicitStyle?: DirectoryPickerPathStyle,
): boolean {
  const normalized = normalizeDirectoryPickerPath(input, explicitStyle);
  if (!normalized) {
    return false;
  }
  const style = explicitStyle || detectDirectoryPickerPathStyle(normalized);
  return style === 'windows' ? WINDOWS_DRIVE_ROOT_RE.test(normalized) : normalized === '/';
}

export function getDirectoryPickerParentPath(
  input: string | null | undefined,
  explicitStyle?: DirectoryPickerPathStyle,
): string {
  const normalized = normalizeDirectoryPickerPath(input, explicitStyle);
  const style = explicitStyle || detectDirectoryPickerPathStyle(normalized);

  if (!normalized) {
    return style === 'windows' ? 'C:\\' : '/';
  }
  if (isDirectoryPickerRootPath(normalized, style)) {
    return normalized;
  }

  if (style === 'windows') {
    const lastSlash = normalized.lastIndexOf('\\');
    if (lastSlash <= 2 && WINDOWS_DRIVE_PREFIX_RE.test(normalized)) {
      return `${normalized.slice(0, 2)}\\`;
    }
    if (lastSlash <= 0) {
      return normalized;
    }
    return normalized.slice(0, lastSlash);
  }

  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) {
    return '/';
  }
  return normalized.slice(0, lastSlash) || '/';
}

export function getDirectoryPickerBaseName(
  input: string | null | undefined,
  explicitStyle?: DirectoryPickerPathStyle,
): string {
  const normalized = normalizeDirectoryPickerPath(input, explicitStyle);
  if (!normalized) {
    return '';
  }
  const style = explicitStyle || detectDirectoryPickerPathStyle(normalized);
  if (isDirectoryPickerRootPath(normalized, style)) {
    return normalized;
  }
  const separator = style === 'windows' ? '\\' : '/';
  const lastSeparator = normalized.lastIndexOf(separator);
  if (lastSeparator < 0) {
    return normalized;
  }
  return normalized.slice(lastSeparator + 1) || normalized;
}

export function directoryPickerPathsEqual(
  left: string | null | undefined,
  right: string | null | undefined,
  explicitStyle?: DirectoryPickerPathStyle,
): boolean {
  const style = explicitStyle || detectDirectoryPickerPathStyle(left || right || '');
  const normalizedLeft = normalizeDirectoryPickerPath(left, style);
  const normalizedRight = normalizeDirectoryPickerPath(right, style);
  if (style === 'windows') {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }
  return normalizedLeft === normalizedRight;
}

export function parseDirectoryPickerInput(
  input: string,
  options?: {
    style?: DirectoryPickerPathStyle;
    overrideBrowseDir?: string | null;
  },
): DirectoryPickerParsedInput {
  const style = options?.style || detectDirectoryPickerPathStyle(input);
  const trimmed = input.trim();
  const rootPath = style === 'windows' ? 'C:\\' : '/';

  if (!trimmed) {
    return {
      normalizedInput: '',
      browseDir: rootPath,
      filter: '',
      valid: false,
    };
  }

  const normalizedInput = normalizeDirectoryPickerPath(trimmed, style);
  if (!isAbsoluteDirectoryPickerPath(normalizedInput, style)) {
    return {
      normalizedInput,
      browseDir: rootPath,
      filter: '',
      valid: false,
    };
  }

  const overrideBrowseDir = normalizeDirectoryPickerPath(options?.overrideBrowseDir || '', style);
  if (overrideBrowseDir && directoryPickerPathsEqual(overrideBrowseDir, normalizedInput, style)) {
    return {
      normalizedInput,
      browseDir: overrideBrowseDir,
      filter: '',
      valid: true,
    };
  }

  if (isDirectoryPickerRootPath(normalizedInput, style)) {
    return {
      normalizedInput,
      browseDir: normalizedInput,
      filter: '',
      valid: true,
    };
  }

  const hasTrailingSeparator = style === 'windows'
    ? /[\\/]$/.test(trimmed)
    : trimmed.endsWith('/');

  if (hasTrailingSeparator) {
    return {
      normalizedInput,
      browseDir: normalizedInput,
      filter: '',
      valid: true,
    };
  }

  return {
    normalizedInput,
    browseDir: getDirectoryPickerParentPath(normalizedInput, style),
    filter: getDirectoryPickerBaseName(normalizedInput, style),
    valid: true,
  };
}

export function sortDirectoryPickerEntries(entries: readonly DirectoryPickerEntry[]): DirectoryPickerEntry[] {
  return [...entries].sort((left, right) => {
    if (left.isDir !== right.isDir) {
      return left.isDir ? -1 : 1;
    }

    const leftHidden = left.name.startsWith('.');
    const rightHidden = right.name.startsWith('.');
    if (leftHidden !== rightHidden) {
      return leftHidden ? 1 : -1;
    }

    return left.name.localeCompare(right.name);
  });
}

export function buildDirectoryPickerRows(options: {
  browseDir: string;
  entries: readonly DirectoryPickerEntry[];
  filter?: string;
  style?: DirectoryPickerPathStyle;
}): DirectoryPickerRow[] {
  const style = options.style || detectDirectoryPickerPathStyle(options.browseDir);
  const prefix = (options.filter || '').trim().toLowerCase();
  const separator = style === 'windows' ? '\\' : '/';
  const rows = sortDirectoryPickerEntries(options.entries)
    .filter((entry) => entry.isDir)
    .filter((entry) => (prefix ? entry.name.toLowerCase().startsWith(prefix) : true))
    .map((entry) => ({
      key: entry.name,
      label: entry.name,
      path: isDirectoryPickerRootPath(options.browseDir, style)
        ? `${options.browseDir}${style === 'windows' ? '' : ''}${entry.name}`
        : `${options.browseDir}${separator}${entry.name}`,
      isParent: false,
    }));

  if (isDirectoryPickerRootPath(options.browseDir, style)) {
    return rows;
  }

  return [
    {
      key: '..',
      label: '..',
      path: getDirectoryPickerParentPath(options.browseDir, style),
      isParent: true,
    },
    ...rows,
  ];
}

export function buildDirectoryPickerBreadcrumbs(
  input: string,
  explicitStyle?: DirectoryPickerPathStyle,
): DirectoryPickerBreadcrumb[] {
  const normalized = normalizeDirectoryPickerPath(input, explicitStyle);
  if (!normalized) {
    return [];
  }
  const style = explicitStyle || detectDirectoryPickerPathStyle(normalized);

  if (style === 'windows') {
    const driveRoot = WINDOWS_DRIVE_PREFIX_RE.test(normalized) ? `${normalized.slice(0, 2)}\\` : normalized;
    const rest = normalized.startsWith(driveRoot) ? normalized.slice(driveRoot.length) : '';
    const segments = rest ? rest.split('\\').filter(Boolean) : [];
    const crumbs: DirectoryPickerBreadcrumb[] = [
      {
        key: driveRoot,
        label: driveRoot,
        path: driveRoot,
        isRoot: true,
      },
    ];

    let currentPath = driveRoot;
    for (const segment of segments) {
      currentPath = currentPath.endsWith('\\') ? `${currentPath}${segment}` : `${currentPath}\\${segment}`;
      crumbs.push({
        key: currentPath,
        label: segment,
        path: currentPath,
        isRoot: false,
      });
    }
    return crumbs;
  }

  if (normalized === '/') {
    return [{ key: '/', label: '/', path: '/', isRoot: true }];
  }

  const segments = normalized.split('/').filter(Boolean);
  const crumbs: DirectoryPickerBreadcrumb[] = [{ key: '/', label: '/', path: '/', isRoot: true }];
  let currentPath = '';
  for (const segment of segments) {
    currentPath = `${currentPath}/${segment}`;
    crumbs.push({
      key: currentPath,
      label: segment,
      path: currentPath,
      isRoot: false,
    });
  }
  return crumbs;
}

export function joinDirectoryPickerPath(
  base: string,
  name: string,
  explicitStyle?: DirectoryPickerPathStyle,
): string {
  const style = explicitStyle || detectDirectoryPickerPathStyle(base);
  const normalizedBase = normalizeDirectoryPickerPath(base, style);
  if (!normalizedBase) {
    return name;
  }
  if (isDirectoryPickerRootPath(normalizedBase, style)) {
    return style === 'windows'
      ? `${normalizedBase}${name}`
      : `/${name}`;
  }
  const sep = style === 'windows' ? '\\' : '/';
  return `${normalizedBase}${sep}${name}`;
}

export function dedupeDirectoryPickerPaths(
  paths: readonly string[],
  explicitStyle?: DirectoryPickerPathStyle,
): string[] {
  const style = explicitStyle || detectDirectoryPickerPathStyle(paths[0] || '');
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of paths) {
    const normalized = normalizeDirectoryPickerPath(item, style);
    if (!normalized) {
      continue;
    }
    const key = style === 'windows' ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }

  return result;
}
