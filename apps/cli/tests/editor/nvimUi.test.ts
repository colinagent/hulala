import { expect, test } from 'bun:test'
import { decodeMsgpack, encodeMsgpack, type Msgpack } from '../../src/tui/editor/msgpack.ts'
import { NvimUi, keyNotation, mouseRequest } from '../../src/tui/editor/nvimUi.ts'

/**
 * The editor column's UI client.
 *
 * Three contracts are pinned here: the byte channel (a message may be split
 * across chunks), the key mapping (terminal bytes become `nvim_input`
 * notation), and the grid (rows, attributes and the cursor cell are what the
 * pane renders). They are the parts a live Neovim would only tell us about
 * indirectly.
 */

test('msgpack round-trips the shapes Neovim sends and receives', () => {
  const value: Msgpack = [0, 1, 'nvim_input', [{ a: 1, b: [true, false, null], c: 'text', d: -5 }]]
  const encoded = encodeMsgpack(value)
  expect(decodeMsgpack(encoded).values).toEqual([value])
})

test('a message split across two chunks is decoded once the rest arrives', () => {
  const encoded = encodeMsgpack([2, 'redraw', [['flush']]])
  const first = decodeMsgpack(encoded.subarray(0, encoded.length - 2))
  expect(first.values).toEqual([])
  expect(first.consumed).toBe(0)

  const merged = new Uint8Array(encoded.length)
  merged.set(encoded)
  const whole = decodeMsgpack(merged)
  expect(whole.values).toEqual([[2, 'redraw', [['flush']]]])
  expect(whole.consumed).toBe(merged.length)
})

test('two messages in one chunk are both decoded', () => {
  const a = encodeMsgpack([1, 1, null, null])
  const b = encodeMsgpack([2, 'redraw', [['flush']]])
  const merged = new Uint8Array(a.length + b.length)
  merged.set(a)
  merged.set(b, a.length)
  expect(decodeMsgpack(merged).values).toEqual([[1, 1, null, null], [2, 'redraw', [['flush']]]])
})

test('printable text passes through and a bare < is escaped', () => {
  expect(keyNotation('hello')).toBe('hello')
  expect(keyNotation('a<b')).toBe('a<lt>b')
})

test('control keys become nvim notation', () => {
  expect(keyNotation('\r')).toBe('<CR>')
  expect(keyNotation('\t')).toBe('<Tab>')
  expect(keyNotation('\u007f')).toBe('<BS>')
  expect(keyNotation('\u0001')).toBe('<C-a>')
  expect(keyNotation('\u001b')).toBe('<Esc>')
})

test('arrow and paging sequences keep their modifiers', () => {
  expect(keyNotation('\u001b[A')).toBe('<Up>')
  expect(keyNotation('\u001b[1;5C')).toBe('<C-Right>')
  expect(keyNotation('\u001b[3~')).toBe('<Del>')
  expect(keyNotation('\u001b[Z')).toBe('<S-Tab>')
  expect(keyNotation('x\u001b[A')).toBe('x<Up>')
})

test('alt-modified input is one key, not an escape followed by text', () => {
  expect(keyNotation('\u001bx')).toBe('<M-x>')
  expect(keyNotation('\u001bOP')).toBe('<F1>')
  // Two escapes are an Escape key followed by the sequence, which is exactly the
  // bytes a terminal sends; guessing an Alt modifier here would invent a key.
  expect(keyNotation('\u001b\u001bOP')).toBe('<Esc><F1>')
})

/** A UI with no transport: `send` only records what would go on the wire. */
function ui(options: { cols?: number; rows?: number } = {}): {
  session: NvimUi
  sent: Msgpack[]
  screens: () => number
} {
  const sent: Msgpack[] = []
  let screens = 0
  const session = new NvimUi({
    channel: {
      send: chunk => { sent.push(decodeMsgpack(chunk).values[0]!) },
      close: () => undefined,
      onData: () => undefined,
      onExit: () => undefined,
      onProblem: () => undefined,
    },
    cols: options.cols ?? 4,
    rows: options.rows ?? 2,
    color: true,
    onScreen: () => { screens += 1 },
    onExit: () => undefined,
  })
  return { session, sent, screens: () => screens }
}

/** One decoded redraw message carrying the given event groups. */
/** One redraw message; each call site passes `[name, ...params]`, and Neovim's
 * wire form wraps those parameters in a set of their own. */
function redraw(...groups: Msgpack[][]): Uint8Array {
  return encodeMsgpack([2, 'redraw', groups.map(([name, ...params]) => [name as Msgpack, params as Msgpack])])
}

test('grid_line paints cells, inheriting and repeating attributes', () => {
  const { session } = ui()
  session.feed(redraw(
    ['hl_attr_define', 1, { foreground: 0xff0000 }, {}, []],
    ['grid_line', 1, 0, 0, [['a', 1], ['b'], ['c', 1, 2]]],
    ['flush'],
  ))
  const lines = session.renderScreen(4, 2, 'none', '')
  expect(lines[0]?.startsWith('\u001b[0m\u001b[38;2;255;0;0mabc')).toBe(true)
  // The repeated cell is the same attribute twice: 'c' then the blank it covers.
  expect(lines[0]).toContain('abc '.slice(0, 3))
})

test('grid_resize clears the grid to the new size', () => {
  const { session } = ui()
  session.feed(redraw(['grid_line', 1, 0, 0, [['x']]], ['grid_resize', 1, 2, 1]))
  const lines = session.renderScreen(2, 1, 'none', '')
  expect(lines).toHaveLength(1)
  expect(lines[0]?.includes('x')).toBe(false)
})

