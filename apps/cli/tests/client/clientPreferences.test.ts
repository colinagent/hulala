/**
 * `config/client.json`: the terminal client's own preferences.
 *
 * One file carries several facts written by different features, so the contract
 * here is that every write merges — remembering a Session must not forget the
 * language, and one Host's row must not overwrite another's.
 */
import { expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  hostKeyOf,
  lastSessionFor,
  readClientPreferences,
  rememberSession,
  updateClientPreferences,
} from '../../src/clientPreferences.js'

test('the remembered Session is per attachment and merges with the other keys', () => {
  const root = mkdtempSync(join(tmpdir(), 'hulala-prefs-'))
  // The language is written by another feature; remembering a Session must not
  // drop it, and switching Host must not overwrite the other Host's row.
  updateClientPreferences(root, { language: 'zh-CN' })
  rememberSession(root, hostKeyOf(undefined), 'session-local')
  rememberSession(root, hostKeyOf('devbox'), 'session-remote')
  expect(lastSessionFor(root, 'local')).toBe('session-local')
  expect(lastSessionFor(root, hostKeyOf('devbox'))).toBe('session-remote')
  expect(lastSessionFor(root, hostKeyOf('gpu'))).toBeUndefined()
  expect(readClientPreferences(root).values.language).toBe('zh-CN')
})

test('a malformed map or id is ignored instead of thrown', () => {
  const root = mkdtempSync(join(tmpdir(), 'hulala-prefs-bad-'))
  updateClientPreferences(root, { lastSessionByHost: { local: '', devbox: 7 } })
  expect(lastSessionFor(root, 'local')).toBeUndefined()
  expect(lastSessionFor(root, 'devbox')).toBeUndefined()
  updateClientPreferences(root, { lastSessionByHost: [] })
  expect(lastSessionFor(root, 'local')).toBeUndefined()
})

test('the attachment key is the ssh destination, or local', () => {
  expect(hostKeyOf(undefined)).toBe('local')
  expect(hostKeyOf('')).toBe('local')
  expect(hostKeyOf('devbox')).toBe('devbox')
})
