import { expect, test } from 'bun:test'
import { CURSOR_MARKER, stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'
import type { CaretShape, CursorKind } from '../../src/tui/pane/screenSession.js'
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

  /** Shape the pane reports for the terminal's cursor. */
  shape: CaretShape = 'block'

  caretShape(): CaretShape {
    return this.shape
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


/** History state the pane can page; tests move it directly. */
class FakeScroll {
  back = 0
  readonly pages: number[] = []
  followCalls = 0
  count = 0

  scrollable(): boolean { return this.count > 0 }
  scrollPages(pages: number): boolean {
    this.pages.push(pages)
    const next = Math.max(0, Math.min(this.count, this.back - pages * 5))
    if (next === this.back) return false
    this.back = next
    return true
  }

  follow(): boolean {
    this.followCalls += 1
    if (this.back === 0) return false
    this.back = 0
    return true
  }

  scrolledBack(): number { return this.back }
}

const PAGE_UP = '\u001b[5~'
const PAGE_DOWN = '\u001b[6~'

test('a terminal pages its own history and marks the live screen in the last row', () => {
  const screen = new FakeScreen()
  const scroll = new FakeScroll()
  scroll.count = 20
  scroll.back = 7
  const pane = new ScreenPane({ screen, scroll, rows: () => 3, color: false })
  const lines = pane.render(40)
  expect(lines.at(-1)).toContain('history 7 lines')
  expect(screen.cursors).toEqual(['none'])

  pane.handleInput(PAGE_UP)
  pane.handleInput(PAGE_DOWN)
  expect(scroll.pages).toEqual([-1, 1])
  // Paging never reaches the program.
  expect(screen.inputs).toEqual([])
})

test('typing in a scrolled-back terminal returns to the live screen first', () => {
  const screen = new FakeScreen()
  const scroll = new FakeScroll()
  scroll.count = 20
  scroll.back = 4
  const pane = new ScreenPane({ screen, scroll, rows: () => 3, color: false })
  pane.handleInput('x')
  expect(scroll.followCalls).toBe(1)
  expect(screen.inputs).toEqual(['x'])
})

test('an editor without history passes the paging keys to the program', () => {
  const screen = new FakeScreen()
  const pane = new ScreenPane({ screen, rows: () => 3, color: false })
  pane.handleInput(PAGE_UP)
  pane.handleInput(PAGE_DOWN)
  expect(screen.inputs).toEqual([PAGE_UP, PAGE_DOWN])
})

test('an editor pane hands the pointer to its program', () => {
  const screen = new FakeScreen()
  const pane = new ScreenPane({ screen, rows: () => 3, color: false, mouse: true })
  const press = { type: 'press', button: 'left', x: 4, y: 1, screenX: 44, screenY: 1, width: 40, height: 3, shift: false, alt: false, ctrl: false } as const
  expect(pane.handleMouse(press)).toEqual({ handled: true })
  expect(pane.handleMouse({ ...press, type: 'drag', x: 9, y: 1, screenX: 49 })).toEqual({ handled: true })
  expect(pane.handleMouse({ ...press, type: 'release', x: 9, y: 1, screenX: 49 })).toEqual({ handled: true })
  expect(screen.inputs).toEqual(['\u001b[<0;5;2M', '\u001b[<32;10;2M', '\u001b[<0;10;2m'])
})

test('a pane without mouse support leaves the pointer to the frame', () => {
  const screen = new FakeScreen()
  const pane = new ScreenPane({ screen, rows: () => 3, color: false })
  const press = { type: 'press', button: 'left', x: 4, y: 1, screenX: 44, screenY: 1, width: 40, height: 3, shift: false, alt: false, ctrl: false } as const
  expect(pane.handleMouse(press)).toBeUndefined()
  // Repaints and hovers still end a divider hover, but nothing reaches the shell.
  expect(screen.inputs).toEqual([])
})

test('an editor pane reports the pointer resting on the program divider', () => {
  const screen = new FakeScreen()
  let column: number | undefined = 3
  let hovered = false
  const pane = new ScreenPane({
    screen,
    rows: () => 2,
    color: false,
    mouse: true,
    divider: {
      column: () => column,
      hovered: () => hovered,
      setHovered: (next: boolean) => { hovered = next },
    },
  })
  const move = { type: 'move', button: 'none', x: 3, y: 0, screenX: 43, screenY: 0, width: 40, height: 2, shift: false, alt: false, ctrl: false } as const
  pane.handleMouse(move)
  expect(hovered).toBe(true)
  pane.handleMouse({ ...move, x: 4 })
  expect(hovered).toBe(false)
  // Bare motion is never written to the program: it only drives the hover.
  expect(screen.inputs).toEqual([])
  column = undefined
  pane.handleMouse(move)
  expect(hovered).toBe(false)
})

test('an editor pane draws the accent over the program divider while hovered', () => {
  const screen = new FakeScreen()
  screen.content = ['one', 'two', 'three']
  let hovered = true
  const pane = new ScreenPane({
    screen,
    rows: () => 2,
    color: true,
    mouse: true,
    divider: {
      column: () => 1,
      hovered: () => hovered,
      setHovered: (next: boolean) => { hovered = next },
    },
  })
  const painted = pane.render(6)
  // The block replaces the program's own cell in that column, nothing else.
  expect(stripTerminalSequences(painted[0]!)).toBe('o▎e   ')
  expect(visibleWidth(painted[0]!)).toBe(6)
  hovered = false
  const idle = pane.render(6)
  expect(stripTerminalSequences(idle[0]!)).toBe('one   ')
})

test('a drag on the program divider keeps the hover for the whole gesture', () => {
  const screen = new FakeScreen()
  let column = 3
  let hovered = false
  const seen: boolean[] = []
  const pane = new ScreenPane({
    screen,
    rows: () => 2,
    color: false,
    mouse: true,
    divider: {
      column: () => column,
      hovered: () => hovered,
      setHovered: (next: boolean) => { hovered = next; seen.push(next) },
    },
  })
  const base = { button: 'left', x: 3, y: 0, screenX: 43, screenY: 0, width: 40, height: 2, shift: false, alt: false, ctrl: false } as const
  pane.handleMouse({ ...base, type: 'press' })
  // The boundary follows the pointer, so the rule is no longer under it — the
  // hover must survive anyway, the way the frame's own dividers do.
  for (const moved of [4, 5, 6]) {
    column = moved
    pane.handleMouse({ ...base, type: 'drag', x: moved })
  }
  // The pane keeps asking for the hover; it never asks to end it mid-drag.
  expect(seen.every(Boolean)).toBe(true)
  expect(hovered).toBe(true)
  pane.handleMouse({ ...base, type: 'release', x: 6 })
  // Released on the rule it dragged: still under the pointer, so still hovered.
  expect(hovered).toBe(true)
  pane.handleMouse({ ...base, type: 'move', x: 10 })
  expect(hovered).toBe(false)
})
