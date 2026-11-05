/**
 * PromptEditor: pi-tui `Editor` with a Claude-style input arrow and an
 * upward-popping completion menu.
 *
 * The base `Editor` renders its autocomplete below the bottom border; this
 * subclass owns a small completion menu instead and renders it ABOVE the top
 * border, with the selected entry highlighted in the accent color.
 *
 * The base `Editor` also always draws a filled cursor, which stays visible as
 * pi-tui's reverse-video block. Without focus the cell is rewritten as the same
 * ghost block so the column still shows where its cursor is.
 *
 * The two rules are inset by the body's padding instead of spanning the column.
 * They belong to the composer, not to the frame: a rule that reached the column
 * edge would touch the divider the layout draws beside it, and this client keeps
 * every line clear of every other line.
 *
 * @module hulala-cli/tui/view/promptEditor
 */
import { readdir } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import {
  Editor,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type EditorOptions,
  type EditorTheme,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from '@earendil-works/pi-tui'
import { slashCommands, listMove } from '../keys.js'
import { buildStyles } from './theme.js'

interface MenuEntry {
  value: string
  description?: string
}

/** Fallback for the dim cursor when colour output is disabled. */
const HOLLOW_CURSOR = '□'

/**
 * pi-tui's fake-cursor APC markers (the pair `renderFakeCursor` wraps a cell
 * with). The base `Editor` always draws a filled cursor, and the renderer only
 * drops it for a focused component, so an unfocused composer is rewritten here.
 */
const FAKE_CURSOR = /\u001b_pi:fc\u0007(.*?)(?:\u001b_pi:\/fc\u0007|$)/s

export interface PromptEditorOptions extends EditorOptions {
  color: boolean
  /**
   * SGR for the faded cursor block shown without focus; `''` falls back
   * to a hollow glyph.
   */
  faintCursor?: () => string
}

/**
 * Blank `inset` cells off each end of a styled one-line rule.
 *
 * The base editor colours a whole border line as one run, so trimming visible
 * cells only has to step around the leading SGR and the trailing reset; the
 * blanked cells stay inside that run and are just background.
 * @param line - one border line from the base editor.
 * @param inset - cells to blank at each end.
 * @returns the line, inset from both edges.
 */
function insetRule(line: string, inset: number): string {
  const open = /^(?:\u001b\[[0-9;]*m)+/u.exec(line)?.[0] ?? ''
  const close = /(?:\u001b\[[0-9;]*m)+$/u.exec(line.slice(open.length))?.[0] ?? ''
  const body = line.slice(open.length, line.length - close.length)
  if (body.length <= inset * 2) return line
  return `${open}${' '.repeat(inset)}${body.slice(inset, body.length - inset)}${' '.repeat(inset)}${close}`
}

export class PromptEditor extends Editor {
  private readonly color: boolean
  private readonly faintCursor: (() => string) | undefined
  private readonly styles: ReturnType<typeof buildStyles>
  /**
   * Receive every submitted draft with the gesture that named its delivery
   * mode.
   *
   * `enter` is plain Enter (and the Send-equivalent path inside a completion
   * menu); `accelerated` is the queue chord, which the base editor would spend
   * on a newline — `\x1b\r` reaches it through the shift-enter workaround, so
   * the gesture has to be claimed here first, the same ordering pi's
   * `CustomEditor` uses for `app.message.followUp`. Both gestures submit
   * through the base editor, so trimming, paste expansion and the cleared
   * composer are identical.
   */
  onSubmitGesture: ((text: string, gesture: 'enter' | 'accelerated') => void) | undefined
  /** Which gesture the next base-editor submit belongs to. */
  private gesture: 'enter' | 'accelerated' = 'enter'
  private menu: MenuEntry[] | null = null
  private menuIndex = 0
  private menuStart = 0
  private menuToken = ''
  private requestId = 0
  private renderedMenuHeight = 0

  constructor(tui: TUI, theme: EditorTheme, options: PromptEditorOptions) {
    super(tui, theme, { paddingX: 2, ...options })
    this.color = options.color
    this.faintCursor = options.faintCursor
    this.styles = buildStyles(options.color)
    this.onSubmit = text => { this.onSubmitGesture?.(text, this.gesture) }
  }

  /**
   * The completion menu is up, so the dock gives its rows to the menu instead
   * of the working-directory line.
   */
  get completionMenuOpen(): boolean {
    return this.menu !== null && this.menu.length > 0
  }

  render(width: number): string[] {
    const menu = this.renderMenu(width)
    this.renderedMenuHeight = menu.length
    const base = super.render(width)
    // Without focus the filled cursor fades into a ghost (or a hollow glyph
    // when colour is off): the column still shows where its cursor is while the
    // keyboard is in the other one, without reading as the active caret.
    if (!this.focused) {
      const faint = this.faintCursor?.() ?? ''
      for (let index = 0; index < base.length; index += 1) {
        base[index] = (base[index] ?? '').replace(
          FAKE_CURSOR,
          (_whole, cell: string) => faint === '' ? HOLLOW_CURSOR : `\u001b[0m${faint}${cell}\u001b[0m`,
        )
      }
    }
    // Insert the Claude-style arrow into the first body line (two padding
    // columns are reserved by `paddingX: 2`, so the cursor column is stable).
    if (width >= 5 && base.length > 1) {
      const arrow = this.color ? '\u001b[36m❯\u001b[0m ' : '❯ '
      base[1] = arrow + (base[1] ?? '').slice(2)
    }
    // Both rules stop at the body's own gutter instead of the column edge. The
    // rules are the composer's, not the column's: a full-width rule would run
    // into the frame's dividers at both ends, and the transcript's own rows put
    // their content in this same column.
    const inset = Math.min(this.getPaddingX(), Math.max(0, Math.floor((width - 1) / 2)))
    if (inset > 0 && base.length > 2) {
      base[0] = insetRule(base[0] ?? '', inset)
      base[base.length - 1] = insetRule(base[base.length - 1] ?? '', inset)
    }
    return [...menu, ...base]
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    // The completion menu renders above the editor body: route pointer events
    // over it to the hovered entry, and shift the editor body down by the menu
    // height before delegating.
    if (this.menu !== null && this.renderedMenuHeight > 0 && event.y < this.renderedMenuHeight) {
      const index = event.y
      const changed = index >= 0 && index < this.menu.length && index !== this.menuIndex
      if (changed) {
        this.menuIndex = index
        this.tui.requestRender()
      }
      return { handled: true, focus: true, render: changed }
    }
    return super.handleMouse({ ...event, y: event.y - this.renderedMenuHeight })
  }

  handleInput(data: string): void {
    // The queue chord outranks both the completion menu and the base editor's
    // newline handling: it names a delivery mode, not more text. The submit
    // itself is the base editor's, so the composer clears exactly as Enter does.
    if (matchesKey(data, 'alt+enter')) {
      this.dismissMenu()
      this.gesture = 'accelerated'
      try {
        super.handleInput('\r')
      } finally {
        this.gesture = 'enter'
      }
      return
    }
    if (this.menu !== null) {
      if (matchesKey(data, 'tab')) {
        this.acceptCompletion()
        return
      }
      if (matchesKey(data, 'enter')) {
        // Matching pi-tui: Enter on a slash-command completion accepts it and
        // falls through to submit (so `/quit` + Enter quits immediately).
        const selected = this.menu[this.menuIndex]?.value ?? this.menu[0]?.value
        const submitAfter = selected?.startsWith('/') === true
        this.acceptCompletion()
        if (submitAfter) super.handleInput('\r')
        return
      }
      if (listMove(data, 'up')) {
        this.menuIndex = Math.max(0, this.menuIndex - 1)
        this.tui.requestRender()
        return
      }
      if (listMove(data, 'down')) {
        this.menuIndex = Math.min(this.menu.length - 1, this.menuIndex + 1)
        this.tui.requestRender()
        return
      }
      if (matchesKey(data, 'escape')) {
        this.dismissMenu()
        this.tui.requestRender()
        return
      }
    }

    if (matchesKey(data, 'tab') && this.menu === null) {
      this.refresh(true)
      return
    }

    super.handleInput(data)
    this.refresh(false)
  }

  /**
   * Close the completion menu and drop results still in flight.
   *
   * A submitted draft must not leave a completion to reopen the menu with an
   * entry the composer no longer holds.
   */
  private dismissMenu(): void {
    this.menu = null
    this.menuToken = ''
    this.requestId += 1
  }

  private renderMenu(width: number): string[] {
    if (this.menu === null || this.menu.length === 0) return []
    const items = this.menu.slice(0, 6)
    if (this.menuIndex >= items.length) this.menuIndex = 0
    return items.map((entry, index) => {
      const selected = index === this.menuIndex
      const label = entry.description === undefined ? entry.value : `${entry.value}  ${entry.description}`
      const clipped = truncateToWidth(label, Math.max(1, width - 2))
      const line = selected ? this.styles.accent(`❯ ${clipped}`) : `  ${clipped}`
      const missing = width - visibleWidth(line)
      return missing > 0 ? line + ' '.repeat(missing) : line
    })
  }

  private tokenUnderCursor(): { token: string; start: number } {
    const text = this.getText()
    const { line, col } = this.getCursor()
    if (line !== 0) return { token: '', start: -1 }
    const before = text.slice(0, col)
    const match = /(\S*)$/u.exec(before)
    const token = match?.[1] ?? ''
    return { token, start: col - token.length }
  }

  private providerKind(token: string, start: number): 'slash' | 'path' | null {
    if (start === 0 && token.startsWith('/')) return 'slash'
    if (isPathLike(token)) return 'path'
    return null
  }

  private refresh(force = false): void {
    const { token, start } = this.tokenUnderCursor()
    const kind = this.providerKind(token, start)
    if (kind === null) {
      this.menu = null
      this.menuToken = ''
      // Drop completions still in flight: a stale result would reopen the menu
      // after submit and make Enter accept the entry the composer no longer holds.
      this.requestId += 1
      return
    }
    if (!force && token === this.menuToken && this.menu !== null) return
    this.menuToken = token
    const requestId = ++this.requestId
    const result = kind === 'slash' ? Promise.resolve(this.completeSlash(token)) : this.completePath(token)
    void result.then(entries => {
      if (requestId !== this.requestId) return
      this.menu = entries.length === 0 ? null : entries
      this.menuIndex = 0
      this.menuStart = start
      if (this.menu !== null) this.tui.requestRender()
    })
  }

  private acceptCompletion(): void {
    const entry = this.menu?.[this.menuIndex] ?? this.menu?.[0]
    if (entry === undefined) return
    const text = this.getText()
    const cursor = this.getCursor().col
    const before = text.slice(0, this.menuStart)
    const after = text.slice(cursor)
    const trailing = entry.value.startsWith('/') && this.menuStart === 0 ? ' ' : ''
    this.setText(before + entry.value + trailing + after)
    this.dismissMenu()
    this.tui.requestRender()
  }

  private completeSlash(prefix: string): MenuEntry[] {
    const needle = prefix.toLowerCase()
    return slashCommands()
      .filter(command => `/${command.name}`.toLowerCase().startsWith(needle))
      .map(command => ({ value: `/${command.name}`, ...(command.description === undefined ? {} : { description: command.description }) }))
  }

  private async completePath(prefix: string): Promise<MenuEntry[]> {
    const home = process.env.HOME ?? '~'
    const expanded = prefix.startsWith('~') ? prefix.replace(/^~/, home) : prefix
    const absolute = isAbsolute(expanded) ? expanded : resolve(process.cwd(), expanded)
    const directory = dirname(absolute)
    const baseName = absolute.slice(directory.length + 1)
    const dirPrefix = prefix.slice(0, Math.max(0, prefix.length - baseName.length))
    let entries: string[]
    try {
      entries = await readdir(directory)
    } catch {
      return []
    }
    return entries
      .filter(name => !name.startsWith('.'))
      .map(name => ({ value: `${dirPrefix}${name}` }))
      .sort()
  }
}

function isPathLike(token: string): boolean {
  return token.startsWith('/') || token.startsWith('./') || token.startsWith('../') || token.startsWith('~')
}
