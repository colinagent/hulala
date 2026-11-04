import { expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ENGLISH_INPUT_SOURCE, inputSource } from '../../src/tui/editor/inputSource.js'

/** A stand-in for `bin/ime` that reports a source and records selects. */
function fakeHelper(): { executable: string, log: string } {
  const directory = mkdtempSync(join(tmpdir(), 'hulala-ime-'))
  const log = join(directory, 'calls.log')
  const executable = join(directory, 'ime')
  writeFileSync(executable, `#!/bin/sh\nif [ "$#" -eq 0 ]; then printf '%s\\n' 'com.example.current'; else printf '%s\\n' "$1" >> '${log}'; fi\n`)
  chmodSync(executable, 0o755)
  return { executable, log }
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
  // `select` is fire-and-forget; wait for the child to write its argument.
  for (let attempt = 0; attempt < 100 && !existsSync(log); attempt += 1) await Bun.sleep(10)
  expect(readFileSync(log, 'utf8').trim()).toBe(ENGLISH_INPUT_SOURCE)
})
