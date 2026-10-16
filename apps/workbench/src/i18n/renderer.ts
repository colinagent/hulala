import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  DEFAULT_DISPLAY_LOCALE,
  displayLocaleToHtmlLang,
  normalizeDisplayLocale,
  type DisplayLocale,
} from './locales';
import { I18N_NAMESPACES, I18N_RESOURCES } from './resources';

let rendererInitialized = false;

export async function initRendererI18n(
  locale?: DisplayLocale,
  systemLocale?: string,
): Promise<DisplayLocale> {
  const resolved = normalizeDisplayLocale(locale, systemLocale);
  if (!rendererInitialized) {
    await i18n.use(initReactI18next).init({
      lng: resolved,
      fallbackLng: DEFAULT_DISPLAY_LOCALE,
      resources: I18N_RESOURCES,
      ns: [...I18N_NAMESPACES],
      defaultNS: 'common',
      interpolation: { escapeValue: false },
      returnNull: false,
    });
    rendererInitialized = true;
  } else if (i18n.language !== resolved) {
    await i18n.changeLanguage(resolved);
  }
  applyRendererDocumentLang(resolved);
  return resolved;
}

export async function setRendererI18nLocale(locale: DisplayLocale): Promise<void> {
  await initRendererI18n(locale);
  if (i18n.language !== locale) {
    await i18n.changeLanguage(locale);
  }
  applyRendererDocumentLang(locale);
}

export function getRendererI18nLocale(): DisplayLocale {
  return normalizeDisplayLocale(i18n.language);
}

export function applyRendererDocumentLang(locale: DisplayLocale): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = displayLocaleToHtmlLang(locale);
  }
}

export { i18n as rendererI18n };
