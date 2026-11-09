/**
 * `/login` picker and API-key field.
 *
 * pi's add-provider flow is a provider list followed by a prompt for the key,
 * both rendered where the composer sits. The same steps run here over the
 * Host's provider directory and credential store: pick a route, paste its key,
 * and the Host records the profile reference plus the secret. The key is never
 * echoed or kept in renderer state; the field draws one dot per stored
 * character.
 *
 * @module hulala-cli/tui/view/selector/login
 */
import {
  Container,
  Input,
  Spacer,
  TruncatedText,
  CURSOR_MARKER,
  fuzzyFilter,
  matchesKey,
  renderFakeCursor,
  truncateToWidth,
  visibleWidth,
  type Component,
  type Focusable,
} from '@earendil-works/pi-tui'
import type { TerminalProvider } from '../../data/remote.js'
import { t } from '../../i18n/index.js'
import { listMove } from '../../keys.js'
import { buildStyles } from '../theme.js'
import { Rule, listCapacity, scrollLabel, windowOf } from './chrome.js'
import type { ImePolicy } from '../../pane/focus.js'

export type ProviderPickerResult = { kind: 'select'; provider: TerminalProvider } | { kind: 'cancel' }

export interface ProviderSelectorOptions {
  providers: readonly TerminalProvider[]
  color: boolean
  rows(): number
  onResolve(result: ProviderPickerResult): void
}

/** Rows the provider picker's frame takes around its list. */
const PROVIDER_CHROME_ROWS = 8

function providerCapacity(rows: number): number {
  return listCapacity(rows, PROVIDER_CHROME_ROWS)
}

/** One line of provider status, worded like pi's auth selector. */
function statusOf(provider: TerminalProvider, styles: ReturnType<typeof buildStyles>): string {
  if (provider.configured) {
    const source = provider.source === undefined || provider.source === 'file' ? t('selector.login.configured') : ` ✓ ${provider.source}`
    return styles.ok(source)
  }
  return styles.dim(t('selector.login.notConfigured'))
}

export class ProviderSelector extends Container implements Focusable {
  /** Keys here are an instruction, not writing: the client switches to English. */
  imePolicy: ImePolicy = 'command'
  private readonly options: ProviderSelectorOptions
  private readonly styles: ReturnType<typeof buildStyles>
  private readonly search: Input
  private readonly list = new Container()
  private readonly entries: readonly TerminalProvider[]
  private filtered: readonly TerminalProvider[]
  private cursor = 0
  private focusedState = false

