import { expect, test } from 'bun:test'
import { classifyResource, hostPath, hostReason } from '../../src/tui/data/resource.ts'

/**
 * What a link in the conversation names, and the machine that has to resolve it.
 *
 * The split is the one thing here that must not drift: a URL is opened by the
 * reader's browser, and a path is never resolved by the client at all — it is
 * answered by the Host, which is why the second half of these tests is only
 * about the absolute path that gets asked about, never about a file.
 */

test('a browser URL is a URL', () => {
  expect(classifyResource('https://example.invalid/a')).toEqual({ kind: 'url', url: 'https://example.invalid/a' })
  expect(classifyResource('http://example.invalid')).toEqual({ kind: 'url', url: 'http://example.invalid' })
  expect(classifyResource('mailto:someone@example.invalid')).toEqual({ kind: 'url', url: 'mailto:someone@example.invalid' })
  expect(classifyResource('  https://example.invalid/a  ')).toEqual({ kind: 'url', url: 'https://example.invalid/a' })
})

test('a bare filename is a path, which is what a model writes', () => {
  expect(classifyResource('2026-11-24-trader-trade-memory.md'))
    .toEqual({ kind: 'path', path: '2026-11-24-trader-trade-memory.md' })
  expect(classifyResource('./docs/a.md')).toEqual({ kind: 'path', path: './docs/a.md' })
  expect(classifyResource('../a.md')).toEqual({ kind: 'path', path: '../a.md' })
  expect(classifyResource('/Users/colin/a.md')).toEqual({ kind: 'path', path: '/Users/colin/a.md' })
  expect(classifyResource('~/a.md')).toEqual({ kind: 'path', path: '~/a.md' })
})

test('a drive path is a path, not a scheme', () => {
  expect(classifyResource('C:\\work\\a.md')).toEqual({ kind: 'path', path: 'C:\\work\\a.md' })
  expect(classifyResource('C:/work/a.md')).toEqual({ kind: 'path', path: 'C:/work/a.md' })
})

test('neither a URL nor a path is refused instead of guessed at', () => {
  // A fragment addresses the page; an editor or IPC scheme names something this
  // client has no route to; an empty link names nothing at all.
  expect(classifyResource('#section')).toEqual({ kind: 'other', text: '#section' })
  expect(classifyResource('?q=1')).toEqual({ kind: 'other', text: '?q=1' })
  expect(classifyResource('vscode://file/x')).toEqual({ kind: 'other', text: 'vscode://file/x' })
  expect(classifyResource('')).toEqual({ kind: 'other', text: '' })
  expect(classifyResource('   ')).toEqual({ kind: 'other', text: '   ' })
})

test('file: is a path in disguise, so the Host resolves it', () => {
  // A terminal that opened this itself would open it on the wrong machine as
  // soon as the attachment is remote.
  expect(classifyResource('file:///Users/colin/a.md').kind).toBe('other')
})

test('a relative link resolves against the Session directory', () => {
  expect(hostPath({ cwd: '/home/colin/hulala-workspace/workspace' }, '2026-11-24-trader-trade-memory.md'))
    .toBe('/home/colin/hulala-workspace/workspace/2026-11-24-trader-trade-memory.md')
  // `.` and `..` are left for the Host: it resolves against the real filesystem
  // and answers with the canonical path, symlinks included.
  expect(hostPath({ cwd: '/home/colin/w' }, './docs/a.md')).toBe('/home/colin/w/./docs/a.md')
  expect(hostPath({ cwd: '/home/colin/w' }, '/etc/hosts')).toBe('/etc/hosts')
})

test('a tilde is the Host home, never this machine home', () => {
  expect(hostPath({ cwd: '/home/colin/w', home: '/home/other' }, '~/a.md')).toBe('/home/other/a.md')
  expect(hostPath({ cwd: '/home/colin/w', home: '/home/other' }, '~')).toBe('/home/other')
  // A Host that reported no home leaves the tilde alone so the refusal names
  // the path the link actually wrote.
  expect(hostPath({ cwd: '/home/colin/w' }, '~/a.md')).toBe('~/a.md')
})

test('an unresolved relative link with no Session directory stays as written', () => {
  expect(hostPath({ cwd: '' }, 'a.md')).toBe('a.md')
})

test('a Host refusal reaches the reader without its Remote code', () => {
  expect(hostReason(new Error('workspace-files/missing: no entry exists at that path')))
    .toBe('no entry exists at that path')
  expect(hostReason(new Error('gateway/internal: boom'))).toBe('boom')
  expect(hostReason(new Error('something else'))).toBe('something else')
  expect(hostReason('')).toBe('the Host refused the request')
})
