import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inputSourceAllowed, isTemporaryRoot } from '../../src/tui/editor/inputSourcePolicy.js'

test('a state root under the OS temporary directory never owns the input source', () => {
  // The end-to-end suites start a real client on a pty with a temp HULALA_HOME;
  // before this rule each of their focus edges selected a real system source.
  const temporary = mkdtempSync(join(tmpdir(), 'hulala-policy-'))
  expect(isTemporaryRoot(temporary)).toBe(true)
  expect(isTemporaryRoot(join(temporary, 'nested'))).toBe(true)
  expect(inputSourceAllowed({ dataRoot: temporary, environment: {} })).toBe(false)
})

test('a real state root owns it, and a similar-looking sibling is not temporary', () => {
  expect(inputSourceAllowed({ dataRoot: '/Users/colin/.hulala', environment: {} })).toBe(true)
  expect(isTemporaryRoot('/var/folders-backup/thing', '/var/folders')).toBe(false)
  expect(isTemporaryRoot('/var/folders/gy/T', '/var/folders')).toBe(true)
})

test('HULALA_INPUT_SOURCE answers for both directions', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'hulala-policy-'))
  expect(inputSourceAllowed({ dataRoot: temporary, environment: { HULALA_INPUT_SOURCE: '1' } })).toBe(true)
  expect(inputSourceAllowed({ dataRoot: '/Users/colin/.hulala', environment: { HULALA_INPUT_SOURCE: '0' } })).toBe(false)
  // Anything else is not an override: the rule decides.
  expect(inputSourceAllowed({ dataRoot: '/Users/colin/.hulala', environment: { HULALA_INPUT_SOURCE: 'yes' } })).toBe(true)
  expect(inputSourceAllowed({ dataRoot: temporary, environment: { HULALA_INPUT_SOURCE: '' } })).toBe(false)
})
