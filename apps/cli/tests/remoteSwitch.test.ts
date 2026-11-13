/**
 * Switching machines from inside the window.
 *
 * A switch is a restart, and a restart can only happen in a client the launcher
 * started. In a source checkout the window must say so and stay open: shutting
 * down first and discovering there is nothing to start is the one failure a user
 * cannot recover from.
 */
import { expect, test } from 'bun:test'
import { restartSupported } from '../src/tui/plugins/remote.ts'

test('an installed client can switch machines', () => {
  expect(restartSupported({ HULALA_INSTALL_ROOT: '/home/me/.hulala/runtime/client' }, undefined)).toBe(true)
})

test('a source checkout restarts its own entry', () => {
  // `bun run start` runs `apps/cli/dist/hulala.mjs`, so re-running that entry is
  // the same client with different arguments — not the installed release beside it.
  expect(restartSupported({}, '/repo/apps/cli/dist/hulala.mjs')).toBe(true)
  expect(restartSupported({ HULALA_INSTALL_ROOT: '  ' }, '/repo/apps/cli/dist/hulala.mjs')).toBe(true)
})

test('with no entry and nothing installed there is nothing to restart', () => {
  expect(restartSupported({}, undefined)).toBe(false)
  expect(restartSupported({ HULALA_INSTALL_ROOT: '   ' }, '')).toBe(false)
})
