/**
 * `/thinking`: the reasoning levels this model advertises, rendered where the
 * composer sits.
 *
 * pi's thinking selector is the model that matters here: one short list of
 * levels, the current one ticked, the persisted default marked, and the two key
 * hints underneath. It replaces the composer instead of floating over the
 * transcript, exactly like `/model` and `/login`, because the transcript above
 * should keep its rows.
 *
 * What the levels *are* comes from the Host: each adapter advertises its own
 * efforts and their descriptions, so the terminal never hard-codes `low`/`high`
 * or a token budget. Choosing a level is a model selection with the same route
 * and a `reasoningEffort`; DeepSeek Harness also saves that selection as the
 * default for new Sessions, which is why the footer says so and the default row
 * carries a badge.
 *
 * @module hulala-cli/tui/view/selector/thinking
 */
import {
  Container,
  Spacer,
  TruncatedText,
  matchesKey,
  visibleWidth,
  type Focusable,
} from '@earendil-works/pi-tui'
import type { TerminalThinkingLevel } from '../../data/remote.js'
import { t } from '../../i18n/index.js'
import { listMove } from '../../keys.js'
import { buildStyles } from '../theme.js'
import { padEnd } from '../pathText.js'
import { Rule, listCapacity, scrollLabel, windowOf } from './chrome.js'
import type { ImePolicy } from '../../pane/focus.js'

/** What `/thinking` ended with. */
export type ThinkingPickerResult =
  | { kind: 'select'; level: string }
  | { kind: 'cancel' }

export interface ThinkingSelectorOptions {
  /** The model these levels belong to, shown beside the title. */
  model: string
  /** The efforts the adapter advertises, in its own order. */
  levels: readonly TerminalThinkingLevel[]
  /** The level the Session runs at now; the cursor starts here. */
  current?: string
  /** The level new Sessions would start at, marked with a badge. */
  defaultLevel?: string
  color: boolean
  /** Terminal rows, so a short terminal still shows the composer area. */
  rows(): number
  onResolve(result: ThinkingPickerResult): void
}

/** Rows the frame takes around the list: rules, spacers, title and hints. */
const CHROME_ROWS = 8

export class ThinkingSelector extends Container implements Focusable {
  /** Keys here are an instruction, not writing: the client switches to English. */
  imePolicy: ImePolicy = 'command'
  private readonly options: ThinkingSelectorOptions
  private readonly styles: ReturnType<typeof buildStyles>
  private readonly list = new Container()
  private readonly widest: number
  private cursor: number
  private focusedState = false

  constructor(options: ThinkingSelectorOptions) {
    super()
    this.options = options
    this.styles = buildStyles(options.color)
    const s = this.styles
    this.widest = Math.max(...options.levels.map(level => visibleWidth(level.id)))
    const current = options.current === undefined
      ? -1
      : options.levels.findIndex(level => level.id === options.current)
    this.cursor = Math.max(0, current)

    this.addChild(new Rule(s.dim))
    this.addChild(new Spacer(1))
    this.addChild(new TruncatedText(
      `${s.accent(s.bold(t('selector.thinking.title')))}${s.dim(` — ${options.model}`)}`,
      1,
      0,
    ))
    this.addChild(new Spacer(1))
    this.addChild(this.list)
    this.addChild(new Spacer(1))
    this.addChild(new TruncatedText(s.dim(`  ${t('selector.thinking.footer')}`), 0, 0))
    this.addChild(new TruncatedText(s.dim(`  ${t('selector.thinking.persists')}`), 0, 0))
    this.addChild(new Rule(s.dim))
    this.updateList()
  }

  get focused(): boolean {
    return this.focusedState
  }

  set focused(value: boolean) {
    this.focusedState = value
  }

  private capacity(): number {
    return listCapacity(this.options.rows(), CHROME_ROWS)
  }

  private updateList(): void {
    const s = this.styles
    this.list.clear()
    const window = windowOf(this.options.levels, this.cursor, this.capacity())
    window.items.forEach((level, offset) => {
      const index = window.start + offset
      const selected = index === this.cursor
      const current = level.id === this.options.current
      const isDefault = level.id === this.options.defaultLevel
      const prefix = selected ? s.accent('→ ') : '  '
      const check = current ? s.ok('✓ ') : '  '
      const id = padEnd(level.id, this.widest)
      const details = [
        ...(level.description === undefined ? [] : [level.description]),
        ...(isDefault ? [t('selector.thinking.default')] : []),
      ]
      const detail = details.length === 0 ? '' : s.dim(`  ${details.join(' · ')}`)
      this.list.addChild(new TruncatedText(`${prefix}${check}${selected ? s.accent(id) : id}${detail}`, 0, 0))
    })
    const scroll = scrollLabel(this.cursor, this.options.levels.length, window.start, this.capacity())
    if (scroll !== undefined) this.list.addChild(new TruncatedText(s.dim(scroll), 0, 0))
  }

  private move(delta: number): void {
    const total = this.options.levels.length
    if (total === 0) return
    this.cursor = (this.cursor + delta + total) % total
    this.updateList()
  }

  private confirm(): void {
    const level = this.options.levels[this.cursor]
    if (level === undefined) return
    this.options.onResolve({ kind: 'select', level: level.id })
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'ctrl+c') || matchesKey(data, 'escape')) {
      this.options.onResolve({ kind: 'cancel' })
      return
    }
    if (listMove(data, 'up')) {
      this.move(-1)
      return
    }
    if (listMove(data, 'down')) {
      this.move(1)
      return
    }
    if (matchesKey(data, 'enter')) {
      this.confirm()
    }
  }
}
