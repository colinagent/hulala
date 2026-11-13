/**
 * The sidebar: one child program in a pty, rendered as terminal cells.
 *
 * The column shows either the built-in terminal (`Ctrl-T`) or Hulala's Neovim
 * (`Ctrl-D`); at most one is painted at a time, but neither process is the
 * other's casualty. Switching columns, losing focus to the composer and hiding
 * the sidebar all keep the shell's jobs and Neovim's buffers alive. A process
 * ends when it exits on its own, when `Ctrl-D` asks Neovim to leave, when the
 * Session changes, or when the window closes.
 *
 * That ownership is the reason this is a plugin. A pty is the one resource in this
 * client that survives everything else: hiding the sidebar or losing focus keeps
 * both processes alive on purpose, switching Sessions must kill them, and a
 * window that ends for any reason must not leave a `node-pty` child behind. Here
 * the rule is one `ctx.effect`, which is the only form of cleanup that cannot be
 * forgotten.
 *
 * @module hulala-cli/tui/plugins/panes
 */
import { statSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { Component } from '@earendil-works/pi-tui'
import type { PtyModule } from '../editor/pty.js'
import { loadNodePty } from '../editor/pty.js'
import { hostPty } from '../editor/hostPty.js'
import { NvimUi } from '../editor/nvimUi.js'
import { modeReadsText, paneForSwitch, paneOwnsEscape, type PaneKind } from '../pane/focus.js'
import { startShellSession } from '../pane/shellSession.js'
import { ScreenSession } from '../pane/screenSession.js'
import { faintCursorSgr } from '../view/theme.js'
import { splitDivider } from '../view/splitDivider.js'
import { ScreenPane } from '../view/screenPane.js'
import { DIVIDER_STEP, SPLIT_MIN_SIZE } from '../view/layout.js'
import { ConfirmOverlay, type ConfirmChoice } from '../view/overlays/confirm.js'
import { t } from '../i18n/index.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The sidebar's processes, geometry and focus. */
    hulalaPanes: TuiPanes
  }
}

/** Narrowest terminal that fits a conversation and a column side by side. */
const MIN_SPLIT_COLUMNS = 82

/** The column's identity in the frame and in diagnostics. */
const SIDEBAR_ID = 'sidebar'

/** A running column: its process and the view that paints it. */
interface PaneRuntime {
  readonly kind: PaneKind
  /**
   * The program's screen. A shell renders bytes through the VT engine, the
   * editor receives cells from Neovim's UI protocol; both answer the same
   * questions, which is what keeps one renderer for the two columns.
   */
  readonly session: ScreenSession | NvimUi
  readonly view: ScreenPane
}

