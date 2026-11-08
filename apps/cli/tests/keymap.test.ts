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
      expect(keymap.bindings['panel.editor']).toEqual(['ctrl+d'])
      expect(keymap.bindings['panel.editorOnly']).toEqual(['super+e'])
      expect(keymap.bindings['panel.rail']).toEqual(['shift+super+s'])
      expect(keymap.bindings['panel.chat']).toEqual(['shift+super+c'])
      expect(keymap.bindings['panel.commands']).toEqual(['shift+super+p'])
      expect(keymap.bindings['panel.terminal']).toEqual(['ctrl+t'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('Ctrl-F is nobody’s: the editor column left it to the programs', () => {
    const keymap = parseKeymap({})
    expect(Object.values(keymap.bindings).flat()).not.toContain('ctrl+f')
  })

  test('an action the file does not mention keeps its default', () => {
    const keymap = parseKeymap({ 'panel.editor': ['ctrl+f'] })
    expect(keymap.bindings['panel.editor']).toEqual(['ctrl+f'])
    expect(keymap.bindings['panel.terminal']).toEqual(DEFAULT_BINDINGS['panel.terminal']!)
  })
})

describe('the user file', () => {
  test('a rebinding replaces the default and is matched as written', () => {
    const keymap = parseKeymap({ 'panel.editor': ['ctrl+f'] })
    setActiveKeymap(keymap)
    expect(matchesAction('panel.editor', '\u0006')).toBe(true)
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
    expect(normalizeKeySpelling('Cmd-E')).toBe('super+e')
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
      expect(keymap.bindings['panel.editor']).toEqual(['ctrl+d'])
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
    expect(keyLabel('super+e')).toBe('Cmd-E')
    expect(keyLabel('ctrl+shift+left')).toBe('Ctrl-Shift-←')
    expect(keyLabel('escape')).toBe('Esc')
  })

  test('an action prints its keys joined, and nothing when disabled', () => {
    expect(formatBindings(['ctrl+shift+left', 'ctrl+shift+['])).toBe('Ctrl-Shift-← / Ctrl-Shift-[')
    expect(formatBindings([])).toBe('')
  })
})