  constructor(options: ProviderSelectorOptions) {
    super()
    this.options = options
    this.styles = buildStyles(options.color)
    const s = this.styles
    this.entries = options.providers
    this.filtered = options.providers

    this.addChild(new Rule(s.dim))
    this.addChild(new Spacer(1))
    this.addChild(new TruncatedText(s.accent(s.bold(t('selector.login.selectTitle'))), 1, 0))
    this.addChild(new Spacer(1))
    this.search = new Input({ prompt: `  ${s.accent('❯')} `, placeholder: t('selector.login.search') })
    this.addChild(this.search)
    this.addChild(new Spacer(1))
    this.addChild(this.list)
    this.addChild(new Spacer(1))
    this.addChild(new TruncatedText(s.dim(`  ${t('selector.login.footer')}`), 0, 0))
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

  private filter(query: string): void {
    this.filtered = query.trim() === ''
      ? this.entries
      : fuzzyFilter([...this.entries], query, provider => `${provider.id} ${provider.name}`)
    this.cursor = query.trim() === '' ? Math.min(this.cursor, Math.max(0, this.filtered.length - 1)) : 0
    this.updateList()
  }

  private updateList(): void {
    const s = this.styles
    this.list.clear()
    if (this.filtered.length === 0) {
      this.list.addChild(new TruncatedText(s.dim(t('selector.login.noMatch')), 1, 0))
    }
    const capacity = providerCapacity(this.options.rows())
    const window = windowOf(this.filtered, this.cursor, capacity)
    window.items.forEach((provider, offset) => {
      const index = window.start + offset
      const selected = index === this.cursor
      const prefix = selected ? s.accent('→ ') : '  '
      const label = selected ? s.accent(provider.name) : provider.name
      const id = provider.id === provider.name ? '' : s.dim(` [${provider.id}]`)
      this.list.addChild(new TruncatedText(`${prefix}${label}${id}${statusOf(provider, s)}`, 0, 0))
    })
    const scroll = scrollLabel(this.cursor, this.filtered.length, window.start, capacity)
    if (scroll !== undefined) this.list.addChild(new TruncatedText(s.dim(scroll), 0, 0))
  }

  private move(delta: number): void {
    if (this.filtered.length === 0) return
    this.cursor = (this.cursor + delta + this.filtered.length) % this.filtered.length
    this.updateList()
  }

  private confirm(): void {
    const provider = this.filtered[this.cursor]
    if (provider === undefined) return
    this.options.onResolve({ kind: 'select', provider })
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
      this.move(-providerCapacity(this.options.rows()))
      return
    }
    if (matchesKey(data, 'pageDown')) {
      this.move(providerCapacity(this.options.rows()))
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

export interface ApiKeyPanelOptions {
  provider: TerminalProvider
  color: boolean
  /** The Host stores the key; nothing about it is kept client-side. */
  onResolve(apiKey: string | undefined): void
}

/**
 * One masked field for the provider's API key.
 *
 * Editing is deliberately small — printable input, paste, backspace, `Ctrl-W`,
 * `Ctrl-U` — because the field holds a secret, and every rule the composer has
 * (history, completion, rendering the text) would expose it.
 */
export class ApiKeyPanel extends Container implements Focusable {
  /** A secret is ASCII: the client switches to English so composition cannot eat it. */
  imePolicy: ImePolicy = 'command'
  private readonly options: ApiKeyPanelOptions
  private readonly styles: ReturnType<typeof buildStyles>
  private readonly field: Component
  private value = ''
  private focusedState = false
  private failure: string | undefined

  constructor(options: ApiKeyPanelOptions) {
    super()
    this.options = options
    this.styles = buildStyles(options.color)
    const s = this.styles
    const provider = options.provider
    this.field = { render: (width: number) => this.renderField(width), invalidate: () => undefined }

    this.addChild(new Rule(s.dim))
    this.addChild(new Spacer(1))
    this.addChild(new TruncatedText(s.accent(s.bold(t('selector.login.apiKeyTitle', { provider: provider.name }))), 1, 0))
    this.addChild(new Spacer(1))
    this.addChild(new TruncatedText(`${t('selector.login.apiKeyPrompt', { provider: provider.name })}${provider.baseURL === undefined ? '' : s.dim(` (${provider.baseURL})`)}`, 1, 0))
    this.addChild(new Spacer(1))
    this.addChild(this.field)
    this.addChild(new Spacer(1))
    this.addChild(new TruncatedText(s.dim(t('selector.login.storage')), 1, 0))
    this.addChild(new TruncatedText(s.dim(t('selector.login.footerKeys')), 1, 0))
    this.addChild(new Rule(s.dim))
  }

  get focused(): boolean {
    return this.focusedState
  }

  set focused(value: boolean) {
    this.focusedState = value
  }

  invalidate(): void {
    super.invalidate()
  }

  private renderField(width: number): string[] {
    const s = this.styles
    const prefix = `  ${s.dim('❯')} `
    const room = Math.max(1, width - visibleWidth(prefix) - 1)
    const shown = truncateToWidth('•'.repeat(this.value.length), room, '')
    const cursor = this.focusedState ? `${CURSOR_MARKER}${renderFakeCursor(' ')}` : ''
    const lines = [`${prefix}${shown}${cursor}`]
    if (this.failure !== undefined) lines.push(truncateToWidth(s.error(`  ${this.failure}`), width, ''))
    return lines
  }

  private clearValue(): void {
    this.value = ''
    this.failure = undefined
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'ctrl+c') || matchesKey(data, 'escape')) {
      this.options.onResolve(undefined)
      return
    }
    if (matchesKey(data, 'enter')) {
      const key = this.value.trim()
      if (key === '') return
      this.options.onResolve(key)
      return
    }
    if (matchesKey(data, 'ctrl+u')) {
      this.clearValue()
      return
    }
    if (matchesKey(data, 'ctrl+w')) {
      this.value = this.value.replace(/\s*\S+$/u, '')
      return
    }
    if (matchesKey(data, 'backspace')) {
      this.value = this.value.slice(0, -1)
      return
    }
    // Bracketed paste wraps the whole chunk; keep its text, drop the markers.
    const pasted = /^\u001b\[200~([\s\S]*)\u001b\[201~$/u.exec(data)
    if (pasted !== null) {
      const text = (pasted[1] ?? '').replace(/[\r\n\t]/gu, '')
      if (text !== '') this.value += text
      return
    }
    // Typed keys arrive one input event at a time; control sequences are ignored.
    const printable = data.replace(/[\u0000-\u001f\u007f]/gu, '')
    if (printable !== '') this.value += printable
  }
}
