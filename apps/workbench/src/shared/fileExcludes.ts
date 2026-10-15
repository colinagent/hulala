export type FileExcludeConfig = Record<string, boolean>;

export const DEFAULT_FILE_EXCLUDES: FileExcludeConfig = {
  '**/.DS_Store': true,
  '**/Thumbs.db': true,
};

export function normalizeFileExcludeConfig(value: unknown): FileExcludeConfig {
  const result: FileExcludeConfig = { ...DEFAULT_FILE_EXCLUDES };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return result;
  }

  for (const [rawPattern, rawEnabled] of Object.entries(value as Record<string, unknown>)) {
    const pattern = rawPattern.trim();
    if (!pattern || typeof rawEnabled !== 'boolean') {
      continue;
    }
    result[pattern] = rawEnabled;
  }

  return result;
}

export function getEnabledFileExcludePatterns(value: unknown): string[] {
  return Object.entries(normalizeFileExcludeConfig(value))
    .filter(([, enabled]) => enabled)
    .map(([pattern]) => pattern);
}

function normalizePathForExclude(value: string): string {
  return value.replace(/\\+/g, '/').replace(/\/+/g, '/');
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePathForExclude(pattern.trim());
  let source = '';

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    const next = normalized[i + 1];

    if (char === '*') {
      if (next === '*') {
        const afterNext = normalized[i + 2];
        if (afterNext === '/') {
          source += '(?:.*/)?';
          i += 2;
        } else {
          source += '.*';
          i += 1;
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }

    if (char === '?') {
      source += '[^/]';
      continue;
    }

    source += escapeRegExp(char);
  }

  return new RegExp(`^${source}$`, 'i');
}

const globRegexCache = new Map<string, RegExp>();

function matchesGlob(pattern: string, relativePath: string, name: string): boolean {
  const normalizedPattern = normalizePathForExclude(pattern.trim());
  if (!normalizedPattern) {
    return false;
  }

  if (!normalizedPattern.includes('/')) {
    let regex = globRegexCache.get(normalizedPattern);
    if (!regex) {
      regex = globToRegExp(normalizedPattern);
      globRegexCache.set(normalizedPattern, regex);
    }
    return regex.test(name);
  }

  let regex = globRegexCache.get(normalizedPattern);
  if (!regex) {
    regex = globToRegExp(normalizedPattern);
    globRegexCache.set(normalizedPattern, regex);
  }
  return regex.test(relativePath);
}

export function shouldExcludeFileEntry(
  entryName: string,
  parentDir: string,
  patterns: readonly string[],
): boolean {
  if (!entryName || patterns.length === 0) {
    return false;
  }

  const normalizedName = normalizePathForExclude(entryName);
  const normalizedParent = normalizePathForExclude(parentDir).replace(/\/+$/, '');
  const fullPath = normalizedParent ? `${normalizedParent}/${normalizedName}` : normalizedName;
  const relativePath = fullPath.replace(/^\/+/, '');

  return patterns.some((pattern) => matchesGlob(pattern, relativePath, normalizedName));
}

export function filterFileEntries<T extends { name: string }>(
  entries: readonly T[],
  parentDir: string,
  patterns: readonly string[],
): T[] {
  if (patterns.length === 0) {
    return [...entries];
  }
  return entries.filter((entry) => !shouldExcludeFileEntry(entry.name, parentDir, patterns));
}
