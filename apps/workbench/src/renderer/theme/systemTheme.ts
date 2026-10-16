/**
 * Operating-system appearance detection for the Follow System theme preference.
 * Electron mirrors the OS appearance into `prefers-color-scheme`, so the
 * renderer does not need a native bridge to stay in sync.
 */

import {
  BUILT_IN_THEME_IDS_BY_SCHEME,
  type ThemeColorScheme,
} from '../../shared/themePreference';
import type { ThemeDefinition } from './presets';

const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/** Current operating-system color scheme; light when media queries are unavailable. */
export function getSystemColorScheme(): ThemeColorScheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }
  return window.matchMedia(DARK_SCHEME_QUERY).matches ? 'dark' : 'light';
}

/**
 * Subscribe to operating-system color-scheme changes.
 * @param listener - called with the new scheme on every change.
 * @returns an unsubscribe function.
 */
export function subscribeSystemColorScheme(listener: (scheme: ThemeColorScheme) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const media = window.matchMedia(DARK_SCHEME_QUERY);
  const handleChange = () => listener(media.matches ? 'dark' : 'light');
  media.addEventListener('change', handleChange);
  return () => media.removeEventListener('change', handleChange);
}

/**
 * Pick the theme that represents an operating-system color scheme.
 * @param themes - themes currently available at runtime.
 * @param scheme - operating-system color scheme.
 * @returns the built-in theme for the scheme, else the first theme with that
 * scheme, else undefined when no theme matches.
 */
export function resolveSystemTheme(
  themes: ThemeDefinition[],
  scheme: ThemeColorScheme,
): ThemeDefinition | undefined {
  const builtInId = BUILT_IN_THEME_IDS_BY_SCHEME[scheme];
  return themes.find((theme) => theme.id === builtInId)
    ?? themes.find((theme) => theme.scheme === scheme);
}