/** What the client asks the sidebar for. */
export interface TuiPanes {
  /** At least one column has a live process (it may be hidden). */
  readonly running: boolean
  /** The column the sidebar is showing, if any. */
  readonly visible: PaneKind | undefined
  /** The visible column is painted at this terminal width. */
  readonly shown: boolean
  /** The keyboard is in the visible column. */
  readonly focused: boolean
  /**
   * Run `kind` in `cwd`, reusing a live process.
   * @returns true when a process is running afterwards.
   */
  open(kind: PaneKind, cwd: string): boolean
  /**
   * `Ctrl-T` / `Ctrl-D`: open `kind` and focus it, or put the sidebar away when
   * that same column is already painted.
   *
   * Visibility only, decided on which column is painted and never on where the
   * keyboard is: a painted terminal is hidden and a painted editor is asked to
   * leave even when the composer or the rail has the keyboard. Moving focus into
   * an open column is `Ctrl-]`.
   */
  toggle(kind: PaneKind, cwd: string): void
  /** Show `kind` and put the keyboard there, starting it if needed. */
  focus(kind: PaneKind, cwd: string): void
  /**
   * The column `Ctrl-]` should focus without starting a program: the visible
   * one, else the last closed one whose process is still alive.
   */
  switchable(): PaneKind | undefined
  /** Hide the sidebar; both processes keep running. */
  close(): void
  /** Move the keyboard back to the composer; the sidebar stays visible. */
  blur(): void
  /** Kill one column's process and hide the sidebar if that column is shown. */
  drop(kind: PaneKind): void
  /** Drop both columns and hide, e.g. because the Session changed. */
  reset(): void
  /** Drop both without repainting: the window is going away. */
  dispose(): void
  /** Write a key into the visible column's process. */
  input(data: string): void
  /** Whether the focused program keeps `Ctrl-[` (the same byte as `Esc`). */
  ownsEscape(): boolean
  /** Ask Neovim to leave, settling a refusal with a dialog. */
  leave(): Promise<boolean>
  /**
   * Write every buffer Neovim can write, without asking about the ones it cannot.
   *
   * A forced restart has no dialog to fall back on: `:wall` flushes the last
   * second of typing that the debounced autosave has not seen yet, and the
   * buffers it refuses (unnamed, read-only, changed on disk) stay as they are
   * rather than blocking the swap.
   */
  saveAll(): Promise<void>
  /** The one-column drag target the frame draws beside the sidebar. */
  readonly divider: Component
  setDividerHover(hovered: boolean): void
  dragDividerTo(screenX: number): void
  /**
   * Move the divider one keyboard step without a pointer.
   *
   * The key names the divider's direction, not the column's width: `-1` moves the
   * boundary left, which widens the column, and `1` moves it right, which
   * narrows it — the same thing a drag of that many cells does. A no-op while no
   * column is painted: there is no divider to move, and no width the
   * conversation could trade against.
   */
  moveDivider(direction: -1 | 1): void
  /**
   * Hand the frame's divider key to the editor's own divider.
   *
   * With the conversation and the rail put away there is one column left and no
   * frame boundary to move, so the key has nowhere to land. The only boundary on
   * screen is then the editor's own — Neovim's file tree — and its generated
   * config binds that to Ctrl-Left / Ctrl-Right. Kept here rather than in the
   * client's keymap because only this plugin knows which column is painted and
   * whether the program in it has a boundary of its own.
   * @param direction - `-1` moves the boundary left, `1` moves it right.
   * @returns whether the key was handed over; false leaves it to the frame.
   */
  handOffDivider(direction: -1 | 1): boolean
  /** The component focus returns to when a column lets go. */
  setComposer(composer: Component): void
}

/** Colour flag, the pty module, and the debug sink. */
export interface PanesPluginConfig {
  readonly color: boolean
  /** Injected by tests so no real shell or editor starts. */
  readonly pty?: PtyModule
  readonly debug: (message: string) => void
}

