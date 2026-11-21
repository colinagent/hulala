import { expect, test } from 'bun:test'
import { StreamTerminal, type TerminalStreams } from '../../src/tui/terminal.js'
import { APP_TITLE, windowTitle } from '../../src/tui/plugins/title.js'

test('a local window runs `<directory> - <app>:<Session title>`', () => {
  expect(APP_TITLE).toBe('Hulala')
  // No machine: a local tab's directory alone says where the work is.
  expect(windowTitle('/Users/colin/note/projects/pi')).toBe('pi - Hulala')
  // The Session's own name hangs off the product name, so a truncated tab keeps
  // the place it is working in.
  expect(windowTitle('/Users/colin/note/projects/pi', 'Fix the composer'))
    .toBe('pi - Hulala:Fix the composer')
  // A trailing separator is common (a dropped directory) and must not empty the label.
  expect(windowTitle('/Users/colin/note/projects/hulala-dev/')).toBe('hulala-dev - Hulala')
})

test('a remote window prefixes the directory the way scp writes a path', () => {
  const dev = { user: 'root', host: 'dev' }
  expect(windowTitle('/root/pi', undefined, { machine: dev })).toBe('root@dev:pi - Hulala')
  expect(windowTitle('/root/pi', 'Fix the composer', { machine: dev }))
    .toBe('root@dev:pi - Hulala:Fix the composer')
  // A machine that named no account still prefixes, without an empty `@`.
  expect(windowTitle('/root/pi', undefined, { machine: { user: undefined, host: 'dev' } }))
    .toBe('dev:pi - Hulala')
})

test('a title with nothing to name still says something', () => {
  expect(windowTitle('/')).toBe('/ - Hulala')
  expect(windowTitle('')).toBe('/ - Hulala')
  // A Host-written title of spaces is not a name.
  expect(windowTitle('/srv/work', '   ')).toBe('work - Hulala')
})

test('a title cannot end its OSC sequence early', () => {
  const written: string[] = []
  const terminal = new StreamTerminal({
    input: { on: () => undefined, off: () => undefined },
    output: { write: (chunk: string) => { written.push(chunk); return true } },
  } as unknown as TerminalStreams)
  // The BEL and the ESC each become one space; the rest stays as typed text, so
  // the sequence still ends at the BEL this call writes.
  terminal.setTitle('work\u0007\u001b]0;injected\u001b\\')
  expect(written.join('')).toBe('\u001b]0;work  ]0;injected \\\u0007')
})
