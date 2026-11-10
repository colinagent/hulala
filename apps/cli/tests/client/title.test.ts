import { expect, test } from 'bun:test'
import { StreamTerminal, type TerminalStreams } from '../../src/tui/terminal.js'
import { APP_TITLE, windowTitle } from '../../src/tui/plugins/title.js'

test('the window title leads with the directory, so a truncated tab still shows it', () => {
  expect(APP_TITLE).toBe('Hulala')
  expect(windowTitle('/Users/colin/hulala-workspace/workspace')).toBe('Hulala - workspace')
  // A trailing separator is common (a dropped directory) and must not empty the label.
  expect(windowTitle('/Users/colin/note/projects/hulala-dev/')).toBe('Hulala - hulala-dev')
  // The Session's own name comes last, after the place it works in.
  expect(windowTitle('/srv/work', 'Fix the composer')).toBe('Hulala - work - Fix the composer')
})

test('a title with nothing to name still says something', () => {
  expect(windowTitle('/')).toBe('Hulala - /')
  expect(windowTitle('')).toBe('Hulala - /')
  // A Host-written title of spaces is not a name.
  expect(windowTitle('/srv/work', '   ')).toBe('Hulala - work')
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
