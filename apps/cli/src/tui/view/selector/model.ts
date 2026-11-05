/**
 * `/model` picker, rendered the way pi renders its model selector.
 *
 * The panel replaces the composer instead of floating over the transcript: a
 * full-width rule, the provider hint, a search field, up to eight model rows,
 * the selected model's detail, and the key hints. Rows follow pi's shape
 * (`→ ✓ <name> (id) [provider] · default`), and the current model is ticked so
 * the list answers "what am I on" before it answers "what can I switch to".
 *
 * Typing filters over id, name and provider. `Tab` cycles the reasoning effort
 * of the highlighted model; `Enter` chooses it; `/login` typed as the query
 * opens the provider API-key flow, mirroring pi's hint that `/login` adds
 * providers.
 *
 * @module hulala-cli/tui/view/selector/model
 */
import {
  Container,
  Input,
  Spacer,
  TruncatedText,
  fuzzyFilter,
  matchesKey,
  type Focusable,
} from '@earendil-works/pi-tui'
import type { TerminalModel, TerminalModelCatalog } from '../../data/remote.js'
import { t } from '../../i18n/index.js'
import { listMove } from '../../keys.js'
import { buildStyles } from '../theme.js'
import { Rule, listCapacity, scrollLabel, windowOf } from './chrome.js'

/** One model selection accepted by the Host. */
export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

/** What `/model` ended with. */
export type ModelPickerResult =
  | { kind: 'select'; selection: ModelSelection }
  | { kind: 'login' }
  | { kind: 'cancel' }

export interface ModelSelectorOptions {
  catalog: TerminalModelCatalog
  /** The Session's model, ticked in the list and used as the effort baseline. */
  current?: TerminalModel
  color: boolean
  /** Terminal rows, so the list never crowds out the conversation. */
  rows(): number
  onResolve(result: ModelPickerResult): void
}

interface Entry {
  provider: string
  providerName: string
  id: string
  name: string
  efforts: readonly string[]
  defaultEffort?: string
}

/** Stable key for one route; used by the per-model reasoning choices. */
function keyOf(entry: Entry): string {
  return `${entry.provider}\u0000${entry.id}`
}

function selectionOf(model: TerminalModel): string {
  return `${model.provider}\u0000${model.model}`
}

export class ModelSelector extends Container implements Focusable {
  private readonly options: ModelSelectorOptions
  private readonly styles: ReturnType<typeof buildStyles>
  private readonly search: Input
  private readonly list = new Container()
  private readonly detail = new Container()
  private readonly entries: Entry[]
  private filtered: Entry[]
  private cursor = 0
  private readonly efforts = new Map<string, string>()
  private focusedState = false

  constructor(options: ModelSelectorOptions) {
    super()
    this.options = options
    this.styles = buildStyles(options.color)
    const s = this.styles
    this.entries = options.catalog.groups.flatMap(group => group.models.map(model => ({
      provider: group.id,
      providerName: group.name,
      id: model.id,
      name: model.name,
      efforts: model.reasoning?.efforts.map(effort => effort.id) ?? [],
      ...(model.reasoning?.defaultEffort === undefined ? {} : { defaultEffort: model.reasoning.defaultEffort }),
    })))
    this.entries.sort((left, right) => {
      const leftCurrent = options.current !== undefined && selectionOf(options.current) === keyOf(left)
      const rightCurrent = options.current !== undefined && selectionOf(options.current) === keyOf(right)
      if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1
      const leftDefault = keyOf(left) === selectionOf(options.catalog.default)
      const rightDefault = keyOf(right) === selectionOf(options.catalog.default)
      if (leftDefault !== rightDefault) return leftDefault ? -1 : 1
      return left.provider.localeCompare(right.provider) || left.name.localeCompare(right.name)
    })
    if (options.current?.reasoningEffort !== undefined) {
      this.efforts.set(selectionOf(options.current), options.current.reasoningEffort)
    }
    this.filtered = this.entries

    this.addChild(new Rule(s.dim))
    this.addChild(new Spacer(1))
    this.addChild(new TruncatedText(
      this.entries.length === 0
        ? s.warn(t('selector.model.noProviders'))
        : s.dim(t('selector.model.hint')),
      1,
      0,
    ))
    this.addChild(new Spacer(1))
    this.search = new Input({ prompt: `  ${s.accent('❯')} `, placeholder: t('selector.model.search') })
    this.addChild(this.search)
    this.addChild(new Spacer(1))
    this.addChild(this.list)
    this.addChild(new Spacer(1))
    this.addChild(this.detail)
    this.addChild(new Rule(s.dim))
    this.updateList()
  }

  get focused(): boolean {
    return this.focusedState
  }

  set focused(value: boolean) {
    this.focusedState = value
    this.search.focused = value
  }

  invalidate(): void {
    super.invalidate()
    this.search.invalidate()
  }

