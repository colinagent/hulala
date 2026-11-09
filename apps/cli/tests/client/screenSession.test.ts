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

test('a program that never chose a cursor shape gets the filled block', () => {
  const { session, paint } = startSession()
  paint('ab')
  const line = session.renderScreen(12, 2, 'focused', '')[0] ?? ''
  // pi-tui turns the fake cursor's markers into reverse video, which is the block
  // a shell has always shown: a shell paints no cursor of its own.
  expect(line).toContain('\u001b_pi:fc\u0007')
  expect(line).not.toContain('▏')
  session.dispose()
})

test('an editor in insert mode gets a bar instead of the block', () => {
  const { session, paint } = startSession()
  // What Neovim writes on InsertEnter (DECSCUSR 6: steady bar).
  paint('\u001b[6 qab')
  const line = session.renderScreen(12, 2, 'focused', '')[0] ?? ''
  expect(line).toContain('▏')
  expect(line).not.toContain('\u001b[7m')
  session.dispose()
})

test('a horizontal cursor keeps the character it is under', () => {
  const { session, paint } = startSession()
  // DECSCUSR 4 is the underline shape, for a `guicursor` written as `hor`.
  paint('\u001b[4 qab')
  const line = session.renderScreen(12, 2, 'focused', '')[0] ?? ''
  expect(line).toContain('\u001b[4m \u001b[24m')
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
