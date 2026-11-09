import { expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inputSource, inputSourceOwnership, type InputSourceOwnership } from '../../src/tui/editor/inputSource.js'

/** The English layout the fake helper offers. */
const ENGLISH = 'com.apple.keylayout.ABC'
/** The user's own source in these tests. */
const CHINESE = 'com.example.chinese'

/** Options for {@link fakeHelper}. */
interface FakeOptions {
  /** The source in force when the helper is first called. */
  readonly current?: string
  /** Whether an English layout is available at all. */
  readonly english?: boolean
}

/** A stand-in for `bin/ime`, its state, and every call it took. */
interface Fake {
  readonly executable: string
  readonly log: string
  readonly state: string
}

/**
 * A fake helper that keeps the current source in a file.
 *
 * It speaks the helper's protocol: two lines (previous, selected) and the exit
 * codes that say what happened, so the client sees exactly what it would see
 * from `native/ime.c`.
 */
function fakeHelper(options: FakeOptions = {}): Fake {
  const directory = mkdtempSync(join(tmpdir(), 'hulala-ime-'))
  const log = join(directory, 'calls.log')
  const state = join(directory, 'state')
  const executable = join(directory, 'ime')
  writeFileSync(state, options.current ?? CHINESE)
  const english = options.english === false ? '' : ENGLISH
  writeFileSync(executable, `#!/bin/sh
STATE='${state}'
LOG='${log}'
ENGLISH='${english}'
CHINESE='${CHINESE}'
cur=$(cat "$STATE")
if [ "$#" -eq 0 ]; then printf '%s\\n' "$cur"; exit 0; fi
printf '%s\\n' "$*" >> "$LOG"
if [ "$1" = "--english" ]; then want="$ENGLISH"; else want="$1"; fi
if [ -z "$want" ]; then exit 3; fi
if [ "$want" != "$ENGLISH" ] && [ "$want" != "$CHINESE" ]; then exit 3; fi
printf '%s\\n%s\\n' "$cur" "$want"
if [ "$cur" = "$want" ]; then exit 10; fi
printf '%s' "$want" > "$STATE"
exit 0
`)
  chmodSync(executable, 0o755)
  return { executable, log, state }
}

/** Every argument list the helper was called with, in order. */
function calls(log: string): string[] {
  if (!existsSync(log)) return []
  return readFileSync(log, 'utf8').split('\n').filter(line => line !== '')
}

/** The source the fake helper currently reports. */
function source(state: string): string {
  return readFileSync(state, 'utf8')
}

/**
 * Wait for a condition the tests cannot observe directly.
 *
 * Every check here crosses a process spawn, so the only honest way to wait is to
 * poll for the effect; the timeout is generous because a cold spawn under the
 * test runner is far slower than in the client.
 */
