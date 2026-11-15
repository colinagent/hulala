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
import { spawnHandoff } from '../../src/spawn.ts'

test('a handoff waits for the successor and returns its exit code', async () => {
  const code = await spawnHandoff(process.execPath, ['-e', 'process.exit(7)'])
  expect(code).toBe(7)
})

test('a handoff that cannot start resolves instead of throwing', async () => {
  const code = await spawnHandoff('/no/such/hulala/binary', [])
  expect(code).toBe(1)
})
