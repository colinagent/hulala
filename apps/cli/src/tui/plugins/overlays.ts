/**
 * Everything that takes the keyboard away from the composer.
 *
 * One counter decides whether the app's global keys are live: while any modal or
 * in-dock panel is up, `open > 0` and the input listener stops interpreting
 * chords, double-`Esc` and interrupts. That is why the counter has to have one
 * owner — the editor's own dialogs once leaked a count and the composer looked
 * dead, which is the failure this plugin exists to make impossible.
 *
 * Two kinds of surface share the count but not the mechanism:
 *
 * - `modal()` — a pi-tui overlay above the frame, used for approvals, questions
 *   and the Session pickers.
 * - `hold()` — a panel that occupies the composer's own slot (the model and
 *   provider selectors). It only reserves the count; drawing it is the
 *   composer plugin's business.
 *
 * @module hulala-cli/tui/plugins/overlays
 */
import type { Context } from '@deepseek-ai/cordis'
import { ApprovalOverlay } from '../view/overlays/approval.js'
import { ConflictOverlay, type ConflictChoice } from '../view/overlays/conflict.js'
import { QuestionOverlay, type QuestionAnswer } from '../view/overlays/question.js'
import type { TerminalApproval, TerminalApprovalOutcome, TerminalQuestion, TerminalQuestionAnswer } from '../data/remote.js'
import type { Component, OverlayHandle, OverlayOptions } from '@earendil-works/pi-tui'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Modal overlays, the composer-slot panels, and their keyboard hold. */
    hulalaOverlays: TuiOverlays
  }
}

/** What the rest of the client may do with overlays. */
export interface TuiOverlays {
  /** How many keyboard-owning surfaces are up. Non-zero silences global keys. */
  readonly open: number
  /**
   * Reserve the keyboard without drawing anything.
   * @returns idempotent release.
   */
  hold(): () => void
  /**
   * Show a component above the frame and resolve when it settles.
   * @param build - receives the resolver the component calls when it is done.
   * @param options - pi-tui overlay placement.
   * @param cancel - the value an editor-owned dialog resolves to when its
   *   column disappears; omitted for dialogs the client itself owns.
   */
  modal<T>(
    build: (done: (value: T) => void) => Component,
    options?: OverlayOptions,
    cancel?: { value: T },
  ): Promise<T>
  /** Settle every dialog an editor column owned (its process exited). */
  cancelEditorModals(): void
  showApproval(request: TerminalApproval): Promise<TerminalApprovalOutcome>
  showQuestion(question: TerminalQuestion, signal?: AbortSignal): Promise<QuestionAnswer | undefined>
  /** Ask every question in order; `undefined` when the user dismissed one. */
  handleQuestions(
    questions: readonly TerminalQuestion[],
    signal?: AbortSignal,
  ): Promise<{ answers: TerminalQuestionAnswer[] } | undefined>
  /** The conflict dialog autosave raises when a buffer and the disk diverged. */
  showConflict(path: string): Promise<ConflictChoice>
}

/** Colour flag plus the debug sink; both belong to the client, not the plugin. */
export interface OverlaysPluginConfig {
  readonly color: boolean
  readonly debug: (message: string) => void
}

/** Provide the overlay surface. */
export function apply(ctx: Context, config: OverlaysPluginConfig): void {
  const { screen, announce, refreshIme } = ctx.hulalaTerminal
  const render = ctx.hulalaRender
  let open = 0
  /** Dialogs the editor column owns; settled when that column disappears. */
  const editorModals = new Set<() => void>()

  const hold = (): (() => void) => {
    open += 1
    let released = false
    return () => {
      if (released) return
      released = true
      open -= 1
    }
  }

  const modal = <T>(
    build: (done: (value: T) => void) => Component,
    options: OverlayOptions = {},
    cancel?: { value: T },
  ): Promise<T> => {
    config.debug('modal open')
    return new Promise<T>(resolve => {
      let handle: OverlayHandle | undefined
      let settled = false
      const release = hold()
      const finish = (value: T): void => {
        if (settled) return
        settled = true
        release()
        editorModals.delete(cancelWith)
        handle?.hide()
        // The keyboard is back on whatever the overlay covered: say what that
        // surface reads, so a dialog over the composer gives English back.
        refreshIme()
        resolve(value)
      }
      const cancelWith = (): void => { if (cancel !== undefined) finish(cancel.value) }
      if (cancel !== undefined) editorModals.add(cancelWith)
      const overlay = build(finish)
      handle = screen.showOverlay(overlay, options)
      // An overlay is pushed onto the screen's stack rather than focused through
      // the terminal, so it reports itself here: a confirmation is a command
      // surface, a question with a free-text answer is not. A non-capturing
      // overlay never took the keyboard, so it has nothing to report.
      if (screen.getFocusedComponent() === overlay) announce(overlay)
    })
  }

  const showApproval = (request: TerminalApproval): Promise<TerminalApprovalOutcome> => {
    const signal = request.signal
    return modal<TerminalApprovalOutcome>(done => {
      if (signal !== undefined) signal.addEventListener('abort', () => done('cancelled'), { once: true })
      return new ApprovalOverlay({
        toolName: request.toolName,
        ...(request.reason === undefined ? {} : { reason: request.reason }),
        color: config.color,
        onDecide: done,
      })
    }, { anchor: 'bottom-center', width: 64 })
  }

  const showQuestion = (question: TerminalQuestion, signal?: AbortSignal): Promise<QuestionAnswer | undefined> => {
    return modal<QuestionAnswer | undefined>(done => {
      if (signal !== undefined) signal.addEventListener('abort', () => done(undefined), { once: true })
      return new QuestionOverlay({ question, color: config.color, onAnswer: done })
    }, { anchor: 'center', width: 72 })
  }

  ctx.effect(() => () => {
    for (const cancel of [...editorModals]) cancel()
    editorModals.clear()
    render.request(true)
  }, 'hulala: settle editor dialogs')

  ctx.provide('hulalaOverlays', {
    get open() { return open },
    hold,
    modal,
    cancelEditorModals: () => { for (const cancel of [...editorModals]) cancel() },
    showApproval,
    showQuestion,
    handleQuestions: async (questions, signal) => {
      const answers: TerminalQuestionAnswer[] = []
      for (const question of questions) {
        const answer = await showQuestion(question, signal)
        if (answer === undefined) return undefined
        answers.push({ id: question.id, ...answer })
      }
      return { answers }
    },
    showConflict: (path: string) => modal<ConflictChoice>(
      done => new ConflictOverlay({ color: config.color, path, onChoose: done }),
      { anchor: 'center', width: 64 },
      // The editor column can exit while this dialog is up; it is editor-owned,
      // so it settles to "leave the buffer dirty" instead of holding the
      // keyboard forever.
      { value: 'later' },
    ),
  })
}

/** Cordis object-form plugin. */
export const overlaysPlugin = { name: 'hulala-overlays', inject: ['hulalaTerminal', 'hulalaRender'], apply }