async function waitFor(condition: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (condition()) return
    await Bun.sleep(10)
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * Give the client more than enough time to have acted, for the assertions that
 * say it must *not* act. One spawn is the longest thing it could still do.
 */
function quiet(): Promise<void> {
  // Generous on purpose: a cold spawn under a loaded suite has been measured at
  // half a second, and these assertions say the client must not act at all.
  return Bun.sleep(1500)
}

test('no helper means no input-source control', () => {
  expect(inputSource(undefined)).toBeUndefined()
  expect(inputSource('')).toBeUndefined()
})

test('a missing helper reports nothing instead of throwing', async () => {
  const helper = inputSource('/nonexistent/hulala/bin/ime')
  expect(await helper?.current()).toBeUndefined()
  expect((await helper?.english())?.failed).toBe(true)
})

test('the helper reports both ends of a switch', async () => {
  const fake = fakeHelper()
  const helper = inputSource(fake.executable)
  expect(await helper?.current()).toBe(CHINESE)
  expect(await helper?.english()).toEqual({
    previous: CHINESE,
    selected: ENGLISH,
    changed: true,
    unavailable: false,
    failed: false,
  })
  expect(source(fake.state)).toBe(ENGLISH)
})

test('a source already in force is reported as unchanged', async () => {
  const fake = fakeHelper({ current: ENGLISH })
  const outcome = await inputSource(fake.executable)?.english()
  expect(outcome?.changed).toBe(false)
  expect(outcome?.previous).toBe(ENGLISH)
})

test('a machine with no English layout is unavailable, not a crash', async () => {
  const fake = fakeHelper({ english: false })
  const outcome = await inputSource(fake.executable)?.english()
  expect(outcome?.unavailable).toBe(true)
  expect(outcome?.changed).toBe(false)
})

test('a command surface switches to English', async () => {
  const fake = fakeHelper()
  const ownership = inputSourceOwnership(() => inputSource(fake.executable))
  ownership.acquire()
  await waitFor(() => source(fake.state) === ENGLISH, 'the switch to English')
  expect(calls(fake.log)).toEqual(['--english'])
})

test('leaving the command surface restores the source it found', async () => {
  const fake = fakeHelper()
  const ownership = inputSourceOwnership(() => inputSource(fake.executable))
  ownership.acquire()
  await waitFor(() => source(fake.state) === ENGLISH, 'the switch to English')
  ownership.release()
  // The fake appends to the log before it writes the state, so wait for the
  // effect this test is about rather than for the call that causes it.
  await waitFor(() => calls(fake.log).length === 2 && source(fake.state) === CHINESE, 'the restore')
  expect(calls(fake.log)).toEqual(['--english', CHINESE])
})

test('a user whose own source is English costs no switch at all', async () => {
  const fake = fakeHelper({ current: ENGLISH })
  const ownership = inputSourceOwnership(() => inputSource(fake.executable))
  ownership.acquire()
  await waitFor(() => calls(fake.log).length === 1, 'the "already English" call')
  ownership.release()
  await quiet()
  // One call: it asked for English, was told it was already there, and nothing
  // was switched afterwards.
  expect(calls(fake.log)).toEqual(['--english'])
  expect(source(fake.state)).toBe(ENGLISH)
})

test('a source the user picked by hand is never given back over', async () => {
  const fake = fakeHelper()
  const ownership = inputSourceOwnership(() => inputSource(fake.executable))
  ownership.acquire()
  await waitFor(() => source(fake.state) === ENGLISH, 'the switch to English')
  // The user switches by hand inside the command surface — say, to type Chinese
  // into Neovim. The client's claim is stale from that moment on.
  writeFileSync(fake.state, CHINESE)
  ownership.release()
  await quiet()
  expect(source(fake.state)).toBe(CHINESE)
  expect(calls(fake.log)).toEqual(['--english'])
})

test('nested command surfaces switch once and restore once', async () => {
  const fake = fakeHelper()
  const ownership = inputSourceOwnership(() => inputSource(fake.executable))
  ownership.acquire()
  ownership.acquire()
  await waitFor(() => source(fake.state) === ENGLISH, 'the switch to English')
  ownership.release()
  await quiet()
  expect(source(fake.state)).toBe(ENGLISH)
  ownership.release()
  await waitFor(() => calls(fake.log).length === 2 && source(fake.state) === CHINESE, 'the restore')
  expect(calls(fake.log)).toEqual(['--english', CHINESE])
})

test('an acquire and a release in the same tick still land in order', async () => {
  const fake = fakeHelper()
  const ownership = inputSourceOwnership(() => inputSource(fake.executable))
  // The user presses Ctrl-] into Neovim and Ctrl-[ straight back out: the switch
  // must land before the restore, never after it.
  ownership.acquire()
  ownership.release()
  await waitFor(() => calls(fake.log).length === 2 && source(fake.state) === CHINESE, 'the restore')
  expect(calls(fake.log)).toEqual(['--english', CHINESE])
})

test('a machine without an English layout says so once', async () => {
  const fake = fakeHelper({ english: false })
  let warnings = 0
  const ownership = inputSourceOwnership(() => inputSource(fake.executable), {
    onUnavailable: () => { warnings += 1 },
  })
  ownership.acquire()
  await waitFor(() => calls(fake.log).length === 1, 'the first attempt')
  ownership.release()
  ownership.acquire()
  await waitFor(() => calls(fake.log).length === 2, 'the second attempt')
  expect(warnings).toBe(1)
  expect(source(fake.state)).toBe(CHINESE)
})

test('no helper makes the ownership inert', async () => {
  const ownership: InputSourceOwnership = inputSourceOwnership(() => undefined)
  expect(() => ownership.acquire()).not.toThrow()
  expect(() => ownership.release()).not.toThrow()
  expect(() => ownership.restoreNow()).not.toThrow()
  await Bun.sleep(50)
})

test('the exit path gives the source back synchronously', async () => {
  const fake = fakeHelper()
  const ownership = inputSourceOwnership(() => inputSource(fake.executable))
  ownership.acquire()
  await ownership.idle()
  expect(source(fake.state)).toBe(ENGLISH)
  ownership.restoreNow()
  expect(source(fake.state)).toBe(CHINESE)
})

test('the exit path leaves a hand-picked source alone', async () => {
  const fake = fakeHelper()
  const ownership = inputSourceOwnership(() => inputSource(fake.executable))
  ownership.acquire()
  await ownership.idle()
  expect(source(fake.state)).toBe(ENGLISH)
  writeFileSync(fake.state, CHINESE)
  ownership.restoreNow()
  expect(source(fake.state)).toBe(CHINESE)
  expect(calls(fake.log)).toEqual(['--english'])
})
