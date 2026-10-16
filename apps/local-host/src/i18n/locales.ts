export const DISPLAY_LOCALES = ['en', 'zh-CN'] as const;

export type DisplayLocale = (typeof DISPLAY_LOCALES)[number];

export const DEFAULT_DISPLAY_LOCALE: DisplayLocale = 'en';

/** Native names — do not translate when shown in the language picker. */
export const LOCALE_LABELS: Record<DisplayLocale, string> = {
  en: 'English',
  'zh-CN': '简体中文',
};

export function isDisplayLocale(value: string): value is DisplayLocale {
  return (DISPLAY_LOCALES as readonly string[]).includes(value);
}

export function normalizeDisplayLocale(
  value: unknown,
  systemLocale?: string,
): DisplayLocale {
  if (typeof value === 'string' && isDisplayLocale(value)) {
    return value;
  }
  const raw = (systemLocale || '').trim().toLowerCase();
  if (raw === 'zh-cn' || raw.startsWith('zh')) {
    return 'zh-CN';
  }
  return DEFAULT_DISPLAY_LOCALE;
}

export function displayLocaleToHtmlLang(locale: DisplayLocale): string {
  return locale;
}

export function displayLocaleToIntlLocale(locale: DisplayLocale): string {
  return locale;
}
