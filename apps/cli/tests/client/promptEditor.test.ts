import { expect, test } from 'bun:test'
import { matchesKey, type TUI, type TuiMouseEvent } from '@earendil-works/pi-tui'
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

test('mouse hover over the menu moves the selection', async () => {
  const { editor } = makeEditor()
  type(editor, '/')
  await settle()
  editor.render(80) // render once so the menu height is recorded for hit-testing
  editor.handleMouse(mouse({ type: 'move', y: 1 }))
  const lines = editor.render(80)
  // The second entry is selected after hovering the second row.
  expect(lines.some(line => line.includes('❯ /sessions'))).toBe(true)
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
