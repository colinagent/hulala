/**
 * A process swap must keep the terminal in the same foreground process group.
 *
 * The old code spawned the successor `detached` and exited immediately. The
 * child kept the tty's file descriptors but led a new session, so the shell
 * regained the foreground and both read the same bytes: arrow keys split in
 * half, the caret was drawn by a renderer that no longer owned the screen, and
 * terminal replies left in the canonical buffer became `command not found`.
 * These tests pin the two properties that fix it: the parent waits, and nothing
 * throws when the successor cannot start.
 */
import { expect, test } from 'bun:test'
import { handoffInvocation, spawnHandoff } from '../../src/spawn.ts'

test('a handoff waits for the successor and returns its exit code', async () => {
  const code = await spawnHandoff(process.execPath, ['-e', 'process.exit(7)'])
  expect(code).toBe(7)
})

test('a handoff that cannot start resolves instead of throwing', async () => {
  const code = await spawnHandoff('/no/such/hulala/binary', [])
  expect(code).toBe(1)
})

/**
 * What the successor *is* depends on the kind of installation, and the wrong
 * answer is fatal rather than cosmetic: an installed release's entry in the
 * state root is the `sh` launcher that picks the runtime Node, so handing it to
 * the current interpreter runs a shell script as JavaScript and the window dies
 * instead of reopening. A checkout must not touch that launcher at all.
 */
test('an installed release hands over to its own launcher, not to the interpreter', () => {
  const invocation = handoffInvocation({
    installed: true,
    dataRoot: '/home/me/.hulala',
    entry: '/home/me/.hulala/runtime/client/versions/0.3.26-x/bin/hulala',
    execPath: '/usr/local/bin/node',
    tail: ['--resume', 'abc', '--remote', 'dev'],
  })
  expect(invocation).toEqual({
    command: '/home/me/.hulala/bin/hulala',
    args: ['--resume', 'abc', '--remote', 'dev'],
  })
})

test('a checkout re-runs its own entry on its own interpreter', () => {
  const invocation = handoffInvocation({
    installed: false,
    dataRoot: '/home/me/.hulala',
    entry: 'apps/cli/src/main.ts',
    execPath: '/usr/local/bin/bun',
    tail: ['--remote', 'dev'],
  })
  expect(invocation).toEqual({ command: '/usr/local/bin/bun', args: ['apps/cli/src/main.ts', '--remote', 'dev'] })
  // Nothing to re-run is not an error, but it is not a process either.
  expect(handoffInvocation({ installed: false, dataRoot: '/home/me/.hulala', entry: undefined, execPath: 'node', tail: [] }))
    .toBeUndefined()
})
