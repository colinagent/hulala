import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_BINDINGS,
  formatBindings,
  keyLabel,
  keymapPath,
  matchesAction,
  normalizeKeySpelling,
  parseKeymap,
  resolveKeymap,
  setActiveKeymap,
} from '../src/keymap.js'

/** A state root with no key file. */
function emptyRoot(): string {
  return mkdtempSync(join(tmpdir(), 'hulala-keymap-'))
}

/** A state root holding exactly this keybindings.json. */
function rootWith(contents: string): string {
  const root = emptyRoot()
  mkdirSync(join(root, 'config'), { recursive: true })
  writeFileSync(keymapPath(root), contents)
  return root
}

describe('defaults', () => {
  test('a missing file keeps every default and reports nothing', () => {
    const root = emptyRoot()
    try {
      const keymap = resolveKeymap(root)
      expect(keymap.problems).toEqual([])
      // One key per panel, and no second spelling: the cycle is the whole
      // gesture, so a fifth way to reach a panel would only be another way to
      // forget which one is current.
      expect(keymap.bindings['panel.rail']).toEqual(['ctrl+d'])
      expect(keymap.bindings['panel.chat']).toEqual(['ctrl+f'])
      expect(keymap.bindings['panel.terminal']).toEqual(['ctrl+t'])
      expect(keymap.bindings['panel.editor']).toEqual(['ctrl+g'])
      expect(keymap.bindings['panel.editorOnly']).toEqual(['ctrl+shift+g'])
      // `Ctrl-I` is the `Tab` byte, so it can never name a layout mode.
      expect(Object.values(keymap.bindings).flat()).not.toContain('ctrl+i')
      expect(keymap.bindings['panel.commands']).toEqual(['shift+super+k', 'ctrl+shift+p'])
      // `Ctrl-H` is nobody's layout key: it is the alternate backspace, and the
      // input pipeline projects both of its encodings onto Backspace
      // (`tui/plugins/input.ts`).
      expect(Object.values(keymap.bindings).flat()).not.toContain('ctrl+h')
      expect(Object.values(keymap.bindings).flat()).not.toContain('ctrl+l')
      expect(keymap.bindings['session.previous']).toEqual(['ctrl+,', 'ctrl+up', 'shift+super+up', 'ctrl+shift+up'])
      expect(keymap.bindings['session.next']).toEqual(['ctrl+.', 'ctrl+down', 'shift+super+down', 'ctrl+shift+down'])
      // The repair key gave up the plain control byte the move used to take.
      expect(keymap.bindings['app.redraw']).toEqual(['super+l', 'ctrl+shift+l'])
      expect(keymap.bindings['app.redraw']).not.toContain('ctrl+l')
      // The one pair that must never come back: `Ctrl-[` is the `Esc` byte.
      expect(Object.values(keymap.bindings).flat()).not.toContain('ctrl+[')
      expect(Object.values(keymap.bindings).flat()).not.toContain('ctrl+]')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('Ctrl-F is the conversation’s, and the composer lost its forward-char', () => {
    const keymap = parseKeymap({})
    expect(keymap.bindings['panel.chat']).toEqual(['ctrl+f'])
    // No other action may share it: one panel key, one owner.
    expect(Object.values(keymap.bindings).flat().filter(key => key === 'ctrl+f')).toEqual(['ctrl+f'])
  })

  test('an action the file does not mention keeps its default', () => {
    const keymap = parseKeymap({ 'panel.editor': ['ctrl+shift+e'] })
    expect(keymap.bindings['panel.editor']).toEqual(['ctrl+shift+e'])
    expect(keymap.bindings['panel.terminal']).toEqual(DEFAULT_BINDINGS['panel.terminal']!)
  })
})

describe('the user file', () => {
  test('a rebinding replaces the default and is matched as written', () => {
    const keymap = parseKeymap({ 'panel.editor': ['ctrl+shift+e'] })
    setActiveKeymap(keymap)
    expect(matchesAction('panel.editor', '\u001b[101;6u')).toBe(true)
    expect(matchesAction('panel.editorOnly', '\u0006')).toBe(false)
    setActiveKeymap(parseKeymap({}))
  })

  test('an empty list disables the action', () => {
    const keymap = parseKeymap({ 'panel.terminal': [] })
    expect(keymap.bindings['panel.terminal']).toEqual([])
    setActiveKeymap(keymap)
    expect(matchesAction('panel.terminal', '\u0014')).toBe(false)
    setActiveKeymap(parseKeymap({}))
  })

  test('modifier order is normalized so two spellings of one chord collide', () => {
    expect(normalizeKeySpelling('Shift+Super+S')).toBe('shift+super+s')
    expect(normalizeKeySpelling('super+shift+s')).toBe('shift+super+s')
    expect(normalizeKeySpelling('PgUp')).toBe('pageup')
    // The spelling the hints print can be pasted straight into the file.
    expect(normalizeKeySpelling('Shift-Cmd-S')).toBe('shift+super+s')
    expect(normalizeKeySpelling('Cmd-I')).toBe('super+i')
    expect(normalizeKeySpelling('ctrl+option+t')).toBe('ctrl+alt+t')
    const keymap = parseKeymap({ 'panel.rail': ['super+shift+s'], 'panel.chat': ['shift+super+s'] })
    expect(keymap.problems).toContainEqual({ kind: 'duplicate', key: 'shift+super+s', first: 'panel.rail', second: 'panel.chat' })
  })

  test('typos and unknown actions are reported, not swallowed', () => {
    const root = rootWith(JSON.stringify({
      'panel.editor': ['ctrl+f'],
      'panel.contorl': ['ctrl+x'],
      'panel.terminal': ['ctrl+', 'ctrl+shft+t'],
      'panel.rail': 'ctrl+g',
    }))
    try {
      const problems = resolveKeymap(root).problems
      expect(problems).toContainEqual({ kind: 'unknownAction', action: 'panel.contorl' })
      expect(problems).toContainEqual({ kind: 'badKey', action: 'panel.terminal', key: 'ctrl+' })
      expect(problems).toContainEqual({ kind: 'badKeys', action: 'panel.rail' })
      // A rejected line falls back to the default it would have replaced.
      expect(resolveKeymap(root).bindings['panel.terminal']).toEqual(['ctrl+t'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a file that disables every exit keeps the defaults for it', () => {
    const keymap = parseKeymap({ 'app.quit': [], 'app.interrupt': [], 'app.cancel': [] })
    expect(keymap.problems).toContainEqual({ kind: 'noExit' })
    expect(keymap.bindings['app.quit']).toEqual(['ctrl+q'])
    expect(keymap.bindings['app.interrupt']).toEqual(['escape'])
  })

  test('broken JSON is a problem, not a crash', () => {
    const root = rootWith('{ nope')
    try {
      const keymap = resolveKeymap(root)
      expect(keymap.problems[0]?.kind).toBe('malformed')
      expect(keymap.bindings['panel.editor']).toEqual(['ctrl+g'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('pi-tui’s own binding ids pass through to the composer', () => {
    const keymap = parseKeymap({ 'tui.editor.cursorUp': ['ctrl+k'] })
    expect(keymap.problems).toEqual([])
    expect(keymap.editorBindings['tui.editor.cursorUp']).toEqual(['ctrl+k'])
  })
})

describe('labels', () => {
  test('a chord prints the way the docs write it', () => {
    expect(keyLabel('ctrl+t')).toBe('Ctrl-T')
    expect(keyLabel('shift+super+s')).toBe('Shift-Cmd-S')
    expect(keyLabel('super+i')).toBe('Cmd-I')
    expect(keyLabel('ctrl+shift+left')).toBe('Ctrl-Shift-←')
    expect(keyLabel('escape')).toBe('Esc')
  })

  test('an action prints its keys joined, and nothing when disabled', () => {
    expect(formatBindings(['ctrl+shift+left', 'ctrl+shift+['])).toBe('Ctrl-Shift-← / Ctrl-Shift-[')
    expect(formatBindings([])).toBe('')
  })
})
