import { formatDateTime } from '../../i18n/format';
import { rendererI18n } from '../../i18n/renderer';

export {
  buildMarkdownDocumentRenameTarget,
  type MarkdownDocumentRenameTarget,
} from './documentTitleRename';

export function getMarkdownDocumentTitle(filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return rendererI18n.t('untitled');
  }
  const basename = trimmed.split('/').pop() || trimmed;
  const lower = basename.toLowerCase();
  if (lower.endsWith('.markdown')) {
    return basename.slice(0, -'.markdown'.length);
  }
  if (lower.endsWith('.md')) {
    return basename.slice(0, -'.md'.length);
  }
  return basename;
}

export function formatMarkdownModifiedLabel(modTime: number): string | null {
  if (!Number.isFinite(modTime) || modTime <= 0) {
    return null;
  }
  const date = new Date(modTime);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfModDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startOfToday.getTime() - startOfModDay.getTime()) / 86_400_000);

  if (dayDiff === 0) {
    return asLabel(rendererI18n.t('documentModifiedToday'), 'Modified today');
  }
  if (dayDiff === 1) {
    return asLabel(rendererI18n.t('documentModifiedYesterday'), 'Modified yesterday');
  }
  if (dayDiff > 1 && dayDiff < 7) {
    return asLabel(
      rendererI18n.t('documentModifiedDaysAgo', { count: dayDiff }),
      `Modified ${dayDiff} days ago`,
    );
  }

  const formatted = formatDateTime(date, { dateStyle: 'medium' });
  return asLabel(
    rendererI18n.t('documentModifiedOn', { date: formatted }),
    `Modified on ${formatted}`,
  );
}

function asLabel(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}
