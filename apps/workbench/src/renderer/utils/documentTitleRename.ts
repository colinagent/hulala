export type MarkdownDocumentRenameTarget =
  | {
      ok: true;
      filePath: string;
      title: string;
      unchanged: boolean;
    }
  | {
      ok: false;
      reason: 'required' | 'invalid' | 'path-separator';
    };

/**
 * Builds the renamed Markdown path from the document-header title. The header
 * edits only the filename stem; the current directory and exact extension are
 * retained.
 */
export function buildMarkdownDocumentRenameTarget(
  filePath: string,
  rawTitle: string,
): MarkdownDocumentRenameTarget {
  const currentPath = filePath.trim();
  const title = rawTitle.trim();
  if (!title) {
    return { ok: false, reason: 'required' };
  }
  if (title === '.' || title === '..' || title.includes('\0')) {
    return { ok: false, reason: 'invalid' };
  }
  if (title.includes('/') || title.includes('\\')) {
    return { ok: false, reason: 'path-separator' };
  }

  const separatorIndex = currentPath.lastIndexOf('/');
  const basename = separatorIndex >= 0 ? currentPath.slice(separatorIndex + 1) : currentPath;
  const extensionMatch = basename.match(/(\.markdown|\.md)$/i);
  if (!currentPath || !extensionMatch) {
    return { ok: false, reason: 'invalid' };
  }

  const extension = extensionMatch[1];
  const parentPrefix = separatorIndex >= 0 ? currentPath.slice(0, separatorIndex + 1) : '';
  const nextPath = `${parentPrefix}${title}${extension}`;
  return {
    ok: true,
    filePath: nextPath,
    title,
    unchanged: nextPath === currentPath,
  };
}
