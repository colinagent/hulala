/**
 * Theme preference shared by the Electron main process and the renderer.
 *
 * `ui.themeId` stores the persisted preference: a concrete theme id from
 * `theme.jsonc`, or {@link SYSTEM_THEME_ID} to follow the operating system.
 */

/** Persisted preference that follows the operating system appearance. */
export const SYSTEM_THEME_ID = 'system';

/** Built-in theme used for each resolved operating-system color scheme. */
export const BUILT_IN_THEME_IDS_BY_SCHEME = {
  light: 'default-light',
  dark: 'default-dark',
} as const;

/** Resolved operating-system color scheme. */
export type ThemeColorScheme = keyof typeof BUILT_IN_THEME_IDS_BY_SCHEME;

/** Whether a persisted theme preference follows the operating system. */
export function isSystemThemePreference(value: unknown): boolean {
  return value === SYSTEM_THEME_ID;
}

/**
 * Resolve the concrete theme id for a persisted theme preference.
 * @param preference - persisted theme id, or {@link SYSTEM_THEME_ID}.
 * @param scheme - current operating-system color scheme.
 * @returns the theme id that should be active.
 */
export function resolveEffectiveThemeId(preference: string, scheme: ThemeColorScheme): string {
  return isSystemThemePreference(preference) ? BUILT_IN_THEME_IDS_BY_SCHEME[scheme] : preference;
}
