/**
 * The contract the terminal client kernel and its panels share.
 *
 * Types only: this file declares what `activate(tui)` receives and nothing else,
 * so importing it with `import type` leaves no trace in a built plugin. That is
 * what lets a panel be one plain `.mjs` file the client loads from a directory
 * — no dependency on this repository, no build step, no `node_modules`.
 *
 * The surface is a facade over the client's own services, not a second plugin
 * system: a built-in plugin and a user plugin are assembled by the same kernel.
 *
 * @module @hulala/tui-panel-types
 */

/** One installed plugin, as its `package.json` describes it. */
export interface PanelManifest {
  /** Directory name under the panels root; also the panel's identity. */
  readonly id: string
  /** Package name from its `package.json`. */
  readonly name: string
  readonly version: string
  readonly description?: string
  /** API version the panel was written against. */
  readonly apiVersion: number
  /** Absolute path of the entry module. */
  readonly entry: string
  /** Directory holding the manifest, for the panel's own assets. */
  readonly directory: string
}

/**
 * The contract version this build implements.
 *
 * A *type*, not a value: this package has no runtime, so importing a constant
 * from it would fail the moment a panel actually ran.
 */
export type ApiVersion = 1

/** An undo for anything a panel registers. */
export type Disposable = () => void

/**
 * Where a component can be put.
 *
 * The set is closed, and each seat has its own size policy that a panel cannot
 * change: the terminal is a fixed cell grid, so geometry belongs to the frame.
 *
 * Two kinds. **Exclusive** seats (`main`, `dock.cwd`, `dock.input`, `rail`,
 * `pane`) belong to one owner; a second plugin asking for one is refused with the
 * occupant's id in the message, because a silent replacement looks exactly like a
 * plugin that never loaded. **Stacked** seats (`dock.pending`, `dock.status`)
 * draw every owner's rows in registration order.
 */
export type SeatId =
  /** The transcript viewport. Exclusive. */
  | 'main'
  /** Rows directly above the composer. Stacked. */
  | 'dock.pending'
  /** The working-directory row. Exclusive, and absent while the rail is shown. */
  | 'dock.cwd'
  /** The composer. Exclusive; a picker borrows the slot rather than sharing it. */
  | 'dock.input'
  /** The status row under the composer. Stacked. */
  | 'dock.status'
  /** Left column. Exclusive; yields its width on a narrow terminal. */
  | 'rail'
  /** Right column: a program in a pty. Exclusive. */
  | 'pane'

/** Rows a panel returns; plain strings, no styling API to learn. */
export interface PanelView {
  /**
   * Render to lines for the given width.
   * @param width - columns available to this seat.
   * @returns one string per row, each no wider than `width`.
   */
  render(width: number): string[]
}

/** Read-only facts about the window, refreshed on every call. */
export interface PluginSnapshot {
  /** The Session this window is showing, once one is open. */
  readonly sessionId: string | undefined
  /** The directory that Session runs in. */
  readonly cwd: string
  readonly model: { readonly provider: string; readonly model: string } | undefined
  /**
   * The thinking level the model runs at (`off`, `low`, `high`, `max`, …), the
   * same one the footer names. Absent for a model that does not reason.
   */
  readonly thinkingLevel?: string
  /** A turn is running. */
  readonly busy: boolean
  readonly turnStartedAt: number | undefined
  readonly metrics: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly contextTokens?: number
    readonly contextLimit?: number
  }
  /** The event connection dropped and the client is waiting to reconnect. */
  readonly disconnected: boolean
  /** Every non-subagent Session the Host reports, freshest first. */
  readonly sessions: readonly {
    readonly id: string
    readonly title?: string
    readonly cwd?: string
    readonly running: boolean
  }[]
}

/** What `activate(tui)` receives. */
export interface PanelApi {
  /** The contract version, the same number the manifest declares. */
  readonly apiVersion: number
  /**
   * This plugin's own directory under the state root, created before `activate`.
   * Store settings and caches here — never in the user's workspace.
   */
  readonly dataDir: string
  /**
   * Put rows into one of the frame's seats.
   * @param seat - which seat.
   * @param options - the id this entry is known by inside that seat.
   * @param view - the rows to draw.
   * @returns idempotent removal.
   */
  seat(seat: SeatId, options: { id: string }, view: PanelView): Disposable
  /**
   * Add a `/command`.
   * @param name - the word after the slash, without it.
   * @param description - one line, shown by `/help`.
   * @param run - receives the trimmed argument string.
   * @returns idempotent removal.
   */
  command(name: string, description: string, run: (argument: string) => void | Promise<void>): Disposable
  /** Write one line into the conversation. */
  notice(text: string): void
  /** Write one error line into the conversation. */
  error(text: string): void
  /** Ask for a frame now. */
  refresh(): void
  /** The window's current facts. */
  state(): PluginSnapshot
  /** Write to the client's console, tagged with the panel id. */
  log(level: 'info' | 'error', message: string): void
}

/**
 * The function an entry module must export.
 *
 * Returning a function is optional; it runs before anything the facade owns is
 * removed, which is the place for a timer or a child process the panel started
 * outside `seat`/`command`.
 */
export type PanelActivate = (tui: PanelApi) => void | Disposable | Promise<void | Disposable>
