/**
 * Pending interactions, owned by the Session that asked rather than the window.
 *
 * DSH dispatches both `approval/request` and `user-questions/request` as
 * Agent-scoped waterfalls: `request.agent` is the Session whose turn is
 * blocked, and an answerer either returns an outcome or calls `next()` to hand
 * the request down the chain. The Host's bot is on that chain too. Answering
 * every request as it arrives — including ones raised by Sessions this window
 * is not showing — interrupts the wrong conversation and takes requests away
 * from the channels mounted to them.
 *
 * So neither is a dialog. Both are *pending interaction state owned by a
 * Session*, the model DSH master builds with `SessionPendingInteractionBase`
 * and `uiSession.registerPendingInteraction`:
 *
 *   - identity is `key` + `kind` + `sessionId`;
 *   - precedence is a per-domain function, not a field: approval = 0,
 *     question = 1, plan-review = 2 (`ui-approval` / `ui-user-questions`);
 *   - one interaction per Session is *elected* by max precedence, and the
 *     registry's `>=` makes the later-published interaction win a tie;
 *   - the others stay pending and surface once the winner is removed.
 *
 * Only the Session the window is showing can present its elected interaction.
 * Background Sessions are parked and marked in the rail, footer and picker, so
 * a question from another thread never steals the keyboard from an approval.
 *
 * Ownership is the other half of the model. A Host can also mount a Session to
 * a bot channel, and that channel is an answerer on the same waterfall. This
 * window only claims Sessions it has actually opened; a request from a Session
 * it never showed is handed straight to the next answerer, so a Telegram/Lark
 * request is not parked in a terminal nobody is watching.
 *
 * ## Timed questions
 *
 * A timed `ask_user_question` is two things at once, and the client owes one
 * half of each:
 *
 *   - a **foreground wait**: `askTimed` attaches a claim keyed by the tool call
 *     and stops the Host's own timer while a client holds it, so the client
 *     must attach *before* it starts counting and must reject with
 *     `ASK_TIMED_OUT` when its deadline passes. Disposing the claim hands the
 *     wait back, which is what a window that can no longer show the card does;
 *   - a **durable question**: the `userQuestions` projection lists a timed call
 *     until an answer settles it, so a call whose window closed stays
 *     answerable — in this window, in the Desktop, or on a phone — through
 *     `userQuestions.answer`. Those cards are *parked* rather than offered: the
 *     window already showed the card once, and re-opening it the instant its
 *     own countdown ended would be an argument with the user's decision to let
 *     it wait.
 *
 * Parking is the general form of that. A card out of the seat is still pending;
 * the rail, the picker and the footer keep counting it, and `Alt-G`
 * (`app.interactions`) puts the elected one back. A *blocking* question cannot
 * be parked — nothing would ever settle it — so `Esc` there still cancels.
 *
 * A window that cannot answer (closing, or the user hands the request off)
 * delegates with `next()` rather than DSH's fail-closed outcomes. A visible
 * hand-off also leaves a notice in the owning Session's transcript, because a
 * silent hand-off is exactly the failure this state machine exists to remove.
 *
 * @module hulala-cli/tui/plugins/interactions
 */
import type { Context } from '@deepseek-ai/cordis'
import { actionHint } from '../../keymap.js'
import { t } from '../i18n/index.js'
import type {
  QuestionWaitClaim,
  TerminalApproval,
  TerminalApprovalDecision,
  TerminalApprovalOutcome,
  TerminalBackend,
  TerminalPendingQuestion,
  TerminalQuestion,
  TerminalQuestionAnswer,
  TerminalQuestionDecision,
  TerminalQuestionRequest,
} from '../data/remote.js'
import type { QuestionPresentation } from './overlays.js'
import { FULL_ACCESS_PRESET, permissionLabel } from '../view/permission.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Pending approvals and questions, keyed by the Session that raised them. */
    hulalaInteractions: TuiInteractions
  }
  interface Events {
    /**
     * One of the two projections a continued question reconciles against changed.
     * DSH's Web client subscribes to `userQuestions` and `inbox` together and
     * recomputes on either; a queued `user-question-reply` hides a `continued`
     * row even while the row is still listed.
     * @param sessionId - the Session the projections belong to.
     * @param pending - timed calls the `userQuestions` projection still lists.
     * @param replies - call ids with a `user-question-reply` queued in `inbox`.
     */
    'hulala/questions'(
      sessionId: string,
      pending: readonly TerminalPendingQuestion[],
      replies: readonly string[],
    ): void
  }
}

