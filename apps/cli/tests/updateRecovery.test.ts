/**
 * `decideRecovery` — the one place a dropped connection is interpreted.
 *
 * The cases encode the product rules, so each one is a test rather than a
 * comment: a live daemon this window attached to is not an emergency; a release
 * installed elsewhere ends this process; `hulala host stop` is respected; and a
 * Host running another release cannot be fixed by restarting.
 */
import { expect, test } from 'bun:test'
import { decideRecovery, type RecoveryFacts } from '../src/tui/plugins/update.js'

const base: RecoveryFacts = {
  live: { version: '0.2.27', instanceId: 'one' },
  mine: 'one',
  installed: '0.2.27',
  version: '0.2.27',
}

test('the daemon this window attached to is watched, not replaced', () => {
  expect(decideRecovery(base)).toBe('watch')
  // A backend that does not know its instance proves nothing, so it restarts
  // instead of assuming the daemon is the same one.
  expect(decideRecovery({ ...base, mine: undefined })).toBe('restart')
})

test('a same-version daemon that replaced ours is re-attached as a new process', () => {
  expect(decideRecovery({ ...base, live: { version: '0.2.27', instanceId: 'two' } })).toBe('restart')
})

test('a release installed elsewhere ends this process even if its old daemon lives', () => {
  expect(decideRecovery({ ...base, installed: '0.2.28' })).toBe('restart')
  // No daemon at all, but the launcher would start a newer release: this is the
  // "another terminal updated" case.
  expect(decideRecovery({ ...base, live: undefined, installed: '0.2.28' })).toBe('restart')
})

test('a stopped Host is left stopped when this process is already the installed release', () => {
  expect(decideRecovery({ ...base, live: undefined })).toBe('stopped')
  // A source checkout has no installed release to switch to.
  expect(decideRecovery({ ...base, live: undefined, installed: undefined })).toBe('stopped')
})

test('a Host serving another release is named, not fought over', () => {
  expect(decideRecovery({ ...base, live: { version: '0.2.30', instanceId: 'two' } })).toBe('mismatch')
  // With another release installed, a restart is exactly what fixes it.
  expect(decideRecovery({ ...base, live: { version: '0.2.30', instanceId: 'two' }, installed: '0.2.27' })).toBe('mismatch')
  expect(decideRecovery({ ...base, live: { version: '0.2.30', instanceId: 'two' }, installed: '0.2.31' })).toBe('restart')
})
