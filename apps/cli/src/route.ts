/**
 * Command routing for the `hulala` entry point.
 *
 * The bare command opens the terminal client. `hulala host` owns the shared
 * daemon; `hulala plugin` and `hulala creator` own the client's extension
 * surface; lifecycle commands own the installed program.
 *
 * @module hulala-cli/route
 */

/** One parsed invocation. */
export type Route =
  | { kind: 'tui'; args: string[] }
  | { kind: 'host'; args: string[] }
  | { kind: 'plugin'; args: string[] }
  | { kind: 'creator'; args: string[] }
  | { kind: 'distribution'; command: string; args: string[] }
  | { kind: 'help' }
  | { kind: 'version' }

const DISTRIBUTION = ['install', 'update', 'rollback', 'uninstall', 'doctor'] as const

/**
 * Decide what one invocation means.
 * @param args - arguments after the executable.
 * @returns the route; unknown flags on a bare command go to the TUI.
 */
export function routeCommand(args: readonly string[]): Route {
  const [command, ...rest] = args
  // `hulala update --version <release>` selects a release, so lifecycle
  // commands own their `--version`; elsewhere it is the global version flag.
  const distribution = command !== undefined && (DISTRIBUTION as readonly string[]).includes(command)
  if (command !== undefined && (command === '--version' || command === '-V')) return { kind: 'version' }
  if (!distribution && (args.includes('--version') || args.includes('-V'))) return { kind: 'version' }
  // `plugin` owns its own usage line: its arguments are DSH's, not this CLI's.
  if (command === 'plugin') return { kind: 'plugin', args: rest }
  if (args.includes('--help') || args.includes('-h')) return { kind: 'help' }
  if (command !== undefined && distribution) {
    return { kind: 'distribution', command, args: rest }
  }
  if (command === 'host') return { kind: 'host', args: rest }
  if (command === 'creator') return { kind: 'creator', args: rest }
  if (command === 'tui') return { kind: 'tui', args: rest }
  return { kind: 'tui', args: [...args] }
}
