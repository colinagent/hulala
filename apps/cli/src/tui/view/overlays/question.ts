/**
 * User-question modal: single select, multi select, free text, and the typed
 * "other" row that keeps an option list from being a closed menu.
 *
 * The Harness answer is `{ selected, custom? }`, so a listed question can still
 * take a sentence the caller did not offer: every list ends with an "other"
 * row, `Enter` there opens the same field an optionless question shows, and
 * printable keys typed on that row open it too. A single-select typed answer
 * replaces the highlighted option; a multi-select one rides along with every
 * checked label, which is what the Harness web composer submits as well.
 *
 * `Esc` while typing goes back to the list instead of dropping the card, so the
 * draft survives a second look at the choices. What a second `Esc` means
 * depends on the request: a *timed* call is parked (the Host keeps the question
 * answerable and its countdown keeps running), while a blocking one is
 * cancelled, because nothing would ever bring a parked blocking question back.
 * Nothing typed is ever submitted empty, so a stray `Enter` cannot answer for
 * the user.
 *
 * Two caller-declared intents change presentation only. `approval` — a
 * Computer-Use agent asking through `user-questions/request` — is drawn as a
 * permission card: the subject on its own line, the caller's localized question
 * as the heading, and the action labels the caller named. `plan-review` keeps
 * the generic list. The answer encoding is identical either way.
 *
 * `Alt-D` hands the request to the next answerer on DSH's waterfall (another
 * client, or the bot channel mounted to this Session). A plain `d` cannot carry
 * that meaning: every printable key on this card belongs to the user's answer.
 *
 * @module hulala-cli/tui/view/overlays/question
 */
