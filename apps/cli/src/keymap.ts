/**
 * The client's keybindings: the defaults, the user's file, and the validation.
 *
 * Every chord hulala itself intercepts is an *action* here, so the input pipeline
 * never spells a key twice and the startup hints and `/help` can print the keys
 * that are actually in force. A terminal only reports what its keyboard encoding
 * allows, which is why the defaults lean on Command for the three column keys a
 * Kitty-protocol terminal can deliver and on `Ctrl-` for everything that has to
 * work everywhere.
 *
 * The user's file is `<stateRoot>/config/keybindings.json`:
 *
 * ```json
 * { "panel.editor": ["ctrl+d"], "panel.rail": ["shift+super+s"] }
 * ```
 *
 * A value is a list of `matchesKey` spellings; an empty list disables the action;
 * an action the file does not mention keeps its default. `tui.*` ids from pi-tui's
 * own binding table are accepted too, so the composer's editing gestures are the
 * user's to change, but they are handed to pi-tui rather than matched here.
 *
 * Spellings are normalized before they are compared, and the label form the hints
 * print is a spelling too: `Shift-Cmd-S`, `Shift+Super+S` and `super+shift+s` all
 * name the same chord, as do `Cmd-E` and `meta+e`. That is deliberate — `/keys`
 * and the command palette print labels, and a reader copying one out of them
 * should not have to translate it.
 *
 * Nothing here throws: a broken file is a list of problems the client reports and
 * then ignores, and at least one way out of the window always survives.
 *
 * @module hulala-cli/keymap
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TUI_KEYBINDINGS, matchesKey } from '@earendil-works/pi-tui'
import type { MessageKey } from './tui/i18n/messages.js'

/** One chord the client intercepts, with the keys it answers to by default. */
export interface KeyActionDefinition {
  readonly id: string
  /** The `matchesKey` spellings bound out of the box. */
  readonly defaults: readonly string[]
  /** One line describing what the action does, for `/keys` and `/help`. */
  readonly label: MessageKey
}

/**
 * Every action the client intercepts, in help order.
 *
 * The ids are the configuration keys, so they are also the schema: renaming one
 * is a breaking change to the user's file.
 */
export const KEY_ACTIONS: readonly KeyActionDefinition[] = [
  { id: 'app.quit', defaults: ['ctrl+q'], label: 'keymap.action.quit' },
  { id: 'app.interrupt', defaults: ['escape'], label: 'keymap.action.interrupt' },
  { id: 'app.cancel', defaults: ['ctrl+c'], label: 'keymap.action.cancel' },
  { id: 'app.thinking', defaults: ['shift+tab'], label: 'keymap.action.thinking' },
  { id: 'app.dequeue', defaults: ['alt+up'], label: 'keymap.action.dequeue' },
  { id: 'app.pasteImage', defaults: ['ctrl+v'], label: 'keymap.action.pasteImage' },
  { id: 'app.expand', defaults: ['ctrl+o'], label: 'keymap.action.expand' },
  { id: 'app.redraw', defaults: ['ctrl+l'], label: 'keymap.action.redraw' },
  { id: 'panel.focusLeft', defaults: ['ctrl+['], label: 'keymap.action.focusLeft' },
  { id: 'panel.focusRight', defaults: ['ctrl+]'], label: 'keymap.action.focusRight' },
  { id: 'panel.rail', defaults: ['shift+super+s'], label: 'keymap.action.rail' },
  { id: 'panel.chat', defaults: ['shift+super+c'], label: 'keymap.action.chat' },
  { id: 'panel.terminal', defaults: ['ctrl+t'], label: 'keymap.action.terminal' },
  { id: 'panel.editor', defaults: ['ctrl+d'], label: 'keymap.action.editor' },
  { id: 'panel.editorOnly', defaults: ['super+e'], label: 'keymap.action.editorOnly' },
  { id: 'panel.commands', defaults: ['shift+super+p'], label: 'keymap.action.commands' },
  {
    id: 'panel.dividerLeft',
    defaults: ['ctrl+shift+left', 'ctrl+shift+[', 'ctrl+super+['],
    label: 'keymap.action.dividerLeft',
  },
  {
    id: 'panel.dividerRight',
    defaults: ['ctrl+shift+right', 'ctrl+shift+]', 'ctrl+super+]'],
    label: 'keymap.action.dividerRight',
  },
]

