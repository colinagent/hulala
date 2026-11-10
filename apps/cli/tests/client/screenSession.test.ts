import { expect, test } from 'bun:test'
import type { PtyModule } from '../../src/tui/editor/pty.js'
import { ScreenSession } from '../../src/tui/pane/screenSession.js'

/** A session over a pty the test drives by hand. */
function startSession(): { session: ScreenSession; paint: (text: string) => void } {
  let deliver: ((data: string) => void) | undefined
  const pty: PtyModule = {
    spawn() {
      return {
        pid: 1,
        onData(handler) { deliver = handler },
        onExit() {},
        write() {},
        resize() {},
        kill() {},
      }
    },
  }
  const session = ScreenSession.start({
    pty,
    command: '/bin/true',
    args: [],
    env: {},
    cwd: '/tmp',
    cols: 12,
    rows: 2,
    onScreen: () => undefined,
    onExit: () => undefined,
  })
  return { session, paint: (text: string) => deliver?.(text) }
}

test('the cell under the cursor keeps its character and takes the marker', () => {
  const { session, paint } = startSession()
  paint('ab')
  const line = session.renderScreen(12, 2, 'focused', '')[0] ?? ''
  // The caret is the terminal's own cursor, so nothing is drawn over the grid:
  // pi-tui positions the cursor on the marker and the character stays readable.
  expect(line).toContain('\u001b_pi:c\u0007')
  expect(line).not.toContain('\u001b_pi:fc\u0007')
  expect(line).not.toContain('▏')
  expect(line).not.toContain('\u001b[7m')
  session.dispose()
})

test('an editor in insert mode keeps the glyph under the caret', () => {
  const { session, paint } = startSession()
  // What Neovim writes on InsertEnter (DECSCUSR 6), with the cursor back over
  // the `a`. A bar drawn in the grid would have to take that cell's only glyph.
  paint('\u001b[6 qab\u001b[2D')
  const line = session.renderScreen(12, 2, 'focused', '')[0] ?? ''
  expect(line).toContain('\u001b_pi:c\u0007a')
  expect(line).not.toContain('▏')
  expect(session.caretShape()).toBe('bar')
  session.dispose()
})

test('the caret shape is the one the program asked to the terminal for', () => {
  const { session, paint } = startSession()
  expect(session.caretShape()).toBe('block')
  // DECSCUSR 4 is the underline shape, for a `guicursor` written as `hor`.
  paint('\u001b[4 q')
  expect(session.caretShape()).toBe('underline')
  paint('\u001b[6 q')
  expect(session.caretShape()).toBe('bar')
  paint('\u001b[2 q')
  expect(session.caretShape()).toBe('block')
  session.dispose()
})

test('a column without focus keeps the block whatever shape the program chose', () => {
  const { session, paint } = startSession()
  paint('\u001b[6 qab')
  const line = session.renderScreen(12, 2, 'dim', 'FAINT')[0] ?? ''
  // The faded block says where the program's cursor is, not which mode it is in:
  // the keyboard is in the other column.
  expect(line).toContain('FAINT')
  expect(line).not.toContain('▏')
  session.dispose()
})