import type { Component } from '@earendil-works/pi-tui'
import { matchesKey, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import type { TerminalDisplayText, TerminalQuestion, TerminalQuestionOption } from '../../data/remote.js'
import { activeLanguage, t } from '../../i18n/index.js'
import { listMove } from '../../keys.js'
import { buildStyles } from '../theme.js'
import { panel } from './panel.js'
import type { ImePolicy } from '../../pane/focus.js'

export interface QuestionAnswer {
  selected: string[]
  custom?: string
}

/** How one question card ended. */
export type QuestionResult =
  /** The user answered; `answer` is the Harness's structured shape. */
  | { kind: 'answer'; answer: QuestionAnswer }
  /** The user dismissed a blocking card, or the request aborted under it. */
  | { kind: 'cancel' }
  /** The timed window closed: the Host keeps the call answerable. */
  | { kind: 'timeout' }
  /** The user put the card away; it is still pending and can be reopened. */
  | { kind: 'park' }
  /** The user handed the request to the next answerer on the waterfall. */
  | { kind: 'delegate' }

export interface QuestionOverlayOptions {
  question: TerminalQuestion
  color: boolean
  /** Wall-clock deadline of a timed call; the card shows what is left of it. */
  deadline?: number
  /** Whether `Esc` may park this card instead of cancelling it. */
  parkable?: boolean
  /** A card reopened after its foreground window closed (`continued`). */
  continued?: boolean
  onResult(result: QuestionResult): void
}

/**
 * Text carried by one input event, or `''` when the event is a key.
 *
 * Mouse reports, arrows and other keys arrive as escape sequences, and a
 * bracketed paste arrives wrapped; only the paste's body is text. An empty
 * result leaves the draft untouched so a key gesture never types itself.
 * @param data - one raw input event.
 * @returns the event's text, or `''` when it carries none.
 */
function printable(data: string): string {
  const pasted = /^\u001b\[200~([\s\S]*)\u001b\[201~$/u.exec(data)
  if (pasted !== null) return (pasted[1] ?? '').replace(/[\r\n\t]/gu, '')
  if (data.startsWith('\u001b')) return ''
  return data.replace(/[\u0000-\u001f\u007f]/gu, '')
}

/**
 * Clip to `width` from the left.
 *
 * The typed answer and every list row share one line, and the caret sits at the
 * end of that line: when the draft outgrows the panel, trimming its head keeps
 * both the cursor and the words just typed on screen.
 * @param text - one rendered line.
 * @param width - cells available.
 * @returns the tail of the line, prefixed with `…` when anything was dropped.
 */
function tailToWidth(text: string, width: number): string {
  if (visibleWidth(text) <= width) return text
  let tail = ''
  for (const character of [...text].reverse()) {
    if (visibleWidth(`${character}${tail}`) > width - 1) break
    tail = `${character}${tail}`
  }
  return `…${tail}`
}

/**
 * One caller-authored sentence in the terminal's language.
 *
 * A caller supplies `en` plus whatever locales it knows; the terminal picks its
 * own and falls back to English rather than showing a locale key.
 * @param text - the caller's localized text, if it wrote one.
 * @returns the sentence to render, or `undefined` when there is none.
 */
function displayText(text: TerminalDisplayText | undefined): string | undefined {
  if (text === undefined) return undefined
  const preferred = activeLanguage() === 'zh-CN' ? text.zh : text.en
  return preferred ?? text.en
}

export class QuestionOverlay implements Component {
  /** Keys here are the user's own writing, answers included: their source stays. */
  imePolicy: ImePolicy = 'text'
  private readonly options: QuestionOverlayOptions
  private cursor = 0
  private readonly toggled = new Set<number>()
  private text = ''
  private editing = false

  constructor(options: QuestionOverlayOptions) {
    this.options = options
  }

  invalidate(): void {}

  /** Whether this card is the approval-intent presentation. */
  private get approval(): boolean {
    return this.options.question.intent?.kind === 'approval'
  }

  /** Seconds left on a timed card, or `undefined` when it is not timed. */
  private secondsLeft(): number | undefined {
    const deadline = this.options.deadline
    if (deadline === undefined) return undefined
    return Math.max(0, Math.ceil((deadline - Date.now()) / 1_000))
  }

  /**
   * The "other" row, under the options it complements.
   *
   * The marker follows the list's own vocabulary: a single-select list marks the
   * row the keyboard is on with its cursor arrow, while a multi-select list owns
   * that column with a pencil, because its toggles describe choices and this row
   * is not one. An answer typed here never joins a single-select selection; it
   * replaces it. An approval card has fixed actions and no free-text answer, so
   * it has no such row at all.
   */
  private renderCustomRow(inner: number): string {
    const s = buildStyles(this.options.color)
    const question = this.options.question
    const current = this.cursor === (question.options?.length ?? 0)
    const marker = question.multiSelect === true ? '✎' : current ? '›' : ' '
    const caret = this.editing ? '▌' : ''
    const draft = this.text.replace(/[\r\n\t]/gu, ' ')
    // The label stays put and only the draft is trimmed from the left, so a long
    // answer never scrolls away the row that says what it is.
    const lead = `${marker} ${draft === '' ? t('question.custom') : t('question.otherPrefix')}`
    const room = Math.max(1, inner - visibleWidth(`${lead}${caret}`))
    const line = draft === ''
      ? truncateToWidth(`${lead}${caret}`, inner)
      : `${lead}${tailToWidth(draft, room)}${caret}`
    return current ? s.accent(line) : line
  }

  /** The marker one option carries on an approval card, by what it decides. */
  private approvalMark(label: string): string {
    const intent = this.options.question.intent
    if (intent === undefined) return ' '
    if (intent.approve === label) return '✓'
    if (intent.reject === label) return '✕'
    if (intent.always === label) return '∞'
    return ' '
  }

  render(width: number): string[] {
    const s = buildStyles(this.options.color)
    const question = this.options.question
    const panelWidth = width
    const inner = panelWidth - 4
    const body: string[] = []

    if (this.approval) {
      // The subject is who or what asks: a URL icon is caller metadata the
      // terminal cannot fetch, so the name carries the recognition on its own.
      const subject = question.intent?.subject
      if (subject !== undefined) body.push(s.accent(truncateToWidth(subject.name, inner)))
      const heading = displayText(question.intent?.display?.question) ?? question.question
      body.push(truncateToWidth(heading, inner))
      const detail = displayText(question.intent?.display?.detail) ?? question.detail
      if (detail !== undefined && detail !== '') body.push(s.dim(truncateToWidth(detail, inner)))
    } else {
      const heading = question.header === undefined ? '' : `[${question.header}] `
      body.push(truncateToWidth(`${heading}${question.question}`, inner))
      if (question.detail !== undefined && question.detail !== '') {
        body.push(s.dim(truncateToWidth(question.detail, inner)))
      }
    }
    body.push('')

    const options = question.options ?? []
    if (options.length > 0) {
      // A CUA approval ships display translations for its approve label while
      // the wire choice stays English. Show the terminal's language, but keep
      // `option.label` as the selected value the Host compares by identity.
      const approveLabel = displayText(question.intent?.display?.approve)
      options.forEach((option, index) => {
        const isCurrent = index === this.cursor
        const marker = this.approval
          ? this.approvalMark(option.label)
          : question.multiSelect === true
            ? (this.toggled.has(index) ? '●' : '○')
            : isCurrent ? '›' : ' '
        const shown = this.approval && option.label === question.intent?.approve && approveLabel !== undefined
          ? approveLabel
          : option.label
        const label = `${marker} ${shown}${option.description === undefined ? '' : ` — ${option.description}`}`
        body.push(isCurrent ? s.accent(truncateToWidth(label, inner)) : truncateToWidth(label, inner))
      })
      if (!this.approval) body.push(this.renderCustomRow(inner))
    } else {
      body.push(s.accent(tailToWidth(`> ${this.text}▌`, inner)))
    }

    const onCustom = this.cursor === options.length
    const base = options.length === 0
      ? t('question.footer.type')
      : this.editing
        ? t('question.footer.confirm')
        : this.options.deadline !== undefined
          ? t('question.footer.timed')
          : this.approval
            ? t('question.footer.single')
            : onCustom
              ? t('question.footer.custom')
              : question.multiSelect === true
                ? t('question.footer.multi')
                : t('question.footer.single')
    // A timed card says what is left of its window before it says what the keys
    // do: the countdown is the one reading that changes while it waits.
    const left = this.secondsLeft()
    const footer = [s.dim(left === undefined ? base : `${t('question.countdown', { n: left })} · ${base}`)]

    const title = this.approval
      ? t('question.approvalTitle')
      : this.options.continued === true
        ? t('question.continuedTitle')
        : question.header ?? t('question.title')
    return panel(panelWidth, title, body, footer)
  }

  /** Checked labels for a multi-select question, otherwise none. */
  private checked(options: readonly TerminalQuestionOption[]): string[] {
    return this.options.question.multiSelect === true
      ? options.filter((_option, index) => this.toggled.has(index)).map(option => option.label)
      : []
  }

  private submit(options: readonly TerminalQuestionOption[], custom: string): void {
    if (custom !== '') {
      // The typed answer replaces a single-select highlight and rides along with
      // every checked label of a multi-select question, as the Harness web
      // composer does.
      this.options.onResult({ kind: 'answer', answer: { selected: this.checked(options), custom } })
      return
    }
    const selected = this.options.question.multiSelect === true
      ? this.checked(options)
      : [options[this.cursor]?.label ?? '']
    this.options.onResult({ kind: 'answer', answer: { selected } })
  }

  /** Field input, shared by an optionless question and the "other" row. */
  private edit(data: string, options: readonly TerminalQuestionOption[]): void {
    if (matchesKey(data, 'backspace')) {
      this.text = this.text.slice(0, -1)
      return
    }
    if (matchesKey(data, 'ctrl+u')) {
      this.text = ''
      return
    }
    if (matchesKey(data, 'ctrl+w')) {
      this.text = this.text.replace(/\s*\S+$/u, '')
      return
    }
    if (matchesKey(data, 'enter')) {
      const custom = this.text.trim()
      if (custom === '') {
        // An optionless question has nothing to fall back on and keeps waiting;
        // a listed one returns to its rows so the empty field is not a dead end.
        if (options.length > 0) this.editing = false
        return
      }
      this.submit(options, custom)
      return
    }
    this.text += printable(data)
  }

  handleInput(data: string): void {
    const question = this.options.question
    const options = question.options ?? []
    const onCustom = this.cursor === options.length

    if (matchesKey(data, 'ctrl+c')) {
      this.options.onResult({ kind: 'cancel' })
      return
    }
    if (matchesKey(data, 'alt+d')) {
      this.options.onResult({ kind: 'delegate' })
      return
    }
    if (matchesKey(data, 'escape')) {
      if (this.editing) {
        this.editing = false
        return
      }
      this.options.onResult(this.options.parkable === true ? { kind: 'park' } : { kind: 'cancel' })
      return
    }

    if (options.length === 0 || this.editing) {
      this.edit(data, options)
      return
    }

    if (listMove(data, 'up')) {
      this.cursor = Math.max(0, this.cursor - 1)
      return
    }
    if (listMove(data, 'down')) {
      // An approval card has fixed actions: the cursor never reaches a free-text
      // row it does not have.
      const last = this.approval ? options.length - 1 : options.length
      this.cursor = Math.min(last, this.cursor + 1)
      return
    }

    if (matchesKey(data, 'space') && question.multiSelect === true) {
      if (!onCustom) {
        if (this.toggled.has(this.cursor)) this.toggled.delete(this.cursor)
        else this.toggled.add(this.cursor)
      }
      return
    }
    if (matchesKey(data, 'enter')) {
      if (onCustom) {
        this.editing = true
        return
      }
      this.submit(options, '')
      return
    }
    // Typing on the "other" row is the same gesture as opening it.
    const typed = printable(data)
    if (onCustom && typed !== '') {
      this.editing = true
      this.text += typed
    }
  }
}
