import { expect, test } from 'bun:test'
import { CURSOR_MARKER, visibleWidth } from '@earendil-works/pi-tui'
import type { CursorKind } from '../../src/tui/pane/screenSession.js'
import { ScreenPane, type PaneScreen } from '../../src/tui/view/screenPane.js'

/** Records what the pane asked the session to do. */
class FakeScreen implements PaneScreen {
  readonly resizes: Array<{ cols: number; rows: number }> = []
  readonly inputs: string[] = []
  /** Screen content the fake reports; the pane pads it to the full width. */
  content: string[] = ['one', 'two', 'three']
  /** Cursor style the pane asked for on its last render. */
  cursors: CursorKind[] = []
  /** Faint SGR passed alongside each cursor request. */
  faints: string[] = []

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows })
  }

  renderScreen(width: number, height: number, cursor: CursorKind, faintSgr: string): string[] {
    this.cursors.push(cursor)
    this.faints.push(faintSgr)
    const lines: string[] = []
    for (let y = 0; y < height; y += 1) {
      const padded = (this.content[y] ?? '').padEnd(width, ' ')
      lines.push(cursor === 'focused' && y === 1 ? `${CURSOR_MARKER}${padded.slice(1)}` : padded)
    }
    return lines
  }

  input(data: string): void {
    this.inputs.push(data)
  }
}

test('ScreenPane renders exactly the rows it is given, at the full width', () => {
  const pane = new ScreenPane({ screen: new FakeScreen(), rows: () => 4, color: false })
  const lines = pane.render(30)
  expect(lines).toHaveLength(4)
  for (const line of lines) expect(visibleWidth(line)).toBe(30)
})

test('ScreenPane resizes the session once per size change', () => {
  const screen = new FakeScreen()
  const pane = new ScreenPane({ screen, rows: () => 4, color: false })
  pane.render(30)
  pane.render(30)
  expect(screen.resizes).toEqual([{ cols: 30, rows: 4 }])
  pane.render(50)
  expect(screen.resizes).toEqual([{ cols: 30, rows: 4 }, { cols: 50, rows: 4 }])
  pane.invalidate()
  pane.render(50)
  expect(screen.resizes).toHaveLength(3)
})

test('ScreenPane passes the dim cursor SGR it was given', () => {
  const screen = new FakeScreen()
  const pane = new ScreenPane({ screen, rows: () => 3, color: true, faintCursor: () => 'FAINT' })
  pane.render(20)
  expect(screen.cursors).toEqual(['dim'])
  expect(screen.faints).toEqual(['FAINT'])
})

test('ScreenPane gives the cursor to the focused column and dims it elsewhere', () => {
  const screen = new FakeScreen()
  const pane = new ScreenPane({ screen, rows: () => 3, color: false })
  pane.render(20)
  expect(screen.cursors).toEqual(['dim'])
  pane.focused = true
  pane.render(20)
  expect(screen.cursors).toEqual(['dim', 'focused'])
  expect(pane.render(20).join('')).toContain(CURSOR_MARKER)
})

test('ScreenPane forwards every key to the program', () => {
  const screen = new FakeScreen()
  const pane = new ScreenPane({ screen, rows: () => 3, color: false })
  pane.handleInput('j')
  pane.handleInput('\u001b')
  expect(screen.inputs).toEqual(['j', '\u001b'])
})

test('ScreenPane pads a blank screen instead of collapsing rows', () => {
  const screen = new FakeScreen()
  screen.content = []
  const pane = new ScreenPane({ screen, rows: () => 2, color: false })
  const lines = pane.render(10)
  expect(lines).toHaveLength(2)
  expect(lines[0]).toBe(' '.repeat(10))
})

