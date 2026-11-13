import { expect, test } from 'bun:test'
import { matchesKey, visibleWidth, type TUI, type TuiMouseEvent } from '@earendil-works/pi-tui'
import { PromptEditor } from '../../src/tui/view/promptEditor.js'
import { buildTheme } from '../../src/tui/view/theme.js'

function makeEditor(): { editor: PromptEditor } {
  const tui = {
    terminal: { rows: 24, columns: 80 },
    requestRender: () => undefined,
  } as unknown as TUI
  return { editor: new PromptEditor(tui, buildTheme(false).editor, { color: false }) }
}

function type(editor: PromptEditor, text: string): void {
  for (const char of text) editor.handleInput(char)
}

function mouse(event: Partial<TuiMouseEvent>): TuiMouseEvent {
  return {
    type: 'move',
    button: 'none',
    x: 0,
    y: 0,
    screenX: 0,
    screenY: 0,
    width: 80,
    height: 10,
    shift: false,
    alt: false,
    ctrl: false,
    ...event,
  } as TuiMouseEvent
}

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

test('renders a Claude-style arrow in the first body line', () => {
  const { editor } = makeEditor()
  const lines = editor.render(80)
  expect(lines[1]).toContain('❯ ')
})

test('typing "/" pops the slash menu above the input', async () => {
  const { editor } = makeEditor()
  type(editor, '/')
  await settle()
  const lines = editor.render(80)
  // The menu renders above the border (line 0), before the editor's top rule.
  expect(lines[0]).toContain('/help')
  expect(lines.some(line => line.includes('❯ /help'))).toBe(true)
})

test('completionMenuOpen follows the slash menu', async () => {
  const { editor } = makeEditor()
  expect(editor.completionMenuOpen).toBe(false)
  type(editor, '/')
  await settle()
  expect(editor.completionMenuOpen).toBe(true)
  editor.handleInput('\u001b') // Escape closes the menu
  expect(editor.completionMenuOpen).toBe(false)
})

test('hovering the menu leaves the selection alone, as pi does', async () => {
  const { editor } = makeEditor()
  type(editor, '/')
  await settle()
  editor.render(80) // render once so the menu height is recorded for hit-testing
  editor.handleMouse(mouse({ type: 'move', y: 1 }))
  expect(editor.render(80).some(line => line.includes('❯ /help'))).toBe(true)
})

test('a left press selects the row under the pointer', async () => {
  const { editor } = makeEditor()
  type(editor, '/')
  await settle()
  editor.render(80)
  editor.handleMouse(mouse({ type: 'press', button: 'left', y: 1 }))
  expect(editor.render(80).some(line => line.includes('❯ /sessions'))).toBe(true)
})

test('Tab accepts the selected slash command', async () => {
  const { editor } = makeEditor()
  type(editor, '/res')
  await settle()
  editor.handleInput('\t')
  expect(editor.getText()).toBe('/resume ')
})

test('Enter on a slash completion accepts and submits it', async () => {
  const tui = { terminal: { rows: 24, columns: 80 }, requestRender: () => undefined } as unknown as TUI
  const editor = new PromptEditor(tui, buildTheme(false).editor, { color: false })
  const submitted: string[] = []
  editor.onSubmit = text => { submitted.push(text) }
  type(editor, '/quit')
  await settle()
  editor.handleInput('\r') // Enter
  expect(submitted.map(text => text.trim())).toEqual(['/quit'])
  expect(editor.getText()).toBe('')
})

test('matchesKey still parses Enter correctly for the editor submit path', () => {
  expect(matchesKey('\r', 'enter')).toBe(true)
  expect(matchesKey('\t', 'tab')).toBe(true)
})

test('an unfocused composer dims its cursor instead of removing it', () => {
  const { editor } = makeEditor()
  editor.focused = false
  const unfocused = editor.render(80).join('\n')
  // `makeEditor` has no faint-cursor SGR, so the fallback glyph is used.
  expect(unfocused).toContain('□')
  expect(unfocused).not.toContain('\u001b_pi:fc\u0007')
  expect(unfocused).not.toContain('\u001b_pi:c\u0007')
  editor.focused = true
  const focused = editor.render(80).join('\n')
  expect(focused).toContain('\u001b_pi:fc\u0007')
  expect(focused).toContain('\u001b_pi:c\u0007')
  expect(focused).not.toContain('□')
})

test('an unfocused composer uses the dim block SGR when colour is on', () => {
  const tui = { terminal: { rows: 24, columns: 80 }, requestRender: () => undefined } as unknown as TUI
  const faint = '\u001b[48;2;120;120;120m\u001b[38;2;20;20;20m'
  const editor = new PromptEditor(tui, buildTheme(true).editor, { color: true, faintCursor: () => faint })
  editor.focused = false
  const line = editor.render(80)[1] ?? ''
  expect(line).toContain(faint)
  expect(line).not.toContain('□')
  expect(line).not.toContain('\u001b_pi:fc\u0007')
  editor.focused = true
  // Focused, the cursor is pi-tui's reverse-video block again.
  const focused = editor.render(80)[1] ?? ''
  expect(focused).toContain('\u001b_pi:fc\u0007')
  expect(focused).not.toContain(faint)
})

