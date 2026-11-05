/**
 * The sidebar: one child program in a pty, rendered as terminal cells.
 *
 * The column shows either the built-in terminal (`Ctrl-T`) or Hulala's Neovim
 * (`Ctrl-F`); at most one is painted at a time, but neither process is the
 * other's casualty. Switching columns, losing focus to the composer and hiding
 * the sidebar all keep the shell's jobs and Neovim's buffers alive. A process
 * ends when it exits on its own, when `Ctrl-F` asks Neovim to leave, when the
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
import { startNvimSession } from '../editor/nvimSession.js'
import { paneForSwitch, paneOwnsEscape, type PaneKind } from '../pane/focus.js'
import { startShellSession } from '../pane/shellSession.js'
import type { ScreenSession } from '../pane/screenSession.js'
import { faintCursorSgr } from '../view/theme.js'
import { columnRule, splitDivider } from '../view/splitDivider.js'
import { ScreenPane } from '../view/screenPane.js'
import { SPLIT_MIN_SIZE } from '../view/layout.js'
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
  readonly session: ScreenSession
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
   * `Ctrl-T` / `Ctrl-F`: open `kind` and focus it, or put the sidebar away when
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
  /** The one-column drag target the frame draws beside the sidebar. */
  readonly divider: Component
  /** The rule the rail layout draws between rail and conversation. */
  readonly railDivider: Component
  setDividerHover(hovered: boolean): void
  dragDividerTo(screenX: number): void
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
  const { terminal, screen, setPaging } = ctx.hulalaTerminal
  const render = ctx.hulalaRender
  const layout = ctx.hulalaLayout
  const overlays = ctx.hulalaOverlays
  const nvim = ctx.hulalaEditor
  const ime = ctx.hulalaIme
  const { reducer } = ctx.hulalaViewModel

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
  let composer: Component | undefined
  let conflictTimer: ReturnType<typeof setInterval> | undefined
  let dividerHovered = false
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

  const dragDividerTo = (screenX: number): void => {
    const kind = visibleKind
    if (kind === undefined) return
    const width = terminal.columns
    if (width <= 0) return
    // The pointer is on the divider column, so the column starts one cell after.
    ratios[kind] = Math.min(0.75, Math.max(0.25, (width - screenX - 1) / width))
    layout.resizePane(columns(kind))
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
    background: () => {
      const runtime = visibleKind === undefined ? undefined : runtimes.get(visibleKind)
      return runtime?.session.backgroundAnsi() ?? ''
    },
    onDrag: dragDividerTo,
    onHover: setDividerHover,
  })
  const railDivider = columnRule(rows, config.color)

  /** The visible column's runtime, if one is painted. */
  const visibleRuntime = (): PaneRuntime | undefined => visibleKind === undefined ? undefined : runtimes.get(visibleKind)

  const blur = (): void => {
    config.debug(`blurPane focused=${String(focused)} visible=${String(visibleKind)} overlays=${overlays.open}`)
    if (!focused) return
    focused = false
    setPaging(true)
    setDividerHover(false)
    // Leaving the column returns to the conversation, bringing it back if it was
    // put away with `Ctrl-D`: the composer has to be on screen to take the
    // keyboard. The sidebar itself stays open.
    if (!layout.conversationShown) layout.setConversationVisible(true)
    if (composer !== undefined) screen.setFocus(composer)
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
    if (hadFocus) screen.setFocus(composer!)
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
      onConversationPointer: () => divider.setHovered(false),
    }))
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
      if (conflictTimer !== undefined) {
        clearInterval(conflictTimer)
        conflictTimer = undefined
      }
      nvim.clearMarkers()
      // The process can exit while its dialog is still up (a slow quit beats the
      // grace period); settle it instead of leaving the keyboard disabled.
      overlays.cancelEditorModals()
    }
    if (visibleKind === kind) close()
    render.request()
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
      runtimes.get('editor')?.session.input(choice === 'keep' ? '\u001b:write!\r' : '\u001b:edit!\r')
    })
  }

  const mount = (kind: PaneKind, session: ScreenSession): PaneRuntime => {
    const view = new ScreenPane({
      screen: session,
      // Only a shell needs the column's own history; Neovim owns its scrolling.
      ...(kind === 'terminal' ? { scroll: session } : {}),
      rows,
      color: config.color,
      faintCursor: () => faintCursorSgr(config.color, nvim.theme.background, nvim.theme.foreground),
      onScroll: () => { if (visibleKind === kind) render.request() },
      onPointer: () => divider.setHovered(false),
    })
    const runtime: PaneRuntime = { kind, session, view }
    runtimes.set(kind, runtime)
    return runtime
  }

  /** Report why a column cannot start, naming the column the key chose. */
  const unavailable = (kind: PaneKind, reason: string): false => {
    const pane = t(kind === 'editor' ? 'pane.editor' : 'pane.terminal')
    reducer.addNotice(t('pane.unavailable', { pane, reason }))
    render.repaint()
    return false
  }

  const open = (kind: PaneKind, cwd: string): boolean => {
    config.debug(`openPane kind=${kind} cwd=${cwd} running=${String(runtimes.has(kind))}`)
    if (runtimes.has(kind)) return true
    const pty = ptyModule()
    if (pty === undefined) {
      // Only when this runtime has no pty at all (no Bun and no node-pty).
      return unavailable(kind, t('pane.noPty'))
    }
    if (!isLocalDirectory(cwd)) return unavailable(kind, t('pane.notDirectory', { path: cwd }))
    if (terminal.columns < MIN_SPLIT_COLUMNS) {
      return unavailable(kind, t('pane.tooNarrow', { columns: MIN_SPLIT_COLUMNS }))
    }
    if (kind === 'editor') {
      try {
        nvim.prepare()
      } catch (caught) {
        return unavailable(kind, caught instanceof Error ? caught.message : String(caught))
      }
      nvim.resetMode()
      const session = startNvimSession({
        pty,
        command: nvim.command,
        // Resolved after publishing, so the editor's `rg` is the copy in `<data>/bin`.
        env: nvim.environment(),
        cwd,
        cols: columns('editor'),
        rows: rows(),
        onScreen: () => { if (visibleKind === 'editor') render.request() },
        onExit: (exitCode) => {
          config.debug(`paneExit kind=editor code=${exitCode}`)
          drop('editor')
        },
      })
      if (conflictTimer === undefined) conflictTimer = setInterval(checkConflict, 1_000)
      mount('editor', session)
    } else {
      try {
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

  const focus = (kind: PaneKind, cwd: string): void => {
    config.debug(`focusPane kind=${kind} overlay=${overlays.open}`)
    if (!open(kind, cwd)) return
    const runtime = runtimes.get(kind)
    if (runtime === undefined) return
    visibleKind = kind
    lastKind = kind
    focused = true
    setPaging(false)
    // A column is a program reading raw keys, so it types in English: Neovim a
    // normal-mode command, the shell a command line. Nothing ever switches the
    // source back, so the composer keeps English until the user changes it.
    ime.ensure()
    // Register before showing so the pane seat already holds this column when
    // the frame is rebuilt; registering alone does not paint a hidden sidebar.
    registerSeat(kind, runtime)
    layout.setPane(SIDEBAR_ID)
    screen.setFocus(runtime.view)
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
      nvim.resetLeave()
      editor.session.input('\u001b:qa\r')
      // Neovim writes on quit (`QuitPre`), so a clean editor can take a second
      // to leave; only a refusal needs the dialog.
      if (await gone(failedSave ? 1500 : 1200)) return true
      const choice = await overlays.modal<ConfirmChoice>(
        done => new ConfirmOverlay({ color: config.color, failedSave, onChoose: done }),
        { anchor: 'center', width: 56 },
        { value: 'cancel' },
      )
      if (choice === 'cancel') return false
      const session = runtimes.get('editor')?.session
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
    for (const kind of [...runtimes.keys()]) drop(kind)
  }

  /** Stop every process without repainting: the window is going away. */
  const dispose = (): void => {
    if (conflictTimer !== undefined) {
      clearInterval(conflictTimer)
      conflictTimer = undefined
    }
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
        editorMode: runtime.kind === 'editor' ? nvim.mode() : undefined,
        alternateScreen: runtime.kind === 'terminal' && runtime.session.alternateScreen(),
      })
    },
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
  inject: ['hulalaTerminal', 'hulalaRender', 'hulalaLayout', 'hulalaOverlays', 'hulalaEditor', 'hulalaViewModel', 'hulalaIme'],
  apply,
}
