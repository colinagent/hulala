/**
 * Declared profile bundles the compatibility gate refused to load.
 *
 * A bundle skipped by the gate never becomes a Loader entry, so a roster read
 * from the Loader cannot see it — the only trace would be one stderr line during
 * boot. The Runtime publishes the gate's own verdict on the context instead, and
 * the Host's readiness route reports it next to the entries it did load.
 *
 * @module hulala/runtime/profile-skips
 */

/** One `bundles` entry the profile gate skipped. */
export interface ProfileSkip {
  /** Package name exactly as the profile declared it. */
  readonly name: string
  /** Why the gate refused it, in DSH's words. */
  readonly reason: string
}

/** Service the Host reads; the Runtime boot is its only writer. */
export const PROFILE_SKIPS_SERVICE = 'hulalaProfileSkips' as const

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Set by a Hulala Host boot; absent in a plain DSH process. */
    hulalaProfileSkips: readonly ProfileSkip[]
  }
}