/** Every default spelling, by action id. */
export const DEFAULT_BINDINGS: Readonly<Record<string, readonly string[]>> =
  Object.fromEntries(KEY_ACTIONS.map(action => [action.id, action.defaults]))

/** Why one line of the user's file was not used. */
export type KeymapProblem =
  | { readonly kind: 'unreadable'; readonly reason: string }
  | { readonly kind: 'malformed'; readonly reason: string }
  | { readonly kind: 'unknownAction'; readonly action: string }
  | { readonly kind: 'badKeys'; readonly action: string }
  | { readonly kind: 'badKey'; readonly action: string; readonly key: string }
  | { readonly kind: 'duplicate'; readonly key: string; readonly first: string; readonly second: string }
  | { readonly kind: 'noExit' }

/** The bindings in force plus every reason the file was not taken verbatim. */
export interface Keymap {
  /** Action id → normalized spellings. An empty list means "disabled". */
  readonly bindings: Readonly<Record<string, readonly string[]>>
  /** `tui.*` overrides for pi-tui's own binding table, already normalized. */
  readonly editorBindings: Readonly<Record<string, readonly string[]>>
  readonly problems: readonly KeymapProblem[]
}

/** The actions that keep the window escapable, at least one of which must stay. */
const EXIT_ACTIONS = ['app.quit', 'app.interrupt', 'app.cancel'] as const

/** Named keys `matchesKey` understands, spelled the way the configuration does. */
const NAMED_KEYS: ReadonlySet<string> = new Set([
  'escape', 'enter', 'tab', 'space', 'backspace', 'delete', 'insert', 'clear',
  'home', 'end', 'pageup', 'pagedown', 'up', 'down', 'left', 'right',
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
])

/** Spellings people type for a named key, folded onto the canonical name. */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  esc: 'escape', return: 'enter', del: 'delete', ins: 'insert', bs: 'backspace',
  pgup: 'pageup', pgdn: 'pagedown', spacebar: 'space',
}

/** Modifier spellings people type, folded onto the canonical token. */
const MODIFIER_ALIASES: Readonly<Record<string, string>> = {
  control: 'ctrl', cmd: 'super', command: 'super', option: 'alt', opt: 'alt', meta: 'alt',
}

/** Modifier tokens, in the order a normalized spelling writes them. */
const MODIFIERS = ['ctrl', 'alt', 'shift', 'super'] as const

/** Pretty names for the keys a hint column prints. */
const KEY_LABELS: Readonly<Record<string, string>> = {
  escape: 'Esc', enter: 'Enter', tab: 'Tab', space: 'Space', backspace: 'Backspace',
  delete: 'Delete', insert: 'Insert', clear: 'Clear', home: 'Home', end: 'End',
  pageup: 'PgUp', pagedown: 'PgDn', up: '↑', down: '↓', left: '←', right: '→',
}

/** Pretty names for the four modifiers. */
const MODIFIER_LABELS: Readonly<Record<string, string>> = {
  ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', super: 'Cmd',
}

/**
 * Normalize one configured spelling.
 *
 * The point is not to reimplement `matchesKey`: it is to reject what a person
 * would call a typo (`ctrl+`, `shift+shft+a`, `contorl+a`) before it silently
 * binds a key that never fires. Modifier order is fixed so two spellings of the
 * same chord collide in the duplicate check.
 * @param spelling - one entry from the file.
 * @returns the normalized spelling, or undefined when it names no key.
 */