  private visible(): number {
    return listCapacity(this.options.rows())
  }

  private selected(): Entry | undefined {
    return this.filtered[this.cursor]
  }

  private effortOf(entry: Entry): string | undefined {
    return this.efforts.get(keyOf(entry))
  }

  private filter(query: string): void {
    this.filtered = query.trim() === ''
      ? this.entries
      : fuzzyFilter(this.entries, query, entry => `${entry.id} ${entry.name} ${entry.provider} ${entry.providerName}`)
    // A fresh query puts the best match under the cursor; clearing it keeps the
    // position clamped to the restored list, exactly like pi's selector.
    this.cursor = query.trim() === '' ? Math.min(this.cursor, Math.max(0, this.filtered.length - 1)) : 0
    this.updateList()
  }

  private updateList(): void {
    const s = this.styles
    this.list.clear()
    if (this.filtered.length === 0) {
      this.list.addChild(new TruncatedText(s.dim(t('selector.model.noMatch')), 1, 0))
    }
    const capacity = this.visible()
    const window = windowOf(this.filtered, this.cursor, capacity)
    window.items.forEach((entry, offset) => {
      const index = window.start + offset
      const selected = index === this.cursor
      const current = this.options.current !== undefined && selectionOf(this.options.current) === keyOf(entry)
      const isDefault = keyOf(entry) === selectionOf(this.options.catalog.default)
      const effort = this.effortOf(entry)
      const prefix = `${selected ? s.accent('→ ') : '  '}${current ? s.ok('✓ ') : '  '}`
      const label = selected ? s.accent(entry.name) : entry.name
      const id = entry.id === entry.name ? '' : s.dim(` (${entry.id})`)
      const provider = s.dim(` [${entry.provider}]`)
      const badges = `${isDefault ? s.dim(t('selector.model.default')) : ''}${effort === undefined ? '' : s.dim(t('selector.model.reasoning', { effort }))}`
      this.list.addChild(new TruncatedText(`${prefix}${label}${id}${provider}${badges}`, 0, 0))
    })
    const scroll = scrollLabel(this.cursor, this.filtered.length, window.start, capacity)
    if (scroll !== undefined) this.list.addChild(new TruncatedText(s.dim(scroll), 0, 0))
    this.updateDetail()
  }

  private updateDetail(): void {
    const s = this.styles
    this.detail.clear()
    const entry = this.selected()
    if (entry !== undefined) {
      const name = entry.id === entry.name ? entry.name : `${entry.name} (${entry.id})`
      this.detail.addChild(new TruncatedText(s.dim(t('selector.model.name', { name })), 0, 0))
      if (entry.efforts.length === 0) {
        this.detail.addChild(new TruncatedText(s.dim(t('selector.model.notAvailable')), 0, 0))
      } else {
        const chosen = this.effortOf(entry)
        const parts = entry.efforts.map(effort => effort === chosen ? s.accent(effort) : s.dim(effort))
        this.detail.addChild(new TruncatedText(`  ${s.dim(t('selector.model.reasoningLabel'))} ${parts.join(s.dim(' / '))}`, 0, 0))
      }
    }
    this.detail.addChild(new TruncatedText(s.dim(`  ${t('selector.model.footer')}`), 0, 0))
  }

  private confirm(): void {
    const query = this.search.getValue().trim()
    if (query === '/login') {
      this.options.onResolve({ kind: 'login' })
      return
    }
    const entry = this.selected()
    if (entry === undefined) return
    const effort = this.effortOf(entry)
    this.options.onResolve({
      kind: 'select',
      selection: {
        provider: entry.provider,
        model: entry.id,
        ...(effort === undefined ? {} : { reasoningEffort: effort }),
      },
    })
  }

  private cycleEffort(): void {
    const entry = this.selected()
    if (entry === undefined || entry.efforts.length === 0) return
    const key = keyOf(entry)
    const current = this.efforts.get(key) ?? entry.defaultEffort
    const index = current === undefined ? -1 : entry.efforts.indexOf(current)
    this.efforts.set(key, entry.efforts[(index + 1) % entry.efforts.length] ?? entry.efforts[0]!)
    this.updateList()
  }

  private move(delta: number): void {
    if (this.filtered.length === 0) return
    this.cursor = (this.cursor + delta + this.filtered.length) % this.filtered.length
    this.updateList()
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
    if (matchesKey(data, 'pageUp')) {
      this.move(-this.visible())
      return
    }
    if (matchesKey(data, 'pageDown')) {
      this.move(this.visible())
      return
    }
    if (matchesKey(data, 'tab')) {
      this.cycleEffort()
      return
    }
    if (matchesKey(data, 'enter')) {
      this.confirm()
      return
    }
    this.search.handleInput(data)
    this.filter(this.search.getValue())
  }
}
