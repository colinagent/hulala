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
import { builtinCommandName, builtinCommandTokens } from '@deepseek-ai/dsh-commands/builtin'
import { actionHint } from '../keymap.js'
import { t } from './i18n/index.js'
import type { MessageKey } from './i18n/messages.js'
import type { TerminalHostCommand } from './data/remote.js'

/** How the palette groups the list when nothing is typed yet. */
export type CommandGroup = 'session' | 'model' | 'frame' | 'app' | 'host'

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
export interface CatalogEntry {
  readonly name: string
  /** The description in the active language. */
  readonly description: string
  /** The argument placeholder, `[optional]` or `<required>`. */
  readonly argumentHint?: string
  /** The key action that also runs this command. */
  readonly action?: string
  readonly group: CommandGroup
  /** A command that cannot run without its argument; the palette prefills it. */
  readonly requiresArgument?: boolean
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
  { name: 'changelog', descriptionKey: 'slash.changelog', argumentHint: '[version|all]', group: 'app' },
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
  { name: 'remote', descriptionKey: 'slash.remote', argumentHint: '[ssh-host|local]', group: 'app' },
  { name: 'language', descriptionKey: 'slash.language', argumentHint: '[en|zh-CN]', group: 'app' },
  { name: 'quit', descriptionKey: 'slash.quit', action: 'app.quit', group: 'app' },
]

/**
 * The Host's command rows for the open Session.
 *
 * These are not client features: `/compact` is a plugin row the composition
 * mounts, and the Host is the only thing that knows which rows exist. Replacing
 * them wholesale on every Session change keeps a stale command from staying
 * dispatchable after its plugin left the composition.
 */
let hostCommands: readonly TerminalHostCommand[] = []

/**
 * Replace the Host rows the `/` menu, the palette and `/help` can print.
 * @param commands - the open Session's catalog, or an empty list when it closed.
 */
export function setHostCommands(commands: readonly TerminalHostCommand[]): void {
  hostCommands = commands
}

/** The words that name one built-in capability, for typed aliases. */
function builtinTokens(command: TerminalHostCommand): readonly string[] {
  const name = builtinCommandName(command)
  return name === undefined ? [] : [builtinCommandTokens.en[name], builtinCommandTokens.zh[name]]
}

/**
 * Resolve one typed word against the Host's catalog.
 *
 * The registered name wins outright; then a first-party spelling (`/压缩`
 * reaches `compact`), which only ever selects the definition it names — the
 * same rule the web client applies, so a Session-scoped command that happens to
 * share a word with no built-in still wins.
 * @param token - the word after the slash, as typed.
 * @returns the Host command to dispatch, or undefined when none matches.
 */
export function resolveHostCommand(token: string): TerminalHostCommand | undefined {
  const exact = hostCommands.find(command => command.name === token)
  if (exact !== undefined) return exact
  return hostCommands.find(command => builtinTokens(command).includes(token))
}

/** One Host row as the menus render it. */
function hostEntry(command: TerminalHostCommand): CatalogEntry {
  const builtin = builtinCommandName(command)
  return {
    name: command.name,
    description: builtin === undefined ? command.description : t(`host.${builtin}` as MessageKey),
    ...(command.input === undefined ? {} : { argumentHint: command.input.hint }),
    group: 'host',
    hint: '',
  }
}

/**
 * The catalog rendered for the active language and the keys in force.
 * @returns every entry with its description and shortcut label.
 */
export function commandCatalog(): CatalogEntry[] {
  const own: CatalogEntry[] = COMMANDS.map(command => ({
    ...command,
    description: t(command.descriptionKey),
    hint: command.action === undefined ? '' : actionHint(command.action),
  }))
  const ours = new Set(COMMANDS.map(command => command.name))
  return [
    ...own,
    // A word the client already owns is not offered twice: the client command is
    // the one this build can guarantee, and the Host row stays dispatchable by
    // its registered name when it differs.
    ...hostCommands.filter(command => !ours.has(command.name)).map(hostEntry),
  ]
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