test('Ctrl-N and Ctrl-P move the completion menu like the arrow keys', async () => {
  const { editor } = makeEditor()
  type(editor, '/')
  await settle()
  editor.handleInput('\u000e') // Ctrl-N: /sessions
  expect(editor.render(80).some(line => line.includes('❯ /sessions'))).toBe(true)
  editor.handleInput('\u0010') // Ctrl-P: back to /help
  expect(editor.render(80).some(line => line.includes('❯ /help'))).toBe(true)
})

test('the menu window follows the selection and reports its position', async () => {
  const { editor } = makeEditor()
  type(editor, '/')
  await settle()
  for (let index = 0; index < 6; index += 1) editor.handleInput('\u001b[B') // Down
  const lines = editor.render(80)
  // pi's `(selected/total)` line, under a window that slid with the selection.
  expect(lines.some(line => line.includes('(7/26)'))).toBe(true)
  expect(lines.some(line => line.includes('❯ /permission'))).toBe(true)
  // The first matches scrolled out instead of clipping the selection away.
  expect(lines.some(line => line.includes('/help'))).toBe(false)
})

test('Up from the first match wraps to the last, as pi does', async () => {
  const { editor } = makeEditor()
  type(editor, '/')
  await settle()
  editor.handleInput('\u001b[A') // Up at the top
  const lines = editor.render(80)
  expect(lines.some(line => line.includes('❯ /quit'))).toBe(true)
  expect(lines.some(line => line.includes('(26/26)'))).toBe(true)
})

test('PageDown moves one window at a time and PageUp clamps at the top', async () => {
  const { editor } = makeEditor()
  type(editor, '/')
  await settle()
  editor.handleInput('\u001b[6~') // PageDown
  const paged = editor.render(80)
  expect(paged.some(line => line.includes('❯ /thinking'))).toBe(true)
  expect(paged.some(line => line.includes('(6/26)'))).toBe(true)
  editor.handleInput('\u001b[5~') // PageUp
  expect(editor.render(80).some(line => line.includes('❯ /help'))).toBe(true)
  editor.handleInput('\u001b[5~') // Already at the top: clamped, not wrapped
  expect(editor.render(80).some(line => line.includes('(1/26)'))).toBe(true)
})

test('the wheel moves the menu one entry per notch', async () => {
  const { editor } = makeEditor()
  type(editor, '/')
  await settle()
  editor.render(80)
  editor.handleMouse(mouse({ type: 'wheel', wheelDelta: 1, y: 2 }))
  editor.handleMouse(mouse({ type: 'wheel', wheelDelta: 1, y: 2 }))
  expect(editor.render(80).some(line => line.includes('❯ /new'))).toBe(true)
  editor.handleMouse(mouse({ type: 'wheel', wheelDelta: -1, y: 2 }))
  expect(editor.render(80).some(line => line.includes('❯ /sessions'))).toBe(true)
})

test('a click on a menu row accepts it', async () => {
  const { editor } = makeEditor()
  type(editor, '/')
  await settle()
  editor.render(80)
  editor.handleMouse(mouse({ type: 'click', button: 'left', y: 1 }))
  expect(editor.getText()).toBe('/sessions ')
  expect(editor.completionMenuOpen).toBe(false)
})

test('a click maps the scrolled window back to the list', async () => {
  const { editor } = makeEditor()
  type(editor, '/')
  await settle()
  for (let index = 0; index < 6; index += 1) editor.handleInput('\u001b[B')
  editor.render(80) // window starts at /model with /login selected
  editor.handleMouse(mouse({ type: 'click', button: 'left', y: 0 }))
  expect(editor.getText()).toBe('/model ')
})

test('the counter is hidden while every match fits', async () => {
  const { editor } = makeEditor()
  type(editor, '/quit')
  await settle()
  const lines = editor.render(80)
  expect(lines.some(line => line.includes('❯ /quit'))).toBe(true)
  expect(lines.some(line => line.includes('(1/1)'))).toBe(false)
})

test('a slash row ends with the command’s shortcut', async () => {
  const { editor } = makeEditor()
  type(editor, '/editor')
  await settle()
  const row = editor.render(80).find(line => line.includes('/editor')) ?? ''
  // The shortcut column is what a reader came for; the description gives way.
  expect(row).toContain('Ctrl-D')
  expect(visibleWidth(row)).toBeLessThanOrEqual(80)
  expect(row.indexOf('Ctrl-D')).toBeGreaterThan(row.indexOf('nvim'))
})

test('an argument hint leads the description column, as in pi', async () => {
  const { editor } = makeEditor()
  type(editor, '/thinking')
  await settle()
  const line = editor.render(80).find(row => row.includes('[level]')) ?? ''
  expect(line).toContain('[level] — set the thinking level')
})

test('the terminal is told when the menu takes the paging keys', async () => {
  const states: boolean[] = []
  const tui = { terminal: { rows: 24, columns: 80 }, requestRender: () => undefined } as unknown as TUI
  const editor = new PromptEditor(tui, buildTheme(false).editor, {
    color: false,
    onMenuOpen: open => { states.push(open) },
  })
  type(editor, '/')
  await settle()
  expect(states).toEqual([true])
  editor.handleInput('\u001b') // Escape closes the menu
  expect(states).toEqual([true, false])
})