export function normalizeKeySpelling(spelling: string): string | undefined {
  const text = spelling.trim().toLowerCase()
  // The hints print chords as `Shift-Cmd-S`; a reader copying one out of `/keys`
  // should not have to rewrite it into the plus form.
  const parts = (text.includes('+') ? text.split('+') : text.split('-'))
  if (parts.length === 0) return undefined
  // A doubled trailing `+` is a literal plus: `ctrl++` means Ctrl and the plus
  // key. A single trailing `+` (`ctrl+`) is a typo and stays one.
  const last = parts.length - 1
  if (last > 0 && parts[last] === '' && parts[last - 1] === '') parts[last] = '+'
  const raw = parts.pop() ?? ''
  if (raw === '') return undefined
  const base = KEY_ALIASES[raw] ?? raw
  if (parts.includes('')) return undefined
  const seen = new Set<string>()
  for (const raw of parts) {
    const part = MODIFIER_ALIASES[raw] ?? raw
    if (!MODIFIERS.includes(part as typeof MODIFIERS[number]) || seen.has(part)) return undefined
    seen.add(part)
  }
  const isNamed = NAMED_KEYS.has(base)
  const isChar = [...base].length === 1 && base !== '+'
  // `raw` could only reach here as `+` through the doubled-trailing rule.
  const isPlus = raw === '+'
  if (!isNamed && !isChar && !isPlus) return undefined
  const modifiers = MODIFIERS.filter(modifier => seen.has(modifier))
  return [...modifiers, base].join('+')
}

/**
 * Read the user's file without throwing.
 *
 * A missing file is the ordinary case, not a problem. A file that cannot be read
 * or parsed is reported so `/keys` can say why the keys did not change instead of
 * silently keeping the defaults.
 * @param dataRoot - the Hulala state root.
 * @returns the parsed document, or the reason there is none.
 */
export function readKeymapFile(dataRoot: string): { document?: Record<string, unknown>; problems: readonly KeymapProblem[] } {
  let text: string
  try {
    text = readFileSync(keymapPath(dataRoot), 'utf8')
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === 'ENOENT') return { problems: [] }
    return { problems: [{ kind: 'unreadable', reason: caught instanceof Error ? caught.message : String(caught) }] }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (caught) {
    return { problems: [{ kind: 'malformed', reason: caught instanceof Error ? caught.message : String(caught) }] }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { problems: [{ kind: 'malformed', reason: 'the file is not an object' }] }
  }
  return { document: parsed as Record<string, unknown>, problems: [] }
}

/** Path of the keybinding file for one state root. */
export function keymapPath(dataRoot: string): string {
  return join(dataRoot, 'config', 'keybindings.json')
}

/**
 * Merge one parsed document over the defaults.
 *
 * Order matters: an early line wins a duplicated chord, and the last problem of a
 * rejected line is reported rather than hidden.
 * @param document - the parsed file, already known to be an object.
 * @returns the effective bindings and every problem worth reporting.
 */
export function parseKeymap(document: Record<string, unknown>): Keymap {
  const problems: KeymapProblem[] = []
  const bindings: Record<string, string[]> = {}
  const editorBindings: Record<string, string[]> = {}
  /** Normalized spelling → action id, so one chord cannot serve two actions. */
  const taken = new Map<string, string>()

  /**
   * Give one chord to one action, or report the clash.
   *
   * A default takes the check as well: a user line may have claimed a chord that
   * another action's default would otherwise duplicate, and two actions answering
   * the same key is exactly the silent ambiguity the check exists to prevent.
   */
  const claim = (key: string, action: string): boolean => {
    const owner = taken.get(key)
    if (owner !== undefined) {
      problems.push({ kind: 'duplicate', key, first: owner, second: action })
      return false
    }
    taken.set(key, action)
    return true
  }

  for (const action of KEY_ACTIONS) {
    const value = document[action.id]
    if (value === undefined) {
      bindings[action.id] = action.defaults.filter(key => claim(key, action.id))
      continue
    }
    const parsed = parseActionValue(action.id, value, problems)
    if (parsed === undefined) {
      bindings[action.id] = action.defaults.filter(key => claim(key, action.id))
      continue
    }
    bindings[action.id] = parsed.filter(key => claim(key, action.id))
  }

  for (const [id, value] of Object.entries(document)) {
    if (id in DEFAULT_BINDINGS) continue
    if (!Object.hasOwn(TUI_KEYBINDINGS as unknown as Record<string, unknown>, id)) {
      problems.push({ kind: 'unknownAction', action: id })
      continue
    }
    const parsed = parseActionValue(id, value, problems)
    if (parsed !== undefined) editorBindings[id] = parsed
  }

  const escapable = EXIT_ACTIONS.some(action => (bindings[action]?.length ?? 0) > 0)
  if (!escapable) {
    problems.push({ kind: 'noExit' })
    for (const action of EXIT_ACTIONS) bindings[action] = [...DEFAULT_BINDINGS[action]!]
  }
  return { bindings, editorBindings, problems }
}

