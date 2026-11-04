/**
 * The right column: one child program in a pty, rendered as terminal cells.
 *
 * Today that program is always Hulala's Neovim, but nothing here assumes it: the
 * column is a `ScreenSession` (pty bytes → `@xterm/headless` cells →
 * `ScreenPane` lines) plus the geometry and focus that go with it. The editor's
 * own files, environment and reported state live in the editor plugin; this one
 * owns the *process*, and therefore owns its lifetime.
 *
 * That ownership is the reason it is a plugin. A pty is the one resource in this
 * client that survives everything else: closing the column keeps it alive on
 * purpose, switching Sessions must kill it, and a window that ends for any
 * reason must not leave a `node-pty` child behind. Here the rule is one
 * `ctx.effect`, which is the only form of cleanup that cannot be forgotten.
 *
 * @module hulala-cli/tui/plugins/panes
 */
import { statSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { Component } from '@earendil-works/pi-tui'
import type { PtyModule } from '../editor/pty.js'
import { loadNodePty } from '../editor/pty.js'
import { ENGLISH_INPUT_SOURCE, inputSource } from '../editor/inputSource.js'
import { startNvimSession } from '../editor/nvimSession.js'
import { editorOwnsEscape } from '../pane/focus.js'
import type { ScreenSession } from '../pane/screenSession.js'
import { faintCursorSgr } from '../view/theme.js'
import { columnRule, splitDivider } from '../view/splitDivider.js'
import { ScreenPane } from '../view/screenPane.js'
import { SPLIT_MIN_SIZE } from '../view/layout.js'
import { ConfirmOverlay, type ConfirmChoice } from '../view/overlays/confirm.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The right column's process and focus. */
    hulalaPanes: TuiPanes
  }
}

/** Narrowest terminal that fits a conversation and a column side by side. */
const MIN_SPLIT_COLUMNS = 82

/** The column's identity in the frame and in diagnostics. */
const PANE_ID = 'editor'

/** A running column: its process and the view that paints it. */
interface PaneRuntime {
  readonly session: ScreenSession
  readonly view: ScreenPane
}

/** What the client asks the column for. */
export interface TuiPanes {
  /** A process is running (the column may still be hidden). */
  readonly running: boolean
  /** The column is on screen at this terminal width. */
  readonly shown: boolean
  /** The keyboard is in the column. */
  readonly focused: boolean
  /**
   * Run the column in `cwd`, reusing a live process.
   * @returns true when a process is running afterwards.
   */
  open(cwd: string): boolean
  /** Reach the column, or close it when the keyboard is already there. */
  toggle(cwd: string): void
  /** Move the keyboard into the column, starting it if needed. */
  focus(cwd: string): void
  /** Hide the column; the process keeps running. */
  close(): void
  /** Move the keyboard back to the composer. */
  blur(): void
  /** Kill the process and hide the column. */
  drop(): void
  /** Drop and hide, e.g. because the Session (and so the directory) changed. */
  reset(): void
  /** Drop without repainting: the window is going away. */
  dispose(): void
  /** Write a key into the running process. */
  input(data: string): void
  /** Whether the focused program keeps `Ctrl-[` (the same byte as `Esc`). */
  ownsEscape(): boolean
  /** Ask the program to leave, settling a refusal with a dialog. */
  leave(): Promise<boolean>
  /** The one-column drag target the frame draws beside the column. */
  readonly divider: Component
  /** The rule the rail layout draws between rail and conversation. */
  readonly railDivider: Component
  setDividerHover(hovered: boolean): void
  dragDividerTo(screenX: number): void
  /** The component focus returns to when the column lets go. */
  setComposer(composer: Component): void
}

/** Colour flag, the pty module, and the debug sink. */
export interface PanesPluginConfig {
  readonly color: boolean
  /** Injected by tests so no real shell or editor starts. */
  readonly pty?: PtyModule
  readonly debug: (message: string) => void
}

