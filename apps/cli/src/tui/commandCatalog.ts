/**
 * The one list of things the client can be asked to do.
 *
 * A command is not only something typed after `/`: the same entries feed the
 * command palette, the composer's completion menu, `/help` and the startup hints,
 * and each entry names the key action that runs it. That is why this list lives
 * in one module instead of a `switch` plus three hand-written tables — a command
 * added here appears everywhere, with whatever shortcut the user's configuration
 * gives it.
 *
 * Descriptions are i18n keys, resolved on demand: a language switch must show up
 * in the palette and the menu without a restart.
 *
 * @module hulala-cli/tui/commandCatalog
 */
import { actionHint } from '../keymap.js'
import { t } from './i18n/index.js'
import type { MessageKey } from './i18n/messages.js'

/** How the palette groups the list when nothing is typed yet. */
export type CommandGroup = 'session' | 'model' | 'frame' | 'app'

/** One command as it is defined, before the language picks its words. */
export interface CatalogCommand {
  /** The word after the slash, without the slash. */
  readonly name: string
  readonly descriptionKey: MessageKey
  /** The argument placeholder, `[optional]` or `<required>`. */
  readonly argumentHint?: string
  /** The key action that also runs this command. */
  readonly action?: string
  readonly group: CommandGroup
  /** A command that cannot run without its argument; the palette prefills it. */
  readonly requiresArgument?: boolean
}

/** One command as the palette and the menus render it. */
export interface CatalogEntry extends CatalogCommand {
  /** The description in the active language. */
  readonly description: string
  /** The shortcut label for the hint column, or an empty string. */
  readonly hint: string
}

/**
 * Every command the client owns, in palette order.
 *
 * Aliases the command switch accepts (`/exit`, `/name`, `/shell`) are deliberately
 * absent: one row per thing a user can do, and the palette's search finds it by
 * its description even when the word is forgotten.
 */
export const COMMANDS: readonly CatalogCommand[] = [
  { name: 'help', descriptionKey: 'slash.help', group: 'app' },
  { name: 'sessions', descriptionKey: 'slash.sessions', group: 'session' },
  { name: 'new', descriptionKey: 'slash.new', group: 'session' },
  { name: 'resume', descriptionKey: 'slash.resume', argumentHint: '[id]', group: 'session' },
  { name: 'model', descriptionKey: 'slash.model', argumentHint: '[provider/model]', group: 'model' },
  { name: 'thinking', descriptionKey: 'slash.thinking', argumentHint: '[level]', action: 'app.thinking', group: 'model' },
  { name: 'permission', descriptionKey: 'slash.permission', argumentHint: '[default] [preset]', group: 'model' },
  { name: 'login', descriptionKey: 'slash.login', argumentHint: '[provider]', group: 'model' },
  { name: 'rename', descriptionKey: 'slash.rename', argumentHint: '<title>', group: 'session', requiresArgument: true },
  { name: 'cancel', descriptionKey: 'slash.cancel', action: 'app.interrupt', group: 'session' },
  { name: 'status', descriptionKey: 'slash.status', group: 'session' },
  { name: 'editor', descriptionKey: 'slash.editor', action: 'panel.editor', group: 'frame' },
  { name: 'terminal', descriptionKey: 'slash.terminal', action: 'panel.terminal', group: 'frame' },
  { name: 'nvim', descriptionKey: 'slash.nvim', action: 'panel.editorOnly', group: 'frame' },
  { name: 'rail', descriptionKey: 'slash.rail', action: 'panel.rail', group: 'frame' },
  { name: 'chat', descriptionKey: 'slash.chat', action: 'panel.chat', group: 'frame' },
  { name: 'commands', descriptionKey: 'slash.commands', action: 'panel.commands', group: 'frame' },
  { name: 'keys', descriptionKey: 'slash.keys', group: 'frame' },
  { name: 'reasoning', descriptionKey: 'slash.reasoning', group: 'model' },
  { name: 'clear', descriptionKey: 'slash.clear', group: 'app' },
  { name: 'update', descriptionKey: 'slash.update', group: 'app' },
  { name: 'restart', descriptionKey: 'slash.restart', group: 'app' },
  { name: 'language', descriptionKey: 'slash.language', argumentHint: '[en|zh-CN]', group: 'app' },
  { name: 'quit', descriptionKey: 'slash.quit', action: 'app.quit', group: 'app' },
]

/**
 * The catalog rendered for the active language and the keys in force.
 * @returns every entry with its description and shortcut label.
 */
export function commandCatalog(): CatalogEntry[] {
  return COMMANDS.map(command => ({
    ...command,
    description: t(command.descriptionKey),
    hint: command.action === undefined ? '' : actionHint(command.action),
  }))
}

/**
 * Look one command up by the word after the slash.
 * @param name - the command word.
 * @returns the rendered entry, or undefined when no command has that name.
 */
export function catalogEntry(name: string): CatalogEntry | undefined {
  return commandCatalog().find(command => command.name === name)
}

/** The group headings the palette prints above each section. */
export function groupLabel(group: CommandGroup): string {
  return t(`palette.group.${group}` as MessageKey)
}