/** One action's value: an array of normalized spellings, or undefined when rejected. */
function parseActionValue(action: string, value: unknown, problems: KeymapProblem[]): string[] | undefined {
  if (!Array.isArray(value)) {
    problems.push({ kind: 'badKeys', action })
    return undefined
  }
  const keys: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') {
      problems.push({ kind: 'badKeys', action })
      return undefined
    }
    const normalized = normalizeKeySpelling(entry)
    if (normalized === undefined) {
      problems.push({ kind: 'badKey', action, key: entry })
      return undefined
    }
    if (!keys.includes(normalized)) keys.push(normalized)
  }
  return keys
}

/**
 * Resolve the bindings for this launch.
 * @param dataRoot - the Hulala state root.
 * @returns the effective bindings and any problems to report.
 */
export function resolveKeymap(dataRoot: string): Keymap {
  const read = readKeymapFile(dataRoot)
  if (read.document === undefined) {
    const merged = parseKeymap({})
    return { ...merged, problems: [...read.problems, ...merged.problems] }
  }
  const merged = parseKeymap(read.document)
  return { ...merged, problems: [...read.problems, ...merged.problems] }
}

/**
 * The one line a `matchesKey` spelling prints as.
 * @param spelling - a normalized (or default) spelling.
 * @returns the label, e.g. `Ctrl-T`, `Shift-Cmd-S`, `Cmd-Ctrl-[`.
 */
export function keyLabel(spelling: string): string {
  const parts = spelling.split('+')
  const base = parts.pop() ?? spelling
  const named = NAMED_KEYS.has(base) ? (KEY_LABELS[base] ?? base) : base.toUpperCase()
  return [...parts.map(part => MODIFIER_LABELS[part] ?? part), named].join('-')
}

/**
 * Render a binding for a hint column.
 * @param keys - the spellings to print.
 * @returns the labels joined with ` / `, or an empty string when disabled.
 */
export function formatBindings(keys: readonly string[]): string {
  return keys.map(keyLabel).join(' / ')
}

/** The bindings in force for this process. */
let active: Keymap = parseKeymap({})

/**
 * How many times the bindings changed.
 *
 * Anything that renders a key name and caches its output (the startup banner)
 * keys its cache on this, so `/keys` reloading the file repaints the hints instead
 * of leaving the old ones on screen.
 */
let version = 0

/** Swap the bindings every later key check reads. */
export function setActiveKeymap(keymap: Keymap): void {
  active = keymap
  version += 1
}

/** The current binding generation, for caches that print key names. */
export function keymapVersion(): number {
  return version
}

/** The bindings in force, for `/keys`, `/help` and the startup hints. */
export function activeKeymap(): Keymap {
  return active
}

/**
 * Whether one input event is this action.
 * @param id - an action id from `KEY_ACTIONS`.
 * @param data - one raw input event.
 * @returns true when any of the action's keys produced the event.
 */
export function matchesAction(id: string, data: string): boolean {
  const keys = active.bindings[id]
  if (keys === undefined || keys.length === 0) return false
  return keys.some(key => matchesKey(data, key as Parameters<typeof matchesKey>[1]))
}

/**
 * The keys bound to one action.
 * @param id - an action id from `KEY_ACTIONS`.
 * @returns the spellings, empty when the action is disabled.
 */
export function actionKeys(id: string): readonly string[] {
  return active.bindings[id] ?? []
}

/**
 * The label printed in a hint column for one action.
 * @param id - an action id from `KEY_ACTIONS`.
 * @returns the formatted bindings, or an empty string when there are none.
 */
export function actionHint(id: string): string {
  return formatBindings(actionKeys(id))
}

/** The `tui.*` overrides the composer should install into pi-tui's table. */
export function editorBindingOverrides(): Readonly<Record<string, readonly string[]>> {
  return active.editorBindings
}
