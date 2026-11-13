/**
 * `/remote`: which machine this window should attach to.
 *
 * The rows are the user's own ssh aliases plus this machine, so the list is the
 * one thing they can verify: the names they already type. Selection follows the
 * frame's rule — the cursor row's label takes the highlight ink, never a filled
 * background — and the current machine is marked so a switch cannot be confused
 * with a refresh.
 *
 * @module hulala-cli/tui/view/selector/host
 */
import {
  Container,
  Spacer,
  TruncatedText,
  matchesKey,
  visibleWidth,
  type Focusable,
} from '@earendil-works/pi-tui'
import { listMove } from '../../keys.js'
import { buildStyles } from '../theme.js'
import { Rule, listCapacity, scrollLabel, windowOf } from './chrome.js'
import type { ImePolicy } from '../../pane/focus.js'

/** Rows the frame takes around the list: rules, spacers, title and hint. */
const CHROME_ROWS = 8

export interface HostSelectorOptions {
  /** ssh destinations, in the user's own config order. */
  readonly hosts: readonly string[]
  /** The destination this window used, when it is not this machine. */
  readonly current?: string | undefined
  /** Label for this machine, in the user's language. */
  readonly local: string
  readonly title: string
  readonly hint: string
  readonly empty: string
  readonly color: boolean
  /** Terminal rows, so a short terminal still shows the composer area. */
  rows(): number
  /** Called with `''` for this machine, or with the chosen alias. */
  onResolve(alias: string): void
  /** Escape and `Ctrl-C` close the panel without a choice. */
  onCancel(): void
}

export class HostSelector extends Container implements Focusable {
  /** Keys here are an instruction, not writing: the client switches to English. */
  imePolicy: ImePolicy = 'command'
  private readonly options: HostSelectorOptions
  private readonly styles: ReturnType<typeof buildStyles>
  private readonly list = new Container()
  /** `['', ...hosts]`: index 0 is this machine. */
  private readonly entries: readonly string[]
  private readonly widest: number
  private cursor = 0
  private focusedState = false

  constructor(options: HostSelectorOptions) {
    super()
    this.options = options
    this.styles = buildStyles(options.color)
    const s = this.styles
    this.entries = ['', ...options.hosts]
    const currentIndex = options.current === undefined ? 0 : this.entries.indexOf(options.current)
    this.cursor = Math.max(0, currentIndex)
    this.widest = Math.max(0, ...this.entries.map(entry => visibleWidth(this.labelOf(entry))))

    this.addChild(new Rule(s.dim))
    this.addChild(new Spacer(1))
    this.addChild(new TruncatedText(s.accent(s.bold(options.title)), 1, 0))
    this.addChild(new Spacer(1))
    this.addChild(this.list)
    this.addChild(new Spacer(1))
    this.addChild(new TruncatedText(s.dim(`  ${options.hint}`), 0, 0))
    this.addChild(new Rule(s.dim))
    this.updateList()
  }

  get focused(): boolean {
    return this.focusedState
  }

  set focused(value: boolean) {
    this.focusedState = value
  }

  /** The row's text: this machine's localized name, or the alias itself. */
  private labelOf(entry: string): string {
    return entry === '' ? this.options.local : entry
  }

  private capacity(): number {
    return listCapacity(this.options.rows(), CHROME_ROWS)
  }

  private updateList(): void {
    const s = this.styles
    this.list.clear()
    if (this.options.hosts.length === 0) {
      // This machine is still a choice, so the empty case is a hint, not a wall.
      this.list.addChild(new TruncatedText(s.dim(`  ${this.options.empty}`), 0, 0))
    }
    const window = windowOf(this.entries, this.cursor, this.capacity())
    window.items.forEach((entry, offset) => {
      const index = window.start + offset
      const selected = index === this.cursor
      const isCurrent = entry === (this.options.current ?? '')
      const prefix = selected ? s.accent('→ ') : '  '
      const mark = isCurrent ? s.ok('✓ ') : '  '
      const label = this.labelOf(entry)
      const padded = label + ' '.repeat(Math.max(0, this.widest - visibleWidth(label)))
      // The selected row's label takes the highlight ink; the row keeps its
      // transparent background, exactly like every other list in the frame.
      this.list.addChild(new TruncatedText(`${prefix}${mark}${selected ? s.accent(padded) : padded}`, 0, 0))
    })
    const scroll = scrollLabel(this.cursor, this.entries.length, window.start, this.capacity())
    if (scroll !== undefined) this.list.addChild(new TruncatedText(s.dim(scroll), 0, 0))
  }

  private move(delta: number): void {
    const total = this.entries.length
    if (total === 0) return
    this.cursor = (this.cursor + delta + total) % total
    this.updateList()
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'ctrl+c') || matchesKey(data, 'escape')) {
      this.options.onCancel()
      return
    }
    if (listMove(data, 'up') || data === 'k') { this.move(-1); return }
    if (listMove(data, 'down') || data === 'j') { this.move(1); return }
    if (matchesKey(data, 'enter')) {
      const entry = this.entries[this.cursor]
      if (entry !== undefined) this.options.onResolve(entry)
    }
  }

}
