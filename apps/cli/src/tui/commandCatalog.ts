/**
 * The one list of things the client can be asked to do — and the whitelist that
 * decides whether a submitted line is one of them.
 *
 * A command is not only something typed after `/`: the same entries feed the
 * command palette, the composer's completion menu, `/help`, the startup hints,
 * and each entry names the key action that runs it. That is why this list lives
 * in one module instead of a `switch` plus three hand-written tables — a command
 * added here appears everywhere, with whatever shortcut the user's configuration
 * gives it. It is also why the whitelist is **derived** from this table instead
 * of being written down a second time: a name that the menus offer but the
 * dispatcher does not know is a command that answers "unknown command", and a
 * pasted path must never be mistaken for one.
 *
 * ## Adding a command
 *
 * 1. Append one row to {@link COMMANDS}: its name (and any aliases), the i18n
 *    description, the palette group, and the key action when it has one.
 * 2. Write its handler in `plugins/commands.ts`, in the map keyed by
 *    {@link ClientCommandName}. That map covers the table exhaustively, so a row
 *    without a handler does not compile — the whitelist, the menus, the
 *    completion and the handler set cannot drift apart.
 *
 * Nothing else needs to be registered: a Host-owned word (`/compact`) comes from
 * the Session's own catalog at runtime and joins the same whitelist.
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
  /**
   * Other words that dispatch the same handler (`/exit` for `quit`).
   *
   * They are deliberately not separate palette rows and not offered as
   * completions: one row per thing a user can do. They are still commands, so the
   * whitelist has to know them.
   */
  readonly aliases?: readonly string[]
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
 * This table is the registry: the palette, the `/` menu, `/help`, the hints, the
 * completion list, the dispatcher's handler map and the whitelist all derive
 * from it. Aliases are the words that dispatch a row without being a row of
 * their own; they are commands for the whitelist and nothing else.
 */
export const COMMANDS = [
  { name: 'help', descriptionKey: 'slash.help', group: 'app' },
  { name: 'sessions', descriptionKey: 'slash.sessions', group: 'session' },
  { name: 'new', descriptionKey: 'slash.new', group: 'session' },
  { name: 'resume', descriptionKey: 'slash.resume', argumentHint: '[id]', group: 'session' },
  { name: 'model', descriptionKey: 'slash.model', argumentHint: '[provider/model]', group: 'model' },
  { name: 'thinking', descriptionKey: 'slash.thinking', argumentHint: '[level]', action: 'app.thinking', group: 'model' },
  { name: 'permission', descriptionKey: 'slash.permission', argumentHint: '[default] [preset]', group: 'model' },
  { name: 'login', descriptionKey: 'slash.login', argumentHint: '[provider]', group: 'model' },
  { name: 'rename', descriptionKey: 'slash.rename', argumentHint: '<title>', aliases: ['name'], group: 'session', requiresArgument: true },
  { name: 'cancel', descriptionKey: 'slash.cancel', action: 'app.interrupt', group: 'session' },
  { name: 'status', descriptionKey: 'slash.status', group: 'session' },
  { name: 'changelog', descriptionKey: 'slash.changelog', argumentHint: '[version|all]', group: 'app' },
  { name: 'editor', descriptionKey: 'slash.editor', action: 'panel.editor', group: 'frame' },
  { name: 'terminal', descriptionKey: 'slash.terminal', action: 'panel.terminal', aliases: ['shell'], group: 'frame' },
  { name: 'nvim', descriptionKey: 'slash.nvim', action: 'panel.editorOnly', group: 'frame' },
  { name: 'rail', descriptionKey: 'slash.rail', action: 'panel.rail', group: 'frame' },
  { name: 'chat', descriptionKey: 'slash.chat', action: 'panel.chat', group: 'frame' },
  { name: 'commands', descriptionKey: 'slash.commands', action: 'panel.commands', aliases: ['palette'], group: 'frame' },
  { name: 'keys', descriptionKey: 'slash.keys', group: 'frame' },
  { name: 'reasoning', descriptionKey: 'slash.reasoning', group: 'model' },
  { name: 'clear', descriptionKey: 'slash.clear', group: 'app' },
  { name: 'update', descriptionKey: 'slash.update', group: 'app' },
  { name: 'restart', descriptionKey: 'slash.restart', group: 'app' },
  { name: 'remote', descriptionKey: 'slash.remote', argumentHint: '[ssh-host|local]', group: 'app' },
  { name: 'language', descriptionKey: 'slash.language', argumentHint: '[en|zh-CN]', group: 'app' },
  { name: 'create-auto-task', descriptionKey: 'slash.createAutoTask', argumentHint: '[requirements]', group: 'app' },
  { name: 'quit', descriptionKey: 'slash.quit', action: 'app.quit', aliases: ['exit'], group: 'app' },
] as const satisfies readonly CatalogCommand[]