/** What the views and the composition root may read or do with the queue. */
export interface TuiInteractions {
  /** Sessions with at least one request this window has not answered yet. */
  readonly pendingSessions: ReadonlySet<string>
  /** Requests waiting in Sessions the window is not currently showing. */
  readonly waiting: number
  /** Requests of the open Session that the user put away. */
  readonly parked: number
  /**
   * Put the card on screen away, or bring back what this Session is waiting on.
   *
   * One action with two directions: a card in the seat is parked, and with
   * nothing in the seat the elected parked card takes it back. Returns whether
   * anything changed, so a key handler can decide to consume the chord.
   */
  toggle(): boolean
  /** Let the frame present cards; called once the terminal is painting. */
  arm(): void
}

/** The one dependency this plugin does not read from the Context. */
export interface InteractionsPluginConfig {
  readonly backend: TerminalBackend
}

/** Domain-owned discriminator, mirroring DSH's `PendingApproval`/`PendingQuestion`. */
type InteractionKind = 'approval' | 'question' | 'plan-review' | 'continued'

/** Mirrors `SessionPendingInteractionBase` plus the carrier's settle hook. */
interface PendingBase {
  /** Session queue this request is parked under; `''` when unowned. */
  readonly owner: string
  /** Opaque request identity; unique within this window (DSH's `key`). */
  readonly id: string
  readonly sessionId: string | undefined
  readonly signal?: AbortSignal
  /** Domain precedence, evaluated at publish time. */
  readonly precedence: number
  /** An aborted or delegated request must not be answered twice. */
  settled: boolean
  /** Parked by the user: still pending, out of the seat. */
  hidden: boolean
}

interface PendingApproval extends PendingBase {
  readonly kind: 'approval'
  readonly request: TerminalApproval
  readonly resolve: (decision: TerminalApprovalDecision) => void
}

interface PendingQuestion extends PendingBase {
  readonly kind: 'question' | 'plan-review'
  readonly request: TerminalQuestionRequest
  readonly resolve: (decision: TerminalQuestionDecision) => void
  /** Closes the card without answering it (abort, timeout, teardown). */
  readonly closer: AbortController
  /** The Host's claim on the foreground wait, while this card holds one. */
  claim?: QuestionWaitClaim | undefined
  /** Wall-clock deadline the Host computed for a timed call. */
  deadline?: number
  /** The deadline passed: this card's exit is a timeout, not a cancel. */
  expired?: boolean
  timer?: ReturnType<typeof setTimeout> | undefined
}

/**
 * One timed call the projection still lists, with no waterfall behind it.
 *
 * Answering it is a Remote call (`userQuestions.answer`), not a resolve: the
 * turn has already moved on, and the reply is steered into the agent as a new
 * user message.
 */
interface PendingContinued extends PendingBase {
  readonly kind: 'continued'
  readonly callId: string
  readonly questions: readonly TerminalQuestion[]
  /**
   * Closes a continued card that is on screen when the projection withdraws it.
   * The overlay's `signal` is this controller's signal, so aborting it is how
   * `reconcile()` implements DSH Web's `card.remove()` for a card another
   * client just answered (or whose reply is already queued).
   */
  readonly closer: AbortController
}

type Pending = PendingApproval | PendingQuestion | PendingContinued

/**
 * Requests that arrive without a Session identity.
 *
 * A Gateway replay or an older Host can omit `agentId`. There is no owner to
 * park them under, so they belong to whichever Session the window is showing
 * when it answers — the behaviour the client had before approvals were scoped.
 */
const UNOWNED = ''

