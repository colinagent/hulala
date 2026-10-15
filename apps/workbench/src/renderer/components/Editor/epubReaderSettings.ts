import { localStore } from "../../../platform/storage";
export type EpubReaderTheme = 'auto' | 'sepia' | 'night';
export type EpubReaderFont = 'app' | 'serif' | 'sans' | 'publisher';

export type EpubReaderSettings = {
  fontScale: number;
  theme: EpubReaderTheme;
  font: EpubReaderFont;
};

export const EPUB_READER_SETTINGS_KEY = 'hulala.epub.readerSettings.v1';
export const MIN_EPUB_FONT_SCALE = 0.82;
export const MAX_EPUB_FONT_SCALE = 1.45;
export const EPUB_FONT_SCALE_STEP = 0.08;
export const DEFAULT_EPUB_READER_SETTINGS: EpubReaderSettings = {
  fontScale: 1,
  theme: 'auto',
  font: 'app',
};

type EpubReaderSettingsListener = () => void;

let currentSettings: EpubReaderSettings | null = null;
const listeners = new Set<EpubReaderSettingsListener>();

export function clampEpubFontScale(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_EPUB_READER_SETTINGS.fontScale;
  }
  const clamped = Math.min(MAX_EPUB_FONT_SCALE, Math.max(MIN_EPUB_FONT_SCALE, value));
  return Math.round(clamped * 100) / 100;
}

export function normalizeEpubReaderSettings(input: unknown): EpubReaderSettings {
  const candidate = input && typeof input === 'object'
    ? input as { fontScale?: unknown; theme?: unknown; font?: unknown }
    : {};
  const theme: EpubReaderTheme = candidate.theme === 'sepia' || candidate.theme === 'night'
    ? candidate.theme
    : 'auto';
  const font: EpubReaderFont = candidate.font === 'serif'
    || candidate.font === 'sans'
    || candidate.font === 'publisher'
    ? candidate.font
    : 'app';
  const fontScale = typeof candidate.fontScale === 'number'
    ? clampEpubFontScale(candidate.fontScale)
    : DEFAULT_EPUB_READER_SETTINGS.fontScale;
  return { fontScale, theme, font };
}

export function parseEpubReaderSettings(raw: string | null | undefined): EpubReaderSettings {
  if (!raw) {
    return { ...DEFAULT_EPUB_READER_SETTINGS };
  }
  try {
    return normalizeEpubReaderSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_EPUB_READER_SETTINGS };
  }
}

function loadEpubReaderSettings(): EpubReaderSettings {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_EPUB_READER_SETTINGS };
  }
  try {
    return parseEpubReaderSettings(localStore.getItem(EPUB_READER_SETTINGS_KEY));
  } catch {
    return { ...DEFAULT_EPUB_READER_SETTINGS };
  }
}

function persistEpubReaderSettings(settings: EpubReaderSettings): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    localStore.setItem(EPUB_READER_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Reader preferences remain usable for this session when storage is unavailable.
  }
}

export function getEpubReaderSettings(): EpubReaderSettings {
  if (!currentSettings) {
    currentSettings = loadEpubReaderSettings();
  }
  return currentSettings;
}

export function subscribeEpubReaderSettings(listener: EpubReaderSettingsListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setEpubReaderSettings(input: unknown): EpubReaderSettings {
  const next = normalizeEpubReaderSettings(input);
  const current = getEpubReaderSettings();
  if (
    current.fontScale === next.fontScale
    && current.theme === next.theme
    && current.font === next.font
  ) {
    return current;
  }
  currentSettings = next;
  persistEpubReaderSettings(next);
  listeners.forEach((listener) => listener());
  return next;
}

export function setEpubReaderTheme(theme: EpubReaderTheme): EpubReaderSettings {
  return setEpubReaderSettings({ ...getEpubReaderSettings(), theme });
}

export function setEpubReaderFont(font: EpubReaderFont): EpubReaderSettings {
  return setEpubReaderSettings({ ...getEpubReaderSettings(), font });
}

export function stepEpubFontScale(direction: 1 | -1): EpubReaderSettings {
  const current = getEpubReaderSettings();
  return setEpubReaderSettings({
    ...current,
    fontScale: current.fontScale + direction * EPUB_FONT_SCALE_STEP,
  });
}

export function resetEpubFontScale(): EpubReaderSettings {
  return setEpubReaderSettings({
    ...getEpubReaderSettings(),
    fontScale: DEFAULT_EPUB_READER_SETTINGS.fontScale,
  });
}

export function formatEpubFontScalePercent(fontScale: number): string {
  return `${Math.round(clampEpubFontScale(fontScale) * 100)}%`;
}

export function isEpubFilePath(filePath: string | null | undefined): boolean {
  return (filePath || '').trim().toLowerCase().endsWith('.epub');
}
