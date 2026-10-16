export type FileTreeDeleteTarget = {
  path: string;
  isDir: boolean;
};

const MULTI_DELETE_PREVIEW_LIMIT = 6;

function normalizeDeletePath(path: string): string {
  const trimmed = (path || '').trim();
  if (!trimmed) return '';
  if (trimmed === '/') return '/';
  return trimmed.replace(/\/+$/g, '').replace(/\/{2,}/g, '/');
}

function isSameOrChildPath(parent: string, child: string): boolean {
  const normalizedParent = normalizeDeletePath(parent);
  const normalizedChild = normalizeDeletePath(child);
  if (!normalizedParent || !normalizedChild) return false;
  return normalizedParent === normalizedChild || normalizedChild.startsWith(`${normalizedParent}/`);
}

export function dedupeDeleteTargets(targets: FileTreeDeleteTarget[]): FileTreeDeleteTarget[] {
  const normalized = targets
    .map((target) => ({ ...target, path: normalizeDeletePath(target.path) }))
    .filter((target) => !!target.path)
    .sort((a, b) => a.path.localeCompare(b.path));

  const result: FileTreeDeleteTarget[] = [];
  for (const target of normalized) {
    if (result.some((existing) => isSameOrChildPath(existing.path, target.path))) {
      continue;
    }
    result.push(target);
  }
  return result;
}

export function formatDeleteConfirmMessage(targets: FileTreeDeleteTarget[]): string {
  const dedupedTargets = dedupeDeleteTargets(targets);
  const [singleTarget] = dedupedTargets;

  if (!singleTarget) {
    return '';
  }

  if (dedupedTargets.length === 1) {
    return singleTarget.isDir
      ? `Move folder to Trash?\n\n${singleTarget.path}\n\nAll contents will be moved too.`
      : `Move file to Trash?\n\n${singleTarget.path}`;
  }

  const previewTargets = dedupedTargets.slice(0, MULTI_DELETE_PREVIEW_LIMIT);
  const hiddenCount = dedupedTargets.length - previewTargets.length;
  const lines = [
    `Move ${dedupedTargets.length} items to Trash?`,
    '',
    ...previewTargets.map((target) => target.path),
  ];

  if (hiddenCount > 0) {
    lines.push(`...and ${hiddenCount} more`);
  }

  if (dedupedTargets.some((target) => target.isDir)) {
    lines.push('', 'Folder contents will be moved too.');
  }

  return lines.join('\n');
}