/**
 * DSH master's domain precedence, verbatim:
 * `ui-approval` registers `() => 0`; `ui-user-questions` registers
 * `pending => pending.kind === 'plan-review' ? 2 : 1`. Larger wins.
 */
const precedenceOf = (kind: InteractionKind): number =>
  kind === 'plan-review' ? 2 : kind === 'question' || kind === 'continued' ? 1 : 0

/** An `intent.kind === 'plan-review'` question outranks a plain question. */
const questionKind = (questions: readonly TerminalQuestion[]): 'question' | 'plan-review' =>
  questions.some(question => question.intent?.kind === 'plan-review') ? 'plan-review' : 'question'

/** Short, stable label for a Session named in a notice. */
function shortId(id: string | undefined): string {
  if (id === undefined || id === '') return t('notice.approvalThisSession')
  return id.length <= 12 ? id : `${id.slice(0, 8)}…${id.slice(-4)}`
}

/** Provide the per-Session pending-interaction state machine. */
export function apply(ctx: Context, config: InteractionsPluginConfig): void {
  const backend = config.backend
  const overlays = ctx.hulalaOverlays
  const render = ctx.hulalaRender
  const reducer = ctx.hulalaViewModel.reducer
  const session = ctx.hulalaSession

  /** Requests waiting per Session, in publish order. */
  const queues = new Map<string, Pending[]>()
  /**
   * Last `userQuestions`/`inbox` reconcile inputs per Session. A `continued`
   * frame can arrive while the timed waterfall card is still live; when that
   * card settles, the same snapshot has to be replayed to materialize the
   * durable card (DSH Web keeps one card and flips its state instead).
   */
  const projections = new Map<string, {
    pending: readonly TerminalPendingQuestion[]
    replies: readonly string[]
  }>()
  /** Notices to replay into a Session's transcript when it is opened again. */
  const notices = new Map<string, string[]>()
  /** Sessions this window has opened, and therefore owns the answer for. */
  const claimed = new Set<string>()
  let currentId: string | undefined = session.id
  /** False until the first Session opened; a replay can arrive before it. */
  let booted = false
  let armed = false
  let presenting = false
  /** The card currently occupying the seat, if any. */
  let onScreen: Pending | undefined
  let sequence = 0

  const closing = (): boolean => ctx.get('hulalaLifecycle')?.closing === true

  const queueFor = (owner: string): Pending[] => {
    let queue = queues.get(owner)
    if (queue === undefined) {
      queue = []
      queues.set(owner, queue)
    }
    return queue
  }

  const pendingSessions = (): ReadonlySet<string> => {
    const ids = new Set<string>()
    for (const [owner, queue] of queues) {
      if (queue.length > 0 && owner !== UNOWNED) ids.add(owner)
    }
    return ids
  }

  const waiting = (): number => {
    let count = 0
    for (const [owner, queue] of queues) {
      for (const pending of queue) {
        // A parked card of the open Session is waiting too: it is out of the
        // seat, which is exactly what the footer's count is about.
        if (owner !== currentId || pending.hidden) count += 1
      }
    }
    return count
  }

  const parked = (): number =>
    (queues.get(currentId ?? UNOWNED) ?? []).filter(pending => pending.hidden).length

  /** Leave a visible trail in the owning Session, including after a switch. */
  const record = (owner: string, text: string): void => {
    // Nothing can read a notice from a window that is already closing; the
    // delegation itself still reaches the next answerer either way.
    if (closing()) return
    // An unowned request is shown on the open Session, so its notice belongs
    // there too — otherwise switching away and back would lose the trail.
    const key = owner === UNOWNED ? (currentId ?? UNOWNED) : owner
    const list = notices.get(key) ?? []
    list.push(text)
    notices.set(key, list)
    reducer.addNotice(text, 'warn')
    render.repaint()
  }

  /** Re-attach notices after `open()` reset the transcript. */
  const replay = (id: string): void => {
    const list = notices.get(id)
    if (list === undefined || closing()) return
    for (const text of list) reducer.addNotice(text, 'warn')
  }

  /**
   * Release everything one card holds: the Host's claim first, then its timer.
   *
   * The claim goes back before the answer is delivered on purpose. The Host
   * keeps the wait claimed until this stream closes, and its own timer only
   * restarts once every client let go — so disposing after resolving would let
   * a timeout race an answer that already arrived.
   */
  const release = (pending: Pending): void => {
    if (pending.kind !== 'question' && pending.kind !== 'plan-review') return
    if (pending.timer !== undefined) clearTimeout(pending.timer)
    pending.timer = undefined
    pending.claim?.dispose()
    pending.claim = undefined
  }

  const drop = (pending: Pending): void => {
    const queue = queues.get(pending.owner)
    if (queue === undefined) return
    const index = queue.indexOf(pending)
    if (index !== -1) queue.splice(index, 1)
    if (queue.length === 0) queues.delete(pending.owner)
  }

  const settle = (pending: Pending, decision: TerminalApprovalDecision | TerminalQuestionDecision): void => {
    if (pending.settled) return
    pending.settled = true
    release(pending)
    if (pending.kind === 'approval') pending.resolve(decision as TerminalApprovalDecision)
    // Both question kinds answer the same waterfall: `plan-review` is a tag on a
    // question, not a separate carrier, and treating it as one left the card
    // painted while its request waited forever.
    else if (pending.kind === 'question' || pending.kind === 'plan-review') {
      pending.resolve(decision as TerminalQuestionDecision)
    }
    // A continued card has no waterfall to answer: dropping it is settling it.
  }

  /**
   * DSH's card identity: one card per (Session, tool call), shared by the
   * foreground waterfall and the durable projection. The Web client builds it
   * with `PendingQuestion.keyOf`; the bot uses the same string for `#cardByCall`.
   */
  const questionKey = (sessionId: string, callId: string): string => `question:${sessionId}:${callId}`

  /** One live card by its DSH key, across every Session queue. */
  const byKey = (key: string): Pending | undefined => {
    for (const queue of queues.values()) {
      const found = queue.find(pending => !pending.settled && pending.id === key)
      if (found !== undefined) return found
    }
    return undefined
  }

  /**
   * DSH Web's `card.remove()` for a projected card. Aborting the closer makes
   * the overlay resolve as a cancel, so `pump()` clears `presenting` and the
   * next interaction can take the seat; dropping alone left the card painted
   * and the seat held forever.
   */
  const withdrawContinued = (pending: PendingContinued): void => {
    if (pending.settled) return
    pending.hidden = true
    pending.closer.abort()
    drop(pending)
    settle(pending, 'delegate')
  }

  /** The text a hand-off leaves behind, named after the kind that was lost. */
  const delegatedText = (pending: Pending): string => pending.kind === 'approval'
    ? t('notice.approvalDelegated', {
      tool: pending.request.toolName,
      session: shortId(pending.sessionId),
    })
    : t('notice.questionDelegated', { session: shortId(pending.sessionId) })

  /**
   * Answer one request once and widen its Session to Full access.
   *
   * The preset is the Host's own write path, so the switch is durable Session
   * state. A failed switch still allows the call once: the user asked for the
   * operation, and the notice says the Session did not change.
   */
  const grantFullAccess = async (id: string | undefined): Promise<TerminalApprovalOutcome> => {
    if (id === undefined) {
      if (!closing()) reducer.addNotice(t('notice.approvalFullAccessUnavailable'))
      return 'allowed-once'
    }
    try {
      await backend.setPermission(id, FULL_ACCESS_PRESET)
      if (!closing()) reducer.addNotice(t('notice.approvalFullAccess', { preset: permissionLabel(FULL_ACCESS_PRESET) }))
    } catch (caught) {
      if (!closing()) reducer.addNotice(t('notice.approvalFullAccessFailed', {
        reason: caught instanceof Error ? caught.message : String(caught),
      }))
    }
    return 'allowed-once'
  }

  /** Finish one presented request and let the next elected one take the seat. */
  const finish = (pending: Pending, decision: TerminalApprovalDecision | TerminalQuestionDecision): void => {
    // The timeout path can settle a card the modal is still closing; the second
    // arrival must not rewrite the transcript a second time.
    if (pending.settled) return
    drop(pending)
    if (decision === 'delegate') {
      record(pending.owner, delegatedText(pending))
    } else if (pending.kind === 'approval' && !closing()) {
      reducer.addNotice(t('notice.approval', { outcome: decision as string }))
      render.repaint()
    } else if (pending.kind === 'question' && pending.expired === true && !closing()) {
      record(pending.owner, t('question.expired'))
    }
    settle(pending, decision)
    // A timed waterfall just left its seat. If the projection already announced
    // the `continued` row, the durable card was deliberately not stacked on top
    // of it; replay the snapshot now that its key is free.
    if (pending.kind === 'question' || pending.kind === 'plan-review') {
      const snapshot = projections.get(pending.owner)
      if (snapshot !== undefined) reconcile(pending.owner, snapshot.pending, snapshot.replies)
    }
  }

  const presentApproval = async (pending: PendingApproval): Promise<void> => {
    const request = pending.request
    let decision: TerminalApprovalDecision
    try {
      const chosen = await overlays.showApproval(request)
      decision = chosen === 'full-access'
        ? await grantFullAccess(request.sessionId ?? currentId)
        : chosen
    } catch {
      // A dialog that cannot be built (the frame is going away) must not leave
      // the Host's waterfall hanging.
      decision = 'delegate'
    }
    finish(pending, decision)
  }

  /**
   * Attach the Host's foreground wait, if this request has one.
   *
   * The first frame is the Host-computed remaining duration and is the only
   * deadline this card will ever have; a stream that is already done means the
   * wait ended before we claimed it, and the request belongs to the next
   * answerer rather than to a card nobody can settle.
   * @returns whether the card may be shown.
   */
  const attachWait = async (pending: PendingQuestion): Promise<boolean> => {
    const wait = pending.request.wait
    if (wait?.timed !== true || pending.request.sessionId === undefined) return true
    // A card that comes back from the park keeps its claim and its deadline.
    // Re-attaching would take a second claim the Host counts as a second client
    // holding the clock, and the one it replaced would never be released.
    if (pending.claim !== undefined) return true
    const attach = backend.attachQuestionWait
    // A backend with no `userQuestions` Remote (the fake Host in a test) has no
    // claim to hold: the card is shown without a countdown and the Host times
    // the wait out itself.
    if (attach === undefined) return true
    const claim = attach(pending.request.sessionId, wait.callId, pending.closer.signal)
    pending.claim = claim
    try {
      const iterator = claim.frames[Symbol.asyncIterator]()
      const opening = await iterator.next()
      if (opening.done === true) return false
      pending.deadline = Date.now() + opening.value.remainingMs
      return true
    } catch {
      return false
    }
  }

  /**
   * Arm the card's own deadline.
   *
   * The Host stopped its timer for this wait, so nobody else will end it: if
   * this timer never fires, a parked card waits forever. It therefore belongs
   * to the pending, not to the modal, and survives the card leaving the screen.
   */
  const armDeadline = (pending: PendingQuestion): void => {
    if (pending.deadline === undefined || pending.timer !== undefined) return
    const remaining = pending.deadline - Date.now()
    const expire = (): void => {
      if (pending.settled) return
      pending.expired = true
      // Closing the card is what makes the timeout visible; the decision is
      // read from `expired`, so the same path serves a parked card.
      pending.closer.abort()
      finish(pending, { rejected: 'ASK_TIMED_OUT' })
      render.repaint()
      pump()
    }
    pending.timer = setTimeout(expire, Math.max(0, remaining))
    pending.timer.unref?.()
  }

  const presentQuestion = async (pending: PendingQuestion): Promise<void> => {
    const request = pending.request
    let outcome: QuestionPresentation
    try {
      if (!(await attachWait(pending))) {
        finish(pending, 'delegate')
        return
      }
      armDeadline(pending)
      outcome = await overlays.handleQuestions(request.questions, {
        signal: AbortSignal.any([
          pending.closer.signal,
          ...(request.signal === undefined ? [] : [request.signal]),
        ]),
        ...(pending.deadline === undefined ? {} : { deadline: pending.deadline }),
        // Only a timed card may be parked: a blocking question has no deadline
        // and nothing would ever put it back on screen.
        parkable: pending.deadline !== undefined,
      })
    } catch {
      finish(pending, 'delegate')
      return
    }
    // A timeout closes the card as an abort, so the flag decides what it meant.
    if (pending.expired === true || outcome.kind === 'timed-out') {
      pending.expired = true
      finish(pending, { rejected: 'ASK_TIMED_OUT' })
      return
    }
    if (outcome.kind === 'answered') {
      finish(pending, { answers: outcome.answers })
      return
    }
    if (outcome.kind === 'parked') {
      park(pending)
      return
    }
    if (outcome.kind === 'delegate') {
      finish(pending, 'delegate')
      return
    }
    // Questions have no `unavailable` outcome. A dismissal is a coded
    // rejection rebuilt by the Host as a `UserQuestionError`; delegating it
    // would hand a dead request to another answerer instead of ending the turn.
    finish(pending, {
      rejected: request.signal?.aborted === true ? 'ASK_ABORTED' : 'ASK_CANCELLED',
    })
  }

  /** Ask one projected (continued) question and deliver its late answer. */
  const presentContinued = async (pending: PendingContinued): Promise<void> => {
    const sessionId = pending.sessionId
    const answer = backend.answerQuestion
    if (sessionId === undefined || answer === undefined) {
      pending.hidden = true
      return
    }
    let outcome: QuestionPresentation
    try {
      // The projection owns this card's lifetime: when it withdraws the row the
      // overlay must resolve, or `presenting` would hold the seat forever.
      outcome = await overlays.handleQuestions(pending.questions, {
        continued: true,
        parkable: true,
        signal: pending.closer.signal,
      })
    } catch {
      pending.hidden = true
      return
    }
    // Another client answered, or a reply of ours is queued: `reconcile()`
    // withdrew the card while its overlay was open. Its cancel is not a
    // dismissal, and there is nothing left to answer.
    if (pending.settled || pending.hidden) {
      render.repaint()
      return
    }
    if (outcome.kind !== 'answered') {
      // Dismissing a continued card, or handing it on, only puts it away: the
      // projection still lists the call, and every other client can answer it.
      pending.hidden = true
      render.repaint()
      return
    }
    try {
      const accepted = await answer(sessionId, pending.callId, outcome.answers)
      if (pending.settled) return
      // The projection is the authority on whether the call survived, so a card
      // that failed to send stays parked until the next projection event ends it.
      if (accepted) {
        drop(pending)
        settle(pending, 'delegate')
      } else pending.hidden = true
      if (!closing()) reducer.addNotice(t(accepted ? 'question.answerQueued' : 'question.gone'))
    } catch (caught) {
      if (pending.settled) return
      pending.hidden = true
      if (!closing()) {
        reducer.addNotice(t('notice.questionAnswerFailed', {
          reason: caught instanceof Error ? caught.message : String(caught),
        }))
      }
    }
    render.repaint()
  }

  const present = async (pending: Pending): Promise<void> => {
    if (pending.kind === 'approval') await presentApproval(pending)
    else if (pending.kind === 'continued') await presentContinued(pending)
    else await presentQuestion(pending)
  }

  /**
   * Elect the one interaction this frame may show.
   *
   * DSH's `publishPendingInteractions` keeps the max precedence per Session and
   * uses `>=`, so a later-published interaction of equal precedence wins. The
   * queue is in publish order, hence a simple forward scan. Only the open
   * Session's projection is presentable in a terminal with one visible thread.
   */
  const elected = (): Pending | undefined => {
    if (currentId === undefined) return undefined
    let winner: Pending | undefined
    for (const pending of [...(queues.get(currentId) ?? []), ...(queues.get(UNOWNED) ?? [])]) {
      if (pending.hidden || pending.settled) continue
      if (winner === undefined || pending.precedence >= winner.precedence) winner = pending
    }
    return winner
  }

  const pump = (): void => {
    if (!armed || presenting || closing()) return
    const pending = elected()
    if (pending === undefined) return
    presenting = true
    onScreen = pending
    void present(pending).finally(() => {
      presenting = false
      onScreen = undefined
      pump()
    })
  }

  /** Put one card away without answering it. Only a timed card can be parked. */
  const park = (pending: Pending): void => {
    // Parking twice must not repaint twice: the second call would record a
    // second notice for one decision, and `toggle` can race the card's own
    // teardown by one frame.
    if (pending.hidden) return
    if (pending.kind !== 'question') {
      pending.hidden = true
      render.repaint()
      return
    }
    pending.hidden = true
    record(pending.owner, t('question.parked', { key: actionHint('app.interactions') }))
    render.repaint()
    pump()
  }

  /** How an unanswered request of this kind is settled on the way out. */
  const cancelled = (pending: Pending): TerminalApprovalDecision | TerminalQuestionDecision =>
    pending.kind === 'approval' ? 'cancelled' : { rejected: 'ASK_ABORTED' }

  /** Hand a request from a Session this window never opened to the next answerer. */
  const handOff = (pending: Pending): void => {
    drop(pending)
    settle(pending, 'delegate')
  }

  /** Replays can arrive before the first Session opens; route them once it has. */
  const sweepUnclaimed = (): void => {
    for (const [owner, queue] of [...queues]) {
      if (owner === UNOWNED || claimed.has(owner)) continue
      for (const pending of [...queue]) handOff(pending)
    }
  }

  /** Settle one queue on teardown, leaving a visible trail while painting. */
  const delegateQueue = (owner: string): void => {
    for (const pending of [...(queues.get(owner) ?? [])]) {
      drop(pending)
      // A continued card has no waterfall to hand on; the projection already
      // offers it to every other client. Abort its closer so an open overlay
      // resolves instead of outliving the window that owned it.
      if (pending.kind === 'continued') {
        pending.closer.abort()
        settle(pending, 'delegate')
      } else {
        record(owner, delegatedText(pending))
        settle(pending, 'delegate')
      }
    }
  }

  /** Park one request under its owning Session and let `pump()` elect it. */
  const enqueue = (owner: string, pending: Pending): void => {
    if (booted && owner !== UNOWNED && !claimed.has(owner)) {
      handOff(pending)
      return
    }
    queueFor(owner).push(pending)
    pending.signal?.addEventListener('abort', () => {
      if (pending.settled) return
      drop(pending)
      settle(pending, cancelled(pending))
      pump()
    }, { once: true })
    render.repaint()
    pump()
  }

  const nextId = (): string => {
    sequence += 1
    return `i${String(sequence)}`
  }

  // Both subscriptions for the whole window, installed with the plugins rather
  // than after the first frame. A request that arrives while the UI is still
  // booting is parked, never answered `next()` by the Gateway by accident.
  const unsubscribe = [
    backend.onApproval(request => new Promise<TerminalApprovalDecision>(resolve => {
      const owner = request.sessionId ?? currentId ?? UNOWNED
      enqueue(owner, {
        owner,
        id: nextId(),
        kind: 'approval',
        sessionId: request.sessionId,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        precedence: precedenceOf('approval'),
        request,
        resolve,
        settled: false,
        hidden: false,
      })
    })),
    backend.onQuestion(request => new Promise<TerminalQuestionDecision>(resolve => {
      const owner = request.sessionId ?? currentId ?? UNOWNED
      const kind = questionKind(request.questions)
      const callId = request.wait?.callId
      // A timed call is one card in DSH, shared by this waterfall and the
      // projection: use its key so a `continued` frame cannot stack a second
      // card (or withdraw the live one) after the wait ends.
      const id = callId !== undefined && request.sessionId !== undefined
        ? questionKey(request.sessionId, callId)
        : nextId()
      enqueue(owner, {
        owner,
        id,
        kind,
        sessionId: request.sessionId,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        precedence: precedenceOf(kind),
        request,
        resolve,
        closer: new AbortController(),
        settled: false,
        hidden: false,
      })
    })),
  ]

  /**
   * Mirror the projection's answerable timed calls onto parked cards.
   *
   * DSH Web's `publishContinuedQuestions()` reconciles two projections at once:
   * a `continued` row whose call id already has a `user-question-reply` queued
   * in the inbox is skipped, and a card whose row is gone is removed. Doing only
   * the former leaves a card that can be submitted twice; doing only the latter
   * leaves an overlay that never closes.
   *
   * A card with a live waterfall is never withdrawn by a projection frame: the
   * foreground request is the authority until it settles (Web's
   * `card.pending.hasWaterfall()` guard).
   */
  const reconcile = (
    sessionId: string,
    projected: readonly TerminalPendingQuestion[],
    replies: readonly string[],
  ): void => {
    projections.set(sessionId, { pending: projected, replies })
    const queued = new Set(replies)
    const wanted = new Map(projected
      .filter(row => row.state === 'continued' && !queued.has(row.callId))
      .map(row => [row.callId, row]))
    for (const pending of [...(queues.get(sessionId) ?? [])]) {
      if (pending.kind !== 'continued') continue
      if (!wanted.has(pending.callId)) withdrawContinued(pending)
    }
    for (const [callId, row] of wanted) {
      const key = questionKey(sessionId, callId)
      // The waterfall card for this very call is the same card in DSH. A
      // projection frame must not stack a second one on top of it, and must
      // not hide a continued card the user has already put back in the seat.
      if (byKey(key) !== undefined) continue
      const owner = sessionId
      queueFor(owner).push({
        owner,
        id: key,
        kind: 'continued',
        sessionId,
        precedence: precedenceOf('continued'),
        callId,
        questions: row.questions,
        closer: new AbortController(),
        settled: false,
        // Parked on arrival: this window either already showed the card (and the
        // user let it wait) or never saw it at all. Both are reasons to mark it,
        // not to take the keyboard.
        hidden: true,
      })
    }
    render.repaint()
    pump()
  }

  ctx.on('hulala/questions', reconcile)

  ctx.on('hulala/session-opened', id => {
    currentId = id
    claimed.add(id)
    booted = true
    sweepUnclaimed()
    replay(id)
    pump()
  })

  ctx.effect(() => () => {
    for (const stop of unsubscribe) stop()
    // The window is going away: hand every unanswered request down the
    // waterfall instead of letting the Host's tool call hang forever.
    for (const owner of [...queues.keys()]) delegateQueue(owner)
    notices.clear()
  }, 'hulala: settle pending interactions')

  const toggle = (): boolean => {
    // A card already put away is not in the seat: the chord's other direction
    // applies. This is a real race, not a hypothetical — a park repaints before
    // its presentation finishes unwinding, so the next press can arrive while
    // the card is still `onScreen`.
    if (presenting && onScreen !== undefined && !onScreen.hidden) {
      // A blocking question cannot be parked: it has no deadline, so nothing
      // would ever bring it back. Say so by leaving the chord unhandled.
      if (onScreen.kind !== 'question' || onScreen.deadline === undefined) return false
      park(onScreen)
      return true
    }
    const queue = [...(queues.get(currentId ?? UNOWNED) ?? [])]
    // The last one published wins, the same tie-break the election uses.
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      const pending = queue[index]
      if (pending === undefined || !pending.hidden || pending.settled) continue
      pending.hidden = false
      render.repaint()
      pump()
      return true
    }
    return false
  }

  ctx.provide('hulalaInteractions', {
    get pendingSessions() { return pendingSessions() },
    get waiting() { return waiting() },
    get parked() { return parked() },
    toggle,
    arm: () => { armed = true; pump() },
  })
}

/** Cordis object-form plugin. */
export const interactionsPlugin = {
  name: 'hulala-interactions',
  inject: ['hulalaOverlays', 'hulalaRender', 'hulalaViewModel', 'hulalaSession'],
  apply,
}
