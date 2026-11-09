/**
 * `/permission`: the presets the Host offers, rendered where the composer sits.
 *
 * The two actions mirror pi's model and thinking selectors exactly: `Enter`
 * changes the current Session, `Ctrl+S` also stores the same choice as the
 * default for Sessions created later. One list carries both facts, because a
 * separate "default" screen would hide the answer to "which one is the
 * default?" behind an extra keystroke.
 *
 * The presets themselves are the Host's: three shipped keys get product
 * labels, anything else is shown under the name its configuration gave it.
 * There is no permission logic here — the Session write is the Host's
 * `/permission` command, and the default is the Host's settings document.
 *
 * @module hulala-cli/tui/view/selector/permission
 */
import {
  Container,
  Spacer,
  TruncatedText,
  matchesKey,
  visibleWidth,
  type Focusable,
} from '@earendil-works/pi-tui'
import type { TerminalPermissionPreset } from '../../data/remote.js'
import { t } from '../../i18n/index.js'
import { listMove } from '../../keys.js'
import { AUTO_REVIEW_PRESET, permissionLabel } from '../permission.js'
import { padEnd } from '../pathText.js'
import { buildStyles } from '../theme.js'
import { Rule, listCapacity, scrollLabel, windowOf } from './chrome.js'
import type { ImePolicy } from '../../pane/focus.js'

/** What `/permission` ended with. */
export type PermissionPickerResult =
  | { kind: 'select'; preset: string }
  | { kind: 'save'; preset: string }
  | { kind: 'cancel' }

export interface PermissionSelectorOptions {
  /** Every selectable preset, in the Host's contribution order. */
  presets: readonly TerminalPermissionPreset[]
  /** The preset this Session runs at now; the cursor starts here and it is ticked. */
  current?: string
  /** The preset new Sessions start at, marked with a badge. */
  defaultPreset?: string
  color: boolean
  /** Terminal rows, so a short terminal still shows the composer area. */
  rows(): number
  onResolve(result: PermissionPickerResult): void
}

/** Rows the frame takes around the list: rules, spacers, title and hints. */
const CHROME_ROWS = 9

export class PermissionSelector extends Container implements Focusable {
  /** Keys here are an instruction, not writing: the client switches to English. */
  imePolicy: ImePolicy = 'command'
  private readonly options: PermissionSelectorOptions
  private readonly styles: ReturnType<typeof buildStyles>
  private readonly list = new Container()
  private readonly labels: readonly string[]
  private readonly widest: number
  private cursor: number
  private focusedState = false

  constructor(options: PermissionSelectorOptions) {
    super()
    this.options = options
    this.styles = buildStyles(options.color)
    const s = this.styles
    this.labels = options.presets.map(preset => permissionLabel(preset.value, preset.name))
    this.widest = Math.max(0, ...this.labels.map(label => visibleWidth(label)))
    const current = options.current === undefined
      ? -1
      : options.presets.findIndex(preset => preset.value === options.current)
    this.cursor = Math.max(0, current)

    this.addChild(new Rule(s.dim))
    this.addChild(new Spacer(1))
    this.addChild(new TruncatedText(
      `${s.accent(s.bold(t('selector.permission.title')))}${options.current === undefined ? '' : s.dim(` — ${permissionLabel(options.current)}`)}`,
      1,
      0,
    ))
    this.addChild(new Spacer(1))
    this.addChild(this.list)
    this.addChild(new Spacer(1))
    this.addChild(new TruncatedText(s.dim(`  ${t('selector.permission.footer')}`), 0, 0))
    this.addChild(new TruncatedText(s.dim(`  ${t('selector.permission.persists')}`), 0, 0))
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
    const presets = this.options.presets
    if (presets.length === 0) {
      this.list.addChild(new TruncatedText(s.dim(`  ${t('selector.permission.empty')}`), 0, 0))
      return
    }
    const window = windowOf(presets, this.cursor, this.capacity())
    window.items.forEach((preset, offset) => {
      const index = window.start + offset
      const selected = index === this.cursor
      const current = preset.value === this.options.current
      const isDefault = preset.value === this.options.defaultPreset
      const prefix = selected ? s.accent('→ ') : '  '
      const check = current ? s.ok('✓ ') : '  '
      const label = padEnd(this.labels[index] ?? preset.value, this.widest)
      const details = [
        ...(preset.description === undefined || preset.description === '' ? [] : [preset.description]),
        ...(preset.value === AUTO_REVIEW_PRESET ? [t('selector.permission.exp')] : []),
        ...(isDefault ? [t('selector.permission.default')] : []),
      ]
      const detail = details.length === 0 ? '' : s.dim(`  ${details.join(' · ')}`)
      this.list.addChild(new TruncatedText(`${prefix}${check}${selected ? s.accent(label) : label}${detail}`, 0, 0))
    })
    const scroll = scrollLabel(this.cursor, presets.length, window.start, this.capacity())
    if (scroll !== undefined) this.list.addChild(new TruncatedText(s.dim(scroll), 0, 0))
  }

  private move(delta: number): void {
    const total = this.options.presets.length
    if (total === 0) return
    this.cursor = (this.cursor + delta + total) % total
    this.updateList()
  }

  private resolve(kind: 'select' | 'save'): void {
    const preset = this.options.presets[this.cursor]
    if (preset === undefined) return
    this.options.onResolve({ kind, preset: preset.value })
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
    if (matchesKey(data, 'ctrl+s')) {
      this.resolve('save')
      return
    }
    if (matchesKey(data, 'enter')) {
      this.resolve('select')
    }
  }
}
