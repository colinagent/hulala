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
import { ApprovalOverlay, type ApprovalDecision } from '../view/overlays/approval.js'
import { QuestionOverlay, type QuestionResult } from '../view/overlays/question.js'
import type { TerminalApproval, TerminalQuestion, TerminalQuestionAnswer } from '../data/remote.js'
import type { Component, OverlayHandle, OverlayOptions } from '@earendil-works/pi-tui'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Modal overlays, the composer-slot panels, and their keyboard hold. */
    hulalaOverlays: TuiOverlays
  }
}

/** How a stack of question cards ended. */
export type QuestionPresentation =
  /** Every question of the request was answered, in order. */
  | { kind: 'answered'; answers: TerminalQuestionAnswer[] }
  /** The user dismissed a blocking card, or the request aborted under it. */
  | { kind: 'cancelled' }
  /** A timed card's window closed; the Host keeps the call answerable. */
  | { kind: 'timed-out' }
  /** The user put a timed card away; it is still pending. */
  | { kind: 'parked' }
  /** The user handed the request to another answerer. */
  | { kind: 'delegate' }

/** What a question presentation knows about the request behind it. */
export interface QuestionPresentationOptions {
  /** Cancellation lifetime of the pending request. */
  readonly signal?: AbortSignal
  /** Wall-clock deadline of a timed call, when the Host gave one. */
  readonly deadline?: number
  /** `Esc` parks the card instead of cancelling it. */
  readonly parkable?: boolean
  /** The card reopens a call whose foreground window already closed. */
  readonly continued?: boolean
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
  showApproval(request: TerminalApproval): Promise<ApprovalDecision>
  /** One question card, for the caller that drives a request itself. */
  showQuestion(
    question: TerminalQuestion,
    options?: QuestionPresentationOptions,
  ): Promise<QuestionResult>
  /**
   * Ask every question in order.
   *
   * A dump of the first card ends the whole presentation: the caller has either
   * parked it, timed it out, or handed the request on, and asking the next
   * question of a request nobody is showing would be answering on their behalf.
   */
  handleQuestions(
    questions: readonly TerminalQuestion[],
    options?: QuestionPresentationOptions,
  ): Promise<QuestionPresentation>
  /** The conflict dialog autosave raises when a buffer and the disk diverged. */
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
        // Rows the dialog covered are painted again from the frame under it, not
        // from the dialog: the model held the composited screen, so every row it
        // touched is repainted rather than diffed against a layer that is gone.
        render.reconcile('overlay')
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

  const showApproval = (request: TerminalApproval): Promise<ApprovalDecision> => {
    const signal = request.signal
    return modal<ApprovalDecision>(done => {
      if (signal !== undefined) signal.addEventListener('abort', () => done('cancelled'), { once: true })
      return new ApprovalOverlay({
        toolName: request.toolName,
        ...(request.reason === undefined ? {} : { reason: request.reason }),
        color: config.color,
        onDecide: done,
      })
    }, { anchor: 'bottom-center', width: 72 })
  }

  const showQuestion = (
    question: TerminalQuestion,
    options: QuestionPresentationOptions = {},
  ): Promise<QuestionResult> => {
    const signal = options.signal
    return modal<QuestionResult>(done => {
      /** One settle path: every way out has to stop the timer and the clock. */
      let timer: ReturnType<typeof setTimeout> | undefined
      let ticker: ReturnType<typeof setInterval> | undefined
      const finish = (result: QuestionResult): void => {
        if (timer !== undefined) clearTimeout(timer)
        if (ticker !== undefined) clearInterval(ticker)
        timer = undefined
        ticker = undefined
        done(result)
      }
      if (signal !== undefined) signal.addEventListener('abort', () => finish({ kind: 'cancel' }), { once: true })
      if (options.deadline !== undefined) {
        // The time left is the Host's own reading, so the card closes when the
        // Host's deadline says it does — not a second after a local guess.
        const remaining = options.deadline - Date.now()
        if (remaining <= 0) queueMicrotask(() => finish({ kind: 'timeout' }))
        else timer = setTimeout(() => finish({ kind: 'timeout' }), remaining)
        ticker = setInterval(() => render.repaint(), 1_000)
        ticker.unref?.()
      }
      return new QuestionOverlay({
        question,
        color: config.color,
        ...(options.deadline === undefined ? {} : { deadline: options.deadline }),
        ...(options.parkable === undefined ? {} : { parkable: options.parkable }),
        ...(options.continued === undefined ? {} : { continued: options.continued }),
        onResult: finish,
      })
    }, { anchor: 'center', width: 72 })
  }

  ctx.effect(() => () => {
    for (const cancel of [...editorModals]) cancel()
    editorModals.clear()
    render.reconcile('overlay')
  }, 'hulala: settle editor dialogs')

  ctx.provide('hulalaOverlays', {
    get open() { return open },
    hold,
    modal,
    cancelEditorModals: () => { for (const cancel of [...editorModals]) cancel() },
    showApproval,
    showQuestion,
    handleQuestions: async (questions, options = {}) => {
      const answers: TerminalQuestionAnswer[] = []
      for (const question of questions) {
        const result = await showQuestion(question, options)
        if (result.kind === 'answer') {
          answers.push({ id: question.id, ...result.answer })
          continue
        }
        if (result.kind === 'cancel') return { kind: 'cancelled' }
        if (result.kind === 'timeout') return { kind: 'timed-out' }
        if (result.kind === 'park') return { kind: 'parked' }
        return { kind: 'delegate' }
      }
      return { kind: 'answered', answers }
    },
  })
}

/** Cordis object-form plugin. */
export const overlaysPlugin = { name: 'hulala-overlays', inject: ['hulalaTerminal', 'hulalaRender'], apply }