/** Whether a path is a plain local directory an editor can open. */
function isLocalDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Provide the right column. */
export function apply(ctx: Context, config: PanesPluginConfig): void {
  const { terminal, screen, setPaging } = ctx.hulalaTerminal
  const render = ctx.hulalaRender
  const layout = ctx.hulalaLayout
  const overlays = ctx.hulalaOverlays
  const nvim = ctx.hulalaEditor
  const { reducer } = ctx.hulalaViewModel

  let runtime: PaneRuntime | undefined
  let focused = false
  let composer: Component | undefined
  let seat: (() => void) | undefined
  let conflictTimer: ReturnType<typeof setInterval> | undefined
  let dividerHovered = false
  /** Width share of the column, kept across closing and resizes. */
  let ratio = 0.5
  /** Input source to put back when the column loses focus. */
  let savedInputSource: string | undefined
  /** Invalidates a focus-time read whose pane was already left. */
  let inputTicket = 0

  const rows = (): number => Math.max(1, terminal.rows - 1)

  const columns = (): number => {
    const wanted = Math.round(terminal.columns * ratio)
    return Math.max(SPLIT_MIN_SIZE, Math.min(terminal.columns - SPLIT_MIN_SIZE - 1, wanted))
  }

  const ptyModule = (): PtyModule | undefined => config.pty ?? loadNodePty()

  /**
   * Switch the terminal to English while the column has focus. The program runs
   * in a pty and cannot reach the input method itself, and hiding the column
   * keeps the process alive, so the client owns the switch.
   */
  const takeInputSource = (): void => {
    const source = inputSource(nvim.ime)
    if (source === undefined) return
    const ticket = (inputTicket += 1)
    void source.current().then(id => {
      if (ticket !== inputTicket) return
      savedInputSource = id
      if (id !== ENGLISH_INPUT_SOURCE) source.select(ENGLISH_INPUT_SOURCE)
    })
  }

  /** Put back the source the composer had before the column took focus. */
  const releaseInputSource = (): void => {
    inputTicket += 1
    if (savedInputSource === undefined) return
    inputSource(nvim.ime)?.select(savedInputSource)
    savedInputSource = undefined
  }

  const dragDividerTo = (screenX: number): void => {
    const width = terminal.columns
    if (width <= 0) return
    // The pointer is on the divider column, so the column starts one cell after.
    ratio = Math.min(0.75, Math.max(0.25, (width - screenX - 1) / width))
    layout.resizePane(columns())
    render.request()
  }

  const setDividerHover = (hovered: boolean): void => {
    if (dividerHovered === hovered) return
    dividerHovered = hovered
    // OSC 22 is how a terminal program asks for a resize pointer (Ghostty,
    // kitty, xterm); terminals without it simply ignore the sequence.
    terminal.write(hovered ? '\u001b]22;ew-resize\u001b\\' : '\u001b]22;default\u001b\\')
    render.request()
  }

  const divider = splitDivider({
    rows,
    color: config.color,
    background: () => runtime?.session.backgroundAnsi() ?? '',
    onDrag: dragDividerTo,
    onHover: setDividerHover,
  })
  const railDivider = columnRule(rows, config.color)

  const blur = (): void => {
    config.debug(`blurPane focused=${String(focused)} visible=${String(layout.paneId)}`)
    if (!focused) return
    focused = false
    releaseInputSource()
    setPaging(true)
    setDividerHover(false)
    if (composer !== undefined) screen.setFocus(composer)
    render.request()
  }

  const close = (): void => {
    config.debug(`closePane visible=${String(layout.paneId)} focused=${String(focused)} overlays=${overlays.open}`)
    if (layout.paneId === undefined) return
    blur()
    layout.setPane(undefined)
    screen.setFocus(composer!)
  }

  const drop = (): void => {
    config.debug(`dropPane visible=${String(layout.paneId)} focused=${String(focused)} overlays=${overlays.open}`)
    if (runtime === undefined) return
    const gone = runtime.session
    runtime = undefined
    seat?.()
    seat = undefined
    // The process is this plugin's, so killing it is this plugin's too: `drop`
    // runs both when the program exited on its own (nothing to kill) and when
    // the client abandons it (everything to kill).
    gone.dispose()
    if (conflictTimer !== undefined) {
      clearInterval(conflictTimer)
      conflictTimer = undefined
    }
    nvim.clearMarkers()
    // The process can exit while its dialog is still up (a slow quit beats the
    // grace period); settle it instead of leaving the keyboard disabled.
    overlays.cancelEditorModals()
    if (layout.paneId === PANE_ID) close()
    render.request()
  }

  const mount = (session: ScreenSession): void => {
    const view = new ScreenPane({
      screen: session,
      rows,
      color: config.color,
      faintCursor: () => faintCursorSgr(config.color, nvim.theme.background, nvim.theme.foreground),
      onPointer: () => divider.setHovered(false),
    })
    runtime = { session, view }
    // The frame shows whatever the pane seat holds; opening the column is the
    // pty's business, showing it is the layout's.
    seat?.()
    seat = layout.register('pane', {
      id: PANE_ID,
      component: view,
      divider: divider.component,
      width: columns,
      onConversationPointer: () => divider.setHovered(false),
    })
  }

  /**
   * Turn a reported file conflict into a question.
   *
   * Autosave refuses to write a buffer whose file the agent rewrote and appends
   * the path to a marker file. Asking here is the point: Neovim's own `y/N`
   * prompt appears on the mode line while the user is typing, swallows the next
   * keystroke, and blocks forever when the column has no focus.
   */
  const checkConflict = (): void => {
    const path = nvim.takeConflict()
    if (path === undefined) return
    const answer = overlays.showConflict(path)
    // Shown from a timer, so nothing else schedules the frame that paints it.
    render.request()
    void answer.then(choice => {
      if (choice === 'later') return
      runtime?.session.input(choice === 'keep' ? '\u001b:write!\r' : '\u001b:edit!\r')
    })
  }

  const open = (cwd: string): boolean => {
    if (runtime !== undefined) return true
    const pty = ptyModule()
    if (pty === undefined) {
      // Only when this runtime has no pty at all (no Bun and no node-pty).
      reducer.addNotice('editor unavailable: no pty backend in this install')
      render.repaint()
      return false
    }
    if (!isLocalDirectory(cwd)) {
      reducer.addNotice(`editor unavailable: ${cwd} is not a local directory`)
      render.repaint()
      return false
    }
    if (terminal.columns < MIN_SPLIT_COLUMNS) {
      reducer.addNotice(`editor needs a terminal at least ${MIN_SPLIT_COLUMNS} columns wide`)
      render.repaint()
      return false
    }
    try {
      nvim.prepare()
    } catch (caught) {
      reducer.addNotice(`editor unavailable: ${caught instanceof Error ? caught.message : String(caught)}`)
      render.repaint()
      return false
    }
    nvim.resetMode()
    const session = startNvimSession({
      pty,
      command: nvim.command,
      // Resolved after publishing, so the editor's `rg` is the copy in `<data>/bin`.
      env: nvim.environment(),
      cwd,
      cols: columns(),
      rows: rows(),
      onScreen: () => { if (layout.paneId === PANE_ID) render.request() },
      onExit: () => { drop() },
    })
    if (conflictTimer === undefined) conflictTimer = setInterval(checkConflict, 1_000)
    mount(session)
    return true
  }

  const focus = (cwd: string): void => {
    if (!open(cwd)) return
    focused = true
    setPaging(false)
    takeInputSource()
    layout.setPane(PANE_ID)
    if (runtime !== undefined) screen.setFocus(runtime.view)
    render.repaint()
  }

  const toggle = (cwd: string): void => {
    if (layout.paneId === PANE_ID && focused) {
      // Closing can lose unwritten buffers, so it asks the program first; the
      // process exiting is what drops the column.
      void leave()
      return
    }
    focus(cwd)
  }

  /** Resolve once the program is gone. */
  const gone = async (graceMs: number): Promise<boolean> => {
    const deadline = Date.now() + graceMs
    while (runtime !== undefined) {
      if (Date.now() >= deadline) {
        // Give a committed quit a long finish window; never show a dialog for it.
        if (!nvim.leaveCommitted()) return false
        if (Date.now() >= deadline + 8_000) return false
      }
      await new Promise(resolve => setTimeout(resolve, 40))
    }
    return true
  }

  /**
   * End the column, asking only when Neovim refuses to leave.
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
      if (runtime === undefined) return true
      nvim.resetLeave()
      runtime.session.input('\u001b:qa\r')
      // Neovim writes on quit (`QuitPre`), so a clean editor can take a second
      // to leave; only a refusal needs the dialog.
      if (await gone(failedSave ? 1500 : 1200)) return true
      const choice = await overlays.modal<ConfirmChoice>(
        done => new ConfirmOverlay({ color: config.color, failedSave, onChoose: done }),
        { anchor: 'center', width: 56 },
        { value: 'cancel' },
      )
      if (choice === 'cancel') return false
      const session = runtime?.session
      if (session === undefined) return true
      if (choice === 'discard') {
        session.input('\u001b:qa!\r')
        return await gone(800)
      }
      session.input('\u001b:silent! wall\r')
      failedSave = true
    }
  }

  const reset = (): void => {
    close()
    drop()
  }

  ctx.effect(() => () => {
    if (conflictTimer !== undefined) {
      clearInterval(conflictTimer)
      conflictTimer = undefined
    }
    // Killing here rather than through `drop`: the UI is about to stop, so the
    // exit handler must not try to repaint or refocus.
    runtime?.session.dispose()
    runtime = undefined
    seat?.()
    seat = undefined
    layout.setPane(undefined)
    releaseInputSource()
  }, 'hulala: pane process')

  ctx.provide('hulalaPanes', {
    get running() { return runtime !== undefined },
    get shown() { return layout.paneId === PANE_ID },
    get focused() { return focused },
    open,
    toggle,
    focus,
    close,
    blur,
    drop,
    reset,
    dispose: () => {
      if (conflictTimer !== undefined) {
        clearInterval(conflictTimer)
        conflictTimer = undefined
      }
      runtime?.session.dispose()
      runtime = undefined
      seat?.()
      seat = undefined
    },
    input: (data: string) => { runtime?.session.input(data) },
    ownsEscape: () => focused && runtime !== undefined && editorOwnsEscape(nvim.mode()),
    leave,
    get divider() { return divider.component },
    get railDivider() { return railDivider },
    setDividerHover,
    dragDividerTo,
    setComposer: (component: Component) => { composer = component },
  })
}

/** Cordis object-form plugin. */
export const panesPlugin = {
  name: 'hulala-panes',
  inject: ['hulalaTerminal', 'hulalaRender', 'hulalaLayout', 'hulalaOverlays', 'hulalaEditor', 'hulalaViewModel'],
  apply,
}
