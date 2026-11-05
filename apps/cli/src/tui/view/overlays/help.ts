/**
 * Help modal: the commands a reader needs, and the keybindings.
 *
 * The list is curated rather than the whole completion table: the panel must
 * fit above the composer on a short terminal, and `/reasoning`, `/clear` and
 * `/status` remain discoverable through completion. Descriptions come from the
 * same message table as the completion menu, so both follow the language.
 *
 * @module hulala-cli/tui/view/overlays/help
 */
import type { Component } from '@earendil-works/pi-tui'
import { truncateToWidth } from '@earendil-works/pi-tui'
import { t, type MessageKey } from '../../i18n/index.js'
import { buildStyles } from '../theme.js'
import { panel } from './panel.js'

/** The curated command list, with each description's message key. */
const COMMANDS: ReadonlyArray<readonly [usage: string, description: MessageKey]> = [
  ['/help', 'slash.help'],
  ['/sessions', 'slash.sessions'],
  ['/new', 'slash.new'],
  ['/resume [id]', 'slash.resume'],
  ['/model [provider/model]', 'slash.model'],
  ['/login [provider]', 'slash.login'],
  ['/rename <title>', 'slash.rename'],
  ['/cancel', 'slash.cancel'],
  ['/status', 'slash.status'],
  ['/editor, /terminal', 'help.columns'],
  ['/language [en|zh-CN]', 'slash.language'],
  ['/quit', 'slash.quit'],
]

const KEY_LINES = [
  'help.key.submit',
  'help.key.move',
  'help.key.escape',
  'help.key.exit',
  'help.key.columns',
  'help.key.railKeys',
  'help.key.rail',
  'help.key.more',
  'help.key.mouse',
] as const

export interface HelpOverlayOptions {
  color: boolean
  onClose(): void
}

export class HelpOverlay implements Component {
  private readonly options: HelpOverlayOptions

  constructor(options: HelpOverlayOptions) {
    this.options = options
  }

  invalidate(): void {}

  render(width: number): string[] {
    const s = buildStyles(this.options.color)
    const panelWidth = width
    const inner = panelWidth - 4
    const body: string[] = []
    for (const [usage, description] of COMMANDS) {
      body.push(truncateToWidth(`${usage.padEnd(24)} ${t(description)}`, inner))
    }
    body.push(s.accent(t('help.keys')))
    for (const key of KEY_LINES) body.push(s.dim(truncateToWidth(t(key), inner)))
    return panel(panelWidth, t('help.title'), body, [s.dim(t('help.close'))])
  }

  handleInput(_data: string): void {
    this.options.onClose()
  }
}