/** The name of every command this client owns, as a union of literals. */
export type ClientCommandName = (typeof COMMANDS)[number]['name']

/**
 * The same table as plain rows.
 *
 * The literal tuple above is what makes {@link ClientCommandName} exhaustive; a
 * row that omits `aliases` or `action` does not carry those keys in that tuple,
 * so readers that ask "is it there?" go through this widened view.
 */
const ROWS: readonly CatalogCommand[] = COMMANDS

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
  const own: CatalogEntry[] = ROWS.map(command => ({
    ...command,
    description: t(command.descriptionKey),
    hint: command.action === undefined ? '' : actionHint(command.action),
  }))
  const ours = new Set(ROWS.map(command => command.name))
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

/** One submitted draft split into the command word and its argument. */
export interface ParsedCommandLine {
  /** The word after the slash, lowercased the way the registry looks it up. */
  readonly name: string
  /** Everything after the command word, trimmed; empty when there is none. */
  readonly argument: string
}

/**
 * Split a draft that names a command: the first word after the slash, then the
 * rest as its argument.
 *
 * Splitting is mechanical here; whether the word **is** a command is
 * {@link isCommandLine}'s question, answered against the registries. Keeping the
 * two apart is what lets an absolute path start with a slash and still be a
 * prompt.
 * @param line - the submitted draft, before trimming.
 * @returns the command word and argument, or undefined when the draft does not
 *   start with a slash at all.
 */
export function parseCommandLine(line: string): ParsedCommandLine | undefined {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/u.exec(line.trim())
  if (match === null) return undefined
  return {
    name: (match[1] ?? '').toLowerCase(),
    argument: (match[2] ?? '').trim(),
  }
}

/**
 * The registry row one typed word names, by its own name or an alias.
 *
 * This is the client half of the whitelist and the single lookup the dispatcher
 * uses, so an alias can never dispatch something the menus do not know about.
 * @param token - the word after the slash, as typed.
 * @returns the canonical command name, or undefined when the client does not own
 *   the word.
 */
export function clientCommandName(token: string): ClientCommandName | undefined {
  const name = token.toLowerCase()
  const row = ROWS.find(command => command.name === name || command.aliases?.includes(name) === true)
  return row?.name as ClientCommandName | undefined
}

/**
 * Whether one submitted line is a slash command rather than a prompt.
 *
 * The rule is a **whitelist**, the way pi does it: the first word must name a
 * command this client owns or one the open Session's Host catalog offers.
 * Nothing is inferred from the line's shape. That is deliberate — every absolute
 * path starts with `/`, and a pasted screenshot's path
 * (`/tmp/hulala-pastes/paste-….png`, `/var/folders/…`) is the most common line
 * that does; with a whitelist no path can ever be mistaken for a command, and a
 * typo like `/hlep` goes to the model instead of being answered with an error
 * the user did not ask for. The argument is free text, newlines included.
 * @param line - the submitted draft, before trimming.
 * @returns true when the line should be dispatched as a command.
 */
export function isCommandLine(line: string): boolean {
  const parsed = parseCommandLine(line)
  if (parsed === undefined) return false
  return clientCommandName(parsed.name) !== undefined || resolveHostCommand(parsed.name) !== undefined
}

/** The group headings the palette prints above each section. */
export function groupLabel(group: CommandGroup): string {
  return t(`palette.group.${group}` as MessageKey)
}
