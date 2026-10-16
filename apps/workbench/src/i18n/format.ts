import { displayLocaleToIntlLocale, type DisplayLocale } from './locales';
import { getRendererI18nLocale } from './renderer';

function resolveIntlLocale(explicit?: DisplayLocale): string {
  const locale = explicit ?? getRendererI18nLocale();
  return displayLocaleToIntlLocale(locale);
}

export function formatDateTime(
  value: Date | number,
  options?: Intl.DateTimeFormatOptions,
  locale?: DisplayLocale,
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(resolveIntlLocale(locale), options).format(date);
}

export function formatLocaleString(
  value: Date | number,
  locale?: DisplayLocale,
): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toLocaleString(resolveIntlLocale(locale));
}