/** Whether a path is a plain local directory a process can start in. */
function isLocalDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Provide the sidebar. */
export function apply(ctx: Context, config: PanesPluginConfig): void {
  const { terminal, focus: focusOn, refreshIme, setPaging } = ctx.hulalaTerminal
  const render = ctx.hulalaRender
  const layout = ctx.hulalaLayout
  const overlays = ctx.hulalaOverlays
  const nvim = ctx.hulalaEditor
  const { reducer } = ctx.hulalaViewModel
  // The terminal column's process belongs to the Host, so this plugin needs the
  // attachment, not the client's cwd. The owning Session is read at open time:
  // injecting it would make this plugin and the session plugin depend on each
  // other, because the session plugin already injects this one.
  const backend = ctx.backend
  const sessionId = (): string | undefined => ctx.get('hulalaSession')?.id

  /** Live column processes, keyed by kind. A hidden column keeps its process. */
  const runtimes = new Map<PaneKind, PaneRuntime>()
  /** Seat removal per kind; replaced when another column takes the seat. */
  const seats = new Map<PaneKind, () => void>()
  /** The column painted in the sidebar; it stays visible when the composer has focus. */
  let visibleKind: PaneKind | undefined
  /** The column shown most recently, so `Ctrl-]` can reopen it. */
  let lastKind: PaneKind | undefined
  /** The keyboard is in the visible column. */
  let focused = false
  /** Stops hearing Neovim's mode; set only while the editor column has the keys. */
  let stopModeWatch: (() => void) | undefined
  let composer: Component | undefined
  let dividerHovered = false
  /** The pointer rests on the editor's own tree boundary. */
  let treeHovered = false
  /** The shape the terminal is currently showing. */
  let pointerResize = false
  /**
   * Width share per column, kept across closing and resizes. Both columns start
   * at a third of the terminal: the conversation keeps two thirds of the reading
   * width, and the divider still drags both ways.
   */
  const ratios: Record<PaneKind, number> = { terminal: 1 / 3, editor: 1 / 3 }

  // The frame owns the last row: the status band under the columns.
  const rows = (): number => Math.max(1, terminal.rows - 1)

  const columns = (kind: PaneKind): number => {
    const wanted = Math.round(terminal.columns * ratios[kind])
    return Math.max(SPLIT_MIN_SIZE, Math.min(terminal.columns - SPLIT_MIN_SIZE - 1, wanted))
  }

  const ptyModule = (): PtyModule | undefined => config.pty ?? loadNodePty()

  /**
   * The pty a column starts its program in.
   *
   * The terminal column runs on the Host whenever the attachment can carry a
   * terminal, which is what makes a local and a remote Host the same code path;
   * the editor column keeps the local pty until its UI attachment lands.
   * @param kind - the column asking.
   * @param report - called with the reason when the Host refuses the terminal.
   * @returns the pty module, or undefined when this attachment has none.
   */
  const moduleFor = (kind: PaneKind, report: (message: string) => void): PtyModule | undefined => {
    if (config.pty !== undefined) return config.pty
    if (kind === 'terminal') {
      const terminals = backend.terminal
      const owner = sessionId()
      if (terminals === undefined || owner === undefined) return undefined
      return hostPty({ terminal: terminals, sessionId: owner, onFailure: report })
    }
    return loadNodePty()
  }

  const dragDividerTo = (screenX: number): void => {
    const kind = visibleKind
    if (kind === undefined) return
    const width = terminal.columns
    if (width <= 0) return
    // The pointer is on the divider column, so the column starts one cell after.
    ratios[kind] = Math.min(0.75, Math.max(0.25, (width - screenX - 1) / width))
    const paneWidth = columns(kind)
    layout.resizePane(paneWidth)
    // The program is told directly: a repaint that happens to carry a new width
    // must not be the only way a column learns its size, or a program that owns
    // its own grid (Neovim) would keep drawing at the old one.
    runtimes.get(kind)?.session.resize(paneWidth, rows())
    render.request()
  }

  /**
   * One keyboard step of the divider.
   *
   * The step goes through the same arithmetic as the pointer: the pointer's
   * column is derived from the width the column has now, so a key and a drag
   * can never disagree about where the boundary sits, and both share the same
   * limits. Which column the resize lands on is the painted one, because that
   * is the column the divider belongs to.
   * @param direction - `-1` moves the boundary left (the column widens), `1`
   * moves it right (the column narrows).
   */
  const moveDivider = (direction: -1 | 1): void => {
    const kind = visibleKind
    if (kind === undefined || layout.paneId === undefined) return
    const width = terminal.columns
    if (width <= 0) return
    dragDividerTo(width - columns(kind) - 1 + direction * DIVIDER_STEP)
  }

  /**
   * Give the divider key to the painted editor, which has a boundary of its own.
   *
   * The bytes are the legacy encoding of Ctrl-Left / Ctrl-Right, the pair the
   * generated Neovim config binds to the file tree's edge: the column's program
   * speaks the same legacy encoding a terminal would send it.
   * @param direction - `-1` moves the boundary left, `1` moves it right.
   * @returns whether the editor took the key.
   */
  const handOffDivider = (direction: -1 | 1): boolean => {
    if (!focused || visibleKind !== 'editor') return false
    const runtime = runtimes.get('editor')
    if (runtime === undefined) return false
    runtime.session.input(direction < 0 ? '\u001b[1;5D' : '\u001b[1;5C')
    return true
  }

  /**
   * The pointer shape the terminal shows: a resize cursor while it rests on any
   * divider, whether the frame draws it or the program in the column does.
   *
   * OSC 22 is how a terminal program asks for a pointer shape (Ghostty, kitty,
   * xterm); terminals without it simply ignore the sequence.
   */
  const applyPointerShape = (): void => {
    const resize = dividerHovered || treeHovered
    if (resize === pointerResize) return
    pointerResize = resize
    terminal.write(resize ? '\u001b]22;ew-resize\u001b\\' : '\u001b]22;default\u001b\\')
    render.request()
  }

  const setDividerHover = (hovered: boolean): void => {
    if (dividerHovered === hovered) return
    dividerHovered = hovered
    applyPointerShape()
  }

  /** The tree's own rule, which Neovim draws and resizes but cannot shape. */
  const treeDivider = {
    // Only the editor column knows: the Host forwards the boundary Neovim
    // reports, and a column that is not open has no tree to point at.
    column: () => {
      const runtime = runtimes.get('editor')
      return runtime?.session instanceof NvimUi ? runtime.session.treeEdge() : undefined
    },
    hovered: () => treeHovered,
    setHovered: (hovered: boolean) => {
      if (treeHovered === hovered) return
      treeHovered = hovered
      applyPointerShape()
    },
  }

  const divider = splitDivider({
    rows,
    color: config.color,
    background: () => {
      const runtime = visibleKind === undefined ? undefined : runtimes.get(visibleKind)
      return runtime?.session.backgroundAnsi() ?? ''
    },
    onDrag: dragDividerTo,
    onHover: setDividerHover,
  })
  /** The visible column's runtime, if one is painted. */
  const visibleRuntime = (): PaneRuntime | undefined => visibleKind === undefined ? undefined : runtimes.get(visibleKind)

  const blur = (): void => {
    config.debug(`blurPane focused=${String(focused)} visible=${String(visibleKind)} overlays=${overlays.open}`)
    if (!focused) return
    focused = false
    // Nobody is asking what Neovim's mode means any more, and a hidden column
    // must not move the input source under whoever does hold the keyboard.
    stopModeWatch?.()
    stopModeWatch = undefined
    setPaging(true)
    setDividerHover(false)
    // Leaving the column returns to the conversation, bringing it back if it was
    // put away with `Shift-Cmd-C`: the composer has to be on screen to take the
    // keyboard. The sidebar itself stays open.
    if (!layout.conversationShown) layout.setConversationVisible(true)
    if (composer !== undefined) focusOn(composer)
    render.request()
  }

  const close = (): void => {
    config.debug(`closePane visible=${String(visibleKind)} focused=${String(focused)} overlays=${overlays.open}`)
    if (layout.paneId === undefined) return
    const hadFocus = focused
    if (visibleKind !== undefined) lastKind = visibleKind
    blur()
    visibleKind = undefined
    layout.setPane(undefined)
    // `blur()` brings a hidden conversation back when the sidebar had the
    // keyboard. Without focus, the rail keeps the keyboard it had; a frame with
    // no side column left restores the conversation in the layout itself.
    if (hadFocus) focusOn(composer!)
    render.request()
  }

  /** Put a runtime's view in the pane seat, replacing whichever column was there. */
  const registerSeat = (kind: PaneKind, runtime: PaneRuntime): void => {
    seats.get(kind)?.()
    seats.set(kind, layout.register('pane', {
      id: SIDEBAR_ID,
      component: runtime.view,
      divider: divider.component,
      width: () => columns(kind),
      // When the conversation is put away the rail absorbs the leftover width,
      // so the rail's divider is the pane's right edge and this seat owns it.
      onResize: (width: number) => dragDividerTo(terminal.columns - Math.round(width) - 1),
      onConversationPointer: () => {
        divider.setHovered(false)
        treeDivider.setHovered(false)
      },
    }))
  }

  /**
   * Ask the editor column to run one command line.
   *
   * A pty editor reads the bytes a terminal would send; a UI editor takes
   * notation, where `\u001b` would otherwise read as an Alt chord.
   * @param session - the editor column's screen.
   * @param line - the Ex command line, without the colon or terminator.
   */
  const editorCommand = (session: ScreenSession | NvimUi, line: string): void => {
    if (session instanceof NvimUi) session.inputNotation(`<Esc>:${line}<CR>`)
    else session.input(`\u001b:${line}\r`)
  }

  /**
   * Forget a column whose process exited.
   * @param kind - the column that is gone.
   */
  const drop = (kind: PaneKind): void => {
    config.debug(`dropPane kind=${kind} visible=${String(visibleKind)} focused=${String(focused)} overlays=${overlays.open}`)
    const runtime = runtimes.get(kind)
    if (runtime === undefined) return
    runtimes.delete(kind)
    seats.get(kind)?.()
    seats.delete(kind)
    // The process is this plugin's, so killing it is this plugin's too: `drop`
    // runs both when the program exited on its own (nothing to kill) and when
    // the client abandons it (everything to kill).
    runtime.session.dispose()
    if (kind === 'editor') {
      // The process can exit while its dialog is still up (a slow quit beats the
      // grace period); settle it instead of leaving the keyboard disabled.
      overlays.cancelEditorModals()
    }
    if (visibleKind === kind) close()
    render.request()
  }

  const mount = (kind: PaneKind, session: ScreenSession | NvimUi): PaneRuntime => {
    const view = new ScreenPane({
      screen: session,
      // Only a shell needs the column's own history; Neovim owns its scrolling.
      ...(kind === 'terminal' && session instanceof ScreenSession ? { scroll: session } : {}),
      rows,
      color: config.color,
      faintCursor: () => faintCursorSgr(config.color, nvim.theme.background, nvim.theme.foreground),
      // The column's caret is the terminal's own cursor, so the shape Neovim asks
      // for with DECSCUSR is passed on with the frame that carries the caret.
      onCaret: shape => ctx.hulalaTerminal.setCaretShape(shape),
      // Neovim is the one column that always tracks the mouse: clicks, visual
      // selection and the file tree's own boundary all run on these reports.
      ...(kind === 'editor' ? { mouse: true, divider: treeDivider } : {}),
      onScroll: () => { if (visibleKind === kind) render.request() },
      onPointer: () => layout.clearDividerHover(),
    })
    const runtime: PaneRuntime = { kind, session, view }
    runtimes.set(kind, runtime)
    return runtime
  }

  /**
   * Report why a column cannot start, naming the column the key chose.
   *
   * A Host older than this client answers an unknown Remote namespace with an
   * opaque gateway fault, which reads as a transport bug. It is not: the Host
   * simply predates the pane, and the way out is an update.
   */
  const unavailable = (kind: PaneKind, reason: string): false => {
    const pane = t(kind === 'editor' ? 'pane.editor' : 'pane.terminal')
    const stale = /transport failure|gateway\/internal/u.test(reason)
    reducer.addNotice(stale
      ? t('pane.hostBehind', { pane })
      : t('pane.unavailable', { pane, reason }))
    render.repaint()
    return false
  }

  const open = (kind: PaneKind, cwd: string): boolean => {
    config.debug(`openPane kind=${kind} cwd=${cwd} running=${String(runtimes.has(kind))}`)
    if (runtimes.has(kind)) return true
    // A Host-owned column is created in the Session's own directory, which the
    // Host validates: over SSH that directory is on the other machine, so a local
    // `stat` here would refuse a path that exists exactly where it matters.
    const hosted = config.pty === undefined
      && (kind === 'terminal' ? backend.terminal !== undefined : backend.editor !== undefined)
    if (!hosted) {
      const pty = moduleFor(kind, message => unavailable(kind, message))
      if (pty === undefined) {
        // Only when this attachment has no terminal at all (no Host terminal, no
        // Bun and no node-pty).
        return unavailable(kind, t('pane.noPty'))
      }
      if (!isLocalDirectory(cwd)) return unavailable(kind, t('pane.notDirectory', { path: cwd }))
    }
    if (terminal.columns < MIN_SPLIT_COLUMNS) {
      return unavailable(kind, t('pane.tooNarrow', { columns: MIN_SPLIT_COLUMNS }))
    }
    if (kind === 'editor') {
      const hostEditor = backend.editor
      if (hostEditor === undefined) return unavailable(kind, t('pane.noEditor'))
      // The Host owns Neovim, so the column is a UI: open the channel, then draw
      // whatever cells Neovim sends. A failure arrives as a notice and drops the
      // column instead of leaving an empty frame.
      const channel = hostEditor.connect()
      const cols = columns('editor')
      const height = rows()
      // The mode drives the input source, and it arrives with the grid, so the
      // view is captured rather than looked up: a mode event can land before
      // this function returns.
      let runtime: PaneRuntime | undefined
      let session: NvimUi | undefined
      channel.onTree(column => { session?.setTreeEdge(column) })
      session = new NvimUi({
        channel,
        cols,
        rows: height,
        color: config.color,
        onScreen: () => { if (visibleKind === 'editor') render.request() },
        onExit: (exitCode) => {
          config.debug(`paneExit kind=editor code=${exitCode}`)
          drop('editor')
        },
        onMode: mode => {
          if (runtime === undefined) return
          runtime.view.imePolicy = modeReadsText(mode) ? 'text' : 'command'
          refreshIme()
        },
      })
      runtime = mount('editor', session)
      runtime.view.imePolicy = modeReadsText(session.currentMode()) ? 'text' : 'command'
      void channel.open({ cwd, cols, rows: height, theme: nvim.theme })
        .catch((caught: unknown) => {
          drop('editor')
          unavailable('editor', caught instanceof Error ? caught.message : String(caught))
        })
      return true
    } else {
      // The terminal column still needs a pty module: a Host terminal reaches it
      // through `hostPty`, a test through its own.
      const pty = moduleFor('terminal', message => unavailable('terminal', message))
      if (pty === undefined) return unavailable('terminal', t('pane.noPty'))
      try {
        // A hosted pty ignores the command: the Host's execution world picks the
        // shell, because a client `$SHELL` names a path on the wrong machine.
        const session = startShellSession({
          pty,
          cwd,
          cols: columns('terminal'),
          rows: rows(),
          onScreen: () => { if (visibleKind === 'terminal') render.request() },
          onExit: (exitCode) => {
            config.debug(`paneExit kind=terminal code=${exitCode}`)
            drop('terminal')
          },
        })
        mount('terminal', session)
      } catch (caught) {
        // A missing or unusable `$SHELL` throws from the pty spawn.
        return unavailable(kind, caught instanceof Error ? caught.message : String(caught))
      }
    }
    return true
  }

  /**
   * Let Neovim decide whether this column reads text or commands.
   *
   * Insert mode is the user writing, so it takes their own input source; normal,
   * visual, command-line and terminal modes are instructions. The mode arrives as
   * a `mode_change` event on the column's own channel, so this only reads what
   * Neovim last said rather than watching a file.
   * @param runtime - the column that just took the keyboard.
   */
  const followEditorMode = (runtime: PaneRuntime): void => {
    stopModeWatch?.()
    stopModeWatch = undefined
    if (!(runtime.session instanceof NvimUi)) return
    runtime.view.imePolicy = modeReadsText(runtime.session.currentMode()) ? 'text' : 'command'
  }

  const focus = (kind: PaneKind, cwd: string): void => {
    config.debug(`focusPane kind=${kind} overlay=${overlays.open}`)
    if (!open(kind, cwd)) return
    const runtime = runtimes.get(kind)
    if (runtime === undefined) return
    visibleKind = kind
    lastKind = kind
    focused = true
    setPaging(false)
    // Register before showing so the pane seat already holds this column when
    // the frame is rebuilt; registering alone does not paint a hidden sidebar.
    registerSeat(kind, runtime)
    layout.setPane(SIDEBAR_ID)
    followEditorMode(runtime)
    focusOn(runtime.view)
    render.repaint()
  }

  const toggle = (kind: PaneKind, cwd: string): void => {
    // The key is a visibility toggle for its own column: whoever has the keyboard
    // does not matter. A painted terminal hides (and keeps its jobs), a painted
    // editor is asked to leave (it can lose unwritten buffers). Moving the
    // keyboard into a column that is still open is `Ctrl-]`. A column the layout
    // cannot paint (a terminal narrowed below the split minimum) is re-opened
    // instead, because there is nothing on screen to close.
    if (visibleKind === kind && layout.paneId !== undefined) {
      if (kind === 'editor') void leave()
      else close()
      return
    }
    focus(kind, cwd)
  }

  /** The column `Ctrl-]` can focus without starting a program. */
  const switchable = (): PaneKind | undefined => paneForSwitch(
    { visible: visibleKind, last: lastKind },
    kind => runtimes.has(kind),
  )

  /** Resolve once Neovim is gone. */
  const gone = async (graceMs: number): Promise<boolean> => {
    const deadline = Date.now() + graceMs
    while (runtimes.has('editor')) {
      if (Date.now() >= deadline) return false
      await new Promise(resolve => setTimeout(resolve, 40))
    }
    return true
  }

  /**
   * End the editor column, asking only when Neovim refuses to leave.
   *
   * `:qa` is the question: Neovim exits when every buffer can be written and
   * refuses (E37) when one cannot — an unnamed draft, a read-only file, a
   * directory that disappeared. Autosave already wrote everything it could, so
   * a refusal is the one case worth a dialog. No step may leave Neovim waiting
   * on a prompt, or the column would look frozen: every write is `silent!`, and
   * the failure is reported in the dialog.
   */
  const leave = async (): Promise<boolean> => {
    let failedSave = false
    for (;;) {
      const editor = runtimes.get('editor')
      if (editor === undefined) return true
      editorCommand(editor.session, 'qa')
      // A UI column reports its exit, so waiting costs nothing and a slow quit
      // finishes without a dialog; a pty column keeps the old short grace, where
      // "gone" is the only signal there is.
      const grace = editor.session instanceof NvimUi ? (failedSave ? 1_500 : 1_500) : failedSave ? 1_500 : 1_200
      if (await gone(grace)) return true
      const choice = await overlays.modal<ConfirmChoice>(
        done => new ConfirmOverlay({ color: config.color, failedSave, onChoose: done }),
        { anchor: 'center', width: 56 },
        { value: 'cancel' },
      )
      if (choice === 'cancel') return false
      const session = runtimes.get('editor')?.session
      if (session === undefined) return true
      if (choice === 'discard') {
        editorCommand(session, 'qa!')
        return await gone(800)
      }
      editorCommand(session, 'silent! wall')
      failedSave = true
    }
  }

  const reset = (): void => {
    close()
    for (const kind of [...runtimes.keys()]) drop(kind)
  }

  const saveAll = async (): Promise<void> => {
    const editor = runtimes.get('editor')
    if (editor === undefined) return
    // `silent!` keeps a refusal (an unnamed buffer) from painting over the frame;
    // the wait is the pty round trip, not the size of the file.
    editorCommand(editor.session, 'silent! wall')
    await new Promise(resolve => setTimeout(resolve, 250))
  }

  /** Stop every process without repainting: the window is going away. */
  const dispose = (): void => {
    focused = false
    visibleKind = undefined
    for (const kind of [...runtimes.keys()]) {
      const runtime = runtimes.get(kind)
      seats.get(kind)?.()
      seats.delete(kind)
      runtime?.session.dispose()
    }
    runtimes.clear()
  }

  ctx.effect(() => () => {
    dispose()
    layout.setPane(undefined)
  }, 'hulala: pane processes')

  ctx.provide('hulalaPanes', {
    get running() { return runtimes.size > 0 },
    get visible() { return visibleKind },
    get shown() { return layout.paneId === SIDEBAR_ID },
    get focused() { return focused },
    open,
    toggle,
    focus,
    switchable,
    close,
    blur,
    drop,
    reset,
    dispose,
    input: (data: string) => { visibleRuntime()?.session.input(data) },
    ownsEscape: () => {
      const runtime = focused ? visibleRuntime() : undefined
      if (runtime === undefined) return false
      return paneOwnsEscape(runtime.kind, {
        editorMode: runtime.kind === 'editor' && runtime.session instanceof NvimUi
          ? runtime.session.currentMode()
          : undefined,
        alternateScreen: runtime.kind === 'terminal' && runtime.session.alternateScreen(),
      })
    },
    leave,
    saveAll,
    get divider() { return divider.component },
    setDividerHover,
    dragDividerTo,
    moveDivider,
    handOffDivider,
    setComposer: (component: Component) => { composer = component },
  })
}

/** Cordis object-form plugin. */
export const panesPlugin = {
  name: 'hulala-panes',
  inject: ['hulalaTerminal', 'hulalaRender', 'hulalaLayout', 'hulalaOverlays', 'hulalaEditor', 'hulalaViewModel', 'backend'],
  apply,
}
