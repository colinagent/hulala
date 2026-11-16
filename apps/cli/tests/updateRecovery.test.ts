/**
 * `decideRecovery` — the one place a dropped connection is interpreted.
 *
 * The cases encode the product rules, so each one is a test rather than a
 * comment: a live daemon this window attached to is not an emergency; a release
 * installed elsewhere ends this process; `hulala host stop` is respected; and a
 * Host running another release cannot be fixed by restarting.
 */
import { expect, test } from 'bun:test'
import {
  decideRecovery,
  decideRemoteRecovery,
  type RecoveryFacts,
  type RemoteRecoveryFacts,
} from '../src/tui/plugins/update.js'

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

/**
 * A window on another machine has one more fact than a local one: whether the ssh
 * forward under it is currently being rebuilt. That fact decides between healing
 * on its own and becoming a new process, so it is pinned here.
 */
const remote: RemoteRecoveryFacts = {
  forward: 'forwarding',
  live: { instanceId: 'one' },
  mine: 'one',
  lostForMs: 2_000,
  reattachAfterMs: 20_000,
}

test('a forward being rebuilt is left alone: it returns on the same port', () => {
  expect(decideRemoteRecovery(remote)).toBe('watch')
  // Even when the far side is unreachable this instant, a revival in flight is
  // the thing that has to finish first — a restart would only race it.
  expect(decideRemoteRecovery({ ...remote, forward: 'reviving', live: undefined })).toBe('reviving')
})

test('a machine that answers nothing is waited out, not restarted into', () => {
  expect(decideRemoteRecovery({ ...remote, live: undefined, lostForMs: 600_000 })).toBe('unreachable')
})

test('a Host that answers but is another daemon is re-attached at once', () => {
  // Its endpoint token (and maybe its port) belong to the new process, so no
  // amount of retrying this window can attach.
  expect(decideRemoteRecovery({ ...remote, live: { instanceId: 'two' } })).toBe('reattach')
})

test('the same daemon gets its retries before this window gives up on itself', () => {
  expect(decideRemoteRecovery({ ...remote, lostForMs: 19_000 })).toBe('watch')
  expect(decideRemoteRecovery({ ...remote, lostForMs: 20_000 })).toBe('reattach')
})
