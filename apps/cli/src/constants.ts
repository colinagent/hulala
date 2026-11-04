import packageJson from '../package.json' with { type: 'json' }

declare const __HULALA_VERSION__: string | undefined

/**
 * Release version. The bundle replaces `__HULALA_VERSION__` at build time; an
 * unbundled run (tests, `bun src/main.ts`) reads the workspace manifest instead
 * of a hardcoded number that drifts behind the package.
 */
export const VERSION = typeof __HULALA_VERSION__ === 'string' ? __HULALA_VERSION__ : packageJson.version