test('a cursor cell is marked for the pane, and a dim one stays a ghost', () => {
  const { session } = ui()
  session.feed(redraw(['grid_line', 1, 0, 0, [['a', 0], ['b'], ['c'], ['d']]], ['grid_cursor_goto', 1, 0, 1]))
  const focused = session.renderScreen(4, 1, 'focused', '')
  expect(focused[0]).toContain('b')
  // The dim form replaces the glyph with the hollow block when no SGR is given.
  const dim = session.renderScreen(4, 1, 'dim', '')
  expect(dim[0]).toContain('□')
})

test('a session attaches itself first, then sends keys and pastes', () => {
  const { session, sent } = ui()
  expect(sent[0]).toEqual([0, 1, 'nvim_ui_attach', [4, 2, { ext_linegrid: true, rgb: true }]])
  session.input('i')
  session.input('\u001b[200~pasted\ntext\u001b[201~')
  expect(sent[1]).toEqual([0, 2, 'nvim_input', ['i']])
  expect(sent[2]).toEqual([0, 3, 'nvim_paste', ['pasted\ntext', false, -1]])
})

test('resize asks Neovim for the same grid the pane gave us', () => {
  const { session, sent } = ui()
  session.renderScreen(6, 3, 'none', '')
  expect(sent[1]).toEqual([0, 2, 'nvim_ui_try_resize', [6, 3]])
})

test('the mode drives the caret shape and the caller hears it', () => {
  let mode: string | undefined
  const { session } = ui()
  const listening = new NvimUi({
    channel: {
      send: () => undefined,
      close: () => undefined,
      onData: () => undefined,
      onExit: () => undefined,
      onProblem: () => undefined,
    },
    cols: 4,
    rows: 1,
    color: false,
    onScreen: () => undefined,
    onExit: () => undefined,
    onMode: next => { mode = next },
  })
  listening.feed(redraw(
    ['mode_info_set', true, [{ cursor_shape: 'block' }, { cursor_shape: 'vertical' }]],
    ['mode_change', 'insert', 1],
  ))
  // The UI protocol names the mode; the rest of the client reads the letter the
  // old marker file carried, so the session translates once.
  expect(mode).toBe('i')
  expect(listening.currentMode()).toBe('i')
  expect(listening.caretShape()).toBe('bar')
  expect(session.caretShape()).toBe('block')
})

test('an SGR pointer report becomes nvim_input_mouse, not key bytes', () => {
  const { session, sent } = ui()
  session.input('\u001b[<0;5;3M')
  expect(sent[1]).toEqual([0, 2, 'nvim_input_mouse', ['left', 'press', '', 0, 2, 4]])
  session.input('\u001b[<32;6;3M')
  expect(sent[2]).toEqual([0, 3, 'nvim_input_mouse', ['left', 'drag', '', 0, 2, 5]])
  session.input('\u001b[<0;6;3m')
  expect(sent[3]).toEqual([0, 4, 'nvim_input_mouse', ['left', 'release', '', 0, 2, 5]])
})

test('a wheel report is a wheel action, and modifiers travel with it', () => {
  expect(mouseRequest(64, 10, 4, true)).toEqual(['wheel', 'up', '', 0, 3, 9])
  expect(mouseRequest(65, 10, 4, true)).toEqual(['wheel', 'down', '', 0, 3, 9])
  expect(mouseRequest(16, 2, 2, true)).toEqual(['left', 'press', 'C', 0, 1, 1])
  expect(mouseRequest(64, 1, 1, false)).toBeUndefined()
})

test('a tree boundary from the Host is what the pane reports', () => {
  const { session } = ui()
  expect(session.treeEdge()).toBeUndefined()
  session.setTreeEdge(34)
  expect(session.treeEdge()).toBe(34)
})

test('grid_scroll moves cells inside the region and blanks what left it', () => {
  const { session } = ui({ cols: 4, rows: 3 })
  session.feed(redraw(
    ['grid_line', 1, 0, 0, [['a'], ['b'], ['c'], ['d']], false],
    ['grid_line', 1, 1, 0, [['e'], ['f'], ['g'], ['h']], false],
    ['grid_line', 1, 2, 0, [['i'], ['j'], ['k'], ['l']], false],
    // One line up: the top line scrolls away, the bottom line becomes blank.
    ['grid_scroll', 1, 0, 3, 0, 4, 1, 0],
  ))
  const plain = session.renderScreen(4, 3, 'none', '').map(line => line.replace(/\u001b\[[0-9;]*m/gu, ''))
  // Destination rows are [1,3): the top row is vacated, the bottom row's line is
  // gone, and nothing outside the region moved.
  expect(plain[0]?.trimEnd()).toBe('')
  expect(plain[1]?.trimEnd()).toBe('abcd')
  expect(plain[2]?.trimEnd()).toBe('efgh')
})

test('a horizontal scroll stays inside its columns', () => {
  const { session } = ui({ cols: 4, rows: 1 })
  session.feed(redraw(
    ['grid_line', 1, 0, 0, [['a'], ['b'], ['c'], ['d']], false],
    // Columns 1..3 move one to the left; column 0 is outside the region and keeps
    // its cell, which is what a `nowrap` viewport does around a long line.
    ['grid_scroll', 1, 0, 1, 1, 4, 0, 1],
  ))
  const line = session.renderScreen(4, 1, 'none', '').map(row => row.replace(/\u001b\[[0-9;]*m/gu, ''))[0]
  // Column 0 is outside the region and keeps its cell; the vacated column is
  // blank and the rest shift left.
  expect(line?.trimEnd()).toBe('a bc')
})
