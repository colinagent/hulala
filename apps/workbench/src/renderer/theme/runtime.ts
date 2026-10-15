import { localStore } from "../../platform/storage";
import { SYSTEM_THEME_ID } from '../../shared/themePreference';
import { ThemeDefinition, defaultThemeId as fallbackDefaultThemeId, themes as fallbackThemes } from './presets';
import { getSystemColorScheme, resolveSystemTheme } from './systemTheme';
import { tokensToCssVariables } from './tokens';

const themeStyleId = 'hulala-theme-tokens';
const THEME_SNAPSHOT_KEY = 'hulala-theme-snapshot';
const THEME_SNAPSHOT_VERSION = 25;

export type ThemeSnapshot = {
  version: number;
  themeId: string;
  /** Persisted preference that produced this snapshot; `system` follows the OS. */
  preference: string;
  label: string;
  scheme: 'dark' | 'light';
  css: string;
};

let runtimeThemes: ThemeDefinition[] = fallbackThemes;
let runtimeDefaultThemeId: string = fallbackDefaultThemeId;
let runtimeCurrentThemeId: string | null = null;
let runtimeCurrentThemePreference: string | null = null;
let runtimeCurrentSnapshot: ThemeSnapshot | null = null;

function buildThemeCss(theme: ThemeDefinition): string {
  return `:root {\n${tokensToCssVariables(theme.tokens)}\n}`;
}

function ensureStyleElement(): HTMLStyleElement | null {
  if (typeof document === 'undefined') {
    return null;
  }
  let style = document.getElementById(themeStyleId) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = themeStyleId;
    document.head.appendChild(style);
  }
  return style;
}

function applyThemeCss(css: string, scheme: 'dark' | 'light') {
  const style = ensureStyleElement();
  if (style) {
    style.textContent = css;
  }
  if (typeof document !== 'undefined') {
    document.documentElement.style.colorScheme = scheme;
    document.documentElement.dataset.colorScheme = scheme;
  }
}

