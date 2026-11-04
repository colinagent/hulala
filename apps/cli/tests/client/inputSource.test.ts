import { expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ENGLISH_INPUT_SOURCE, inputSource, inputSourceSwitch } from '../../src/tui/editor/inputSource.js'

/** A stand-in for `bin/ime`: reports `source`, records every select. */
function fakeHelper(source = 'com.example.current'): { executable: string, log: string } {
  const directory = mkdtempSync(join(tmpdir(), 'hulala-ime-'))
  const log = join(directory, 'calls.log')
  const executable = join(directory, 'ime')
  writeFileSync(executable, `#!/bin/sh\nif [ "$#" -eq 0 ]; then ${source === '' ? 'exit 0' : `printf '%s\\n' '${source}'`}; else printf '%s\\n' "$1" >> '${log}'; fi\n`)
  chmodSync(executable, 0o755)
  return { executable, log }
}

/** The ids the helper was asked to select, in order. */
function selected(log: string): string[] {
  if (!existsSync(log)) return []
  return readFileSync(log, 'utf8').split('\n').filter(line => line !== '')
}

/** Wait for the fire-and-forget selects to reach the log. */
async function waitFor(log: string, count: number): Promise<string[]> {
  for (let attempt = 0; attempt < 100 && selected(log).length < count; attempt += 1) await Bun.sleep(10)
  return selected(log)
}

test('no helper means no input-source control', () => {
  expect(inputSource(undefined)).toBeUndefined()
  expect(inputSource('')).toBeUndefined()
})

test('a missing helper reports nothing instead of throwing', async () => {
  const source = inputSource('/nonexistent/hulala/bin/ime')
  expect(await source?.current()).toBeUndefined()
  expect(() => source?.select(ENGLISH_INPUT_SOURCE)).not.toThrow()
})

test('the helper reports the current source and selects by id', async () => {
  const { executable, log } = fakeHelper()
  const source = inputSource(executable)
  expect(await source?.current()).toBe('com.example.current')
  source?.select(ENGLISH_INPUT_SOURCE)
  expect(await waitFor(log, 1)).toEqual([ENGLISH_INPUT_SOURCE])
})

test('a non-English source is switched to English', async () => {
  const { executable, log } = fakeHelper('com.example.chinese')
  const ime = inputSourceSwitch(() => inputSource(executable))
  ime.ensure()
  expect(await waitFor(log, 1)).toEqual([ENGLISH_INPUT_SOURCE])
})

test('an English source is left alone, so keystrokes spawn nothing', async () => {
  const { executable, log } = fakeHelper(ENGLISH_INPUT_SOURCE)
  const ime = inputSourceSwitch(() => inputSource(executable))
  ime.ensure()
  await Bun.sleep(200)
  expect(selected(log)).toEqual([])
})

test('a helper that cannot report the source still selects English', async () => {
  // Exits 0 with no output, as a helper whose read failed does: English is the
  // default, not a translation of what the read said.
  const { executable, log } = fakeHelper('')
  const ime = inputSourceSwitch(() => inputSource(executable))
  ime.ensure()
  expect(await waitFor(log, 1)).toEqual([ENGLISH_INPUT_SOURCE])
})

test('the client never selects anything but English', async () => {
  const { executable, log } = fakeHelper('com.example.chinese')
  const ime = inputSourceSwitch(() => inputSource(executable))
  for (let call = 0; call < 3; call += 1) ime.ensure()
  expect(await waitFor(log, 3)).toEqual([ENGLISH_INPUT_SOURCE, ENGLISH_INPUT_SOURCE, ENGLISH_INPUT_SOURCE])
})

test('a switch made before the helper exists picks it up on the next call', async () => {
  let executable: string | undefined
  const ime = inputSourceSwitch(() => inputSource(executable))
  expect(() => ime.ensure()).not.toThrow()
  const helper = fakeHelper('com.example.chinese')
  executable = helper.executable
  ime.ensure()
  expect(await waitFor(helper.log, 1)).toEqual([ENGLISH_INPUT_SOURCE])
})