function cacheThemeSnapshot(snapshot: ThemeSnapshot) {
  try {
    localStore.setItem(THEME_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    // localStore may be unavailable
  }
}

function isValidSnapshot(input: unknown): input is ThemeSnapshot {
  if (!input || typeof input !== 'object') {
    return false;
  }
  const snapshot = input as Record<string, unknown>;
  if (snapshot.version !== THEME_SNAPSHOT_VERSION) {
    return false;
  }
  if (typeof snapshot.themeId !== 'string' || !snapshot.themeId.trim()) {
    return false;
  }
  if (typeof snapshot.preference !== 'string' || !snapshot.preference.trim()) {
    return false;
  }
  if (typeof snapshot.label !== 'string' || !snapshot.label.trim()) {
    return false;
  }
  if (snapshot.scheme !== 'dark' && snapshot.scheme !== 'light') {
    return false;
  }
  if (typeof snapshot.css !== 'string' || !snapshot.css.trim()) {
    return false;
  }
  return true;
}

function createThemeSnapshot(theme: ThemeDefinition, preference: string): ThemeSnapshot {
  return {
    version: THEME_SNAPSHOT_VERSION,
    themeId: theme.id,
    preference,
    label: theme.label,
    scheme: theme.scheme,
    css: buildThemeCss(theme),
  };
}

function resolveTheme(themeId?: string): { preference: string; theme: ThemeDefinition } {
  const requested = themeId?.trim()
    || runtimeCurrentThemePreference
    || runtimeDefaultThemeId
    || fallbackDefaultThemeId;
  if (requested === SYSTEM_THEME_ID) {
    const theme = resolveSystemTheme(runtimeThemes, getSystemColorScheme())
      || getThemeById(runtimeDefaultThemeId)
      || runtimeThemes[0]
      || fallbackThemes[0];
    return { preference: SYSTEM_THEME_ID, theme };
  }
  const theme = getThemeById(requested);
  if (theme) {
    return { preference: requested, theme };
  }
  const fallbackTheme = (runtimeCurrentThemeId ? getThemeById(runtimeCurrentThemeId) : undefined)
    || getThemeById(runtimeDefaultThemeId)
    || runtimeThemes[0]
    || fallbackThemes[0];
  return { preference: fallbackTheme.id, theme: fallbackTheme };
}

/** Rebuild a Follow System snapshot when the OS scheme changed while the app was closed. */
function resolveSnapshotForCurrentScheme(snapshot: ThemeSnapshot): ThemeSnapshot {
  if (snapshot.preference !== SYSTEM_THEME_ID) {
    return snapshot;
  }
  const scheme = getSystemColorScheme();
  if (scheme === snapshot.scheme) {
    return snapshot;
  }
  const theme = resolveSystemTheme(fallbackThemes, scheme);
  return theme ? createThemeSnapshot(theme, SYSTEM_THEME_ID) : snapshot;
}

export function applyThemeSnapshot(snapshot: ThemeSnapshot, persist = true): ThemeSnapshot {
  applyThemeCss(snapshot.css, snapshot.scheme);
  runtimeCurrentThemeId = snapshot.themeId;
  runtimeCurrentThemePreference = snapshot.preference;
  runtimeCurrentSnapshot = snapshot;
  if (persist) {
    cacheThemeSnapshot(snapshot);
  }
  return snapshot;
}

export function restoreThemeSnapshot(): boolean {
  try {
    const raw = localStore.getItem(THEME_SNAPSHOT_KEY);
    if (!raw) {
      return false;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidSnapshot(parsed)) {
      return false;
    }
    applyThemeSnapshot(resolveSnapshotForCurrentScheme(parsed), false);
    return true;
  } catch {
    return false;
  }
}

export function setThemeRuntimeDefinitions(nextThemes: ThemeDefinition[] | null, nextDefaultThemeId?: string) {
  runtimeThemes = nextThemes && nextThemes.length ? nextThemes : fallbackThemes;
  if (nextDefaultThemeId && runtimeThemes.some((theme) => theme.id === nextDefaultThemeId)) {
    runtimeDefaultThemeId = nextDefaultThemeId;
  } else if (!runtimeThemes.some((theme) => theme.id === runtimeDefaultThemeId)) {
    runtimeDefaultThemeId = runtimeThemes[0]?.id || fallbackDefaultThemeId;
  }
}

export function activateTheme(themeId?: string): ThemeDefinition {
  const { preference, theme } = resolveTheme(themeId);
  applyThemeSnapshot(createThemeSnapshot(theme, preference), true);
  return theme;
}

/**
 * Re-resolve the active theme after an operating-system appearance change.
 * @returns the refreshed theme while the preference follows the system, else null.
 */
export function refreshSystemTheme(): ThemeDefinition | null {
  if (runtimeCurrentThemePreference !== SYSTEM_THEME_ID) {
    return null;
  }
  return activateTheme(SYSTEM_THEME_ID);
}

export function reapplyCurrentThemeSnapshot(): boolean {
  if (runtimeCurrentSnapshot) {
    applyThemeSnapshot(runtimeCurrentSnapshot, false);
    return true;
  }
  if (!runtimeCurrentThemeId) {
    return false;
  }
  activateTheme(runtimeCurrentThemeId);
  return true;
}

export function getThemeById(themeId: string): ThemeDefinition | undefined {
  return runtimeThemes.find((theme) => theme.id === themeId);
}

export function getAvailableThemes(): ThemeDefinition[] {
  return runtimeThemes;
}

export function getCurrentThemeId(): string | null {
  return runtimeCurrentThemeId;
}

/** Persisted preference of the active theme, or null before any theme activation. */
export function getCurrentThemePreference(): string | null {
  return runtimeCurrentThemePreference;
}

export function getCurrentThemeSnapshot(): ThemeSnapshot | null {
  return runtimeCurrentSnapshot;
}

export function getDefaultThemeId(): string {
  return runtimeDefaultThemeId;
}
