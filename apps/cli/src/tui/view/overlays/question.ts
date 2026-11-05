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
 * draft survives a second look at the choices; a second `Esc` cancels. Nothing
 * typed is ever submitted empty, so a stray `Enter` cannot answer for the user.
 *
 * @module hulala-cli/tui/view/overlays/question
 */
import type { Component } from '@earendil-works/pi-tui'
import { matchesKey, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import type { TerminalQuestion, TerminalQuestionOption } from '../../data/remote.js'
import { t } from '../../i18n/index.js'
import { listMove } from '../../keys.js'
import { buildStyles } from '../theme.js'
import { panel } from './panel.js'

export interface QuestionAnswer {
  selected: string[]
  custom?: string
}

export interface QuestionOverlayOptions {
  question: TerminalQuestion
  color: boolean
  onAnswer(answer: QuestionAnswer | undefined): void
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

export class QuestionOverlay implements Component {
  private readonly options: QuestionOverlayOptions
  private cursor = 0
  private readonly toggled = new Set<number>()
  private text = ''
  private editing = false

  constructor(options: QuestionOverlayOptions) {
    this.options = options
  }

  invalidate(): void {}

  /**
   * The "other" row, under the options it complements.
   *
   * The marker follows the list's own vocabulary: a single-select list marks the
   * row the keyboard is on with its cursor arrow, while a multi-select list owns
   * that column with a pencil, because its toggles describe choices and this row
   * is not one. An answer typed here never joins a single-select selection; it
   * replaces it.
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

  render(width: number): string[] {
    const s = buildStyles(this.options.color)
    const question = this.options.question
    const panelWidth = width
    const inner = panelWidth - 4
    const heading = question.header === undefined ? '' : `[${question.header}] `
    const body: string[] = [truncateToWidth(`${heading}${question.question}`, inner)]
    if (question.detail !== undefined && question.detail !== '') {
      body.push(s.dim(truncateToWidth(question.detail, inner)))
    }
    body.push('')

    const options = question.options ?? []
    if (options.length > 0) {
      options.forEach((option, index) => {
        const isCurrent = index === this.cursor
        const marker = question.multiSelect === true
          ? (this.toggled.has(index) ? '●' : '○')
          : isCurrent ? '›' : ' '
        const label = `${marker} ${option.label}${option.description === undefined ? '' : ` — ${option.description}`}`
        body.push(isCurrent ? s.accent(truncateToWidth(label, inner)) : truncateToWidth(label, inner))
      })
      body.push(this.renderCustomRow(inner))
    } else {
      body.push(s.accent(tailToWidth(`> ${this.text}▌`, inner)))
    }

    const onCustom = this.cursor === options.length
    const footer = options.length === 0
      ? [s.dim(t('question.footer.type'))]
      : this.editing
        ? [s.dim(t('question.footer.confirm'))]
        : onCustom
          ? [s.dim(t('question.footer.custom'))]
          : question.multiSelect === true
            ? [s.dim(t('question.footer.multi'))]
            : [s.dim(t('question.footer.single'))]
    return panel(panelWidth, question.header ?? t('question.title'), body, footer)
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
      this.options.onAnswer({ selected: this.checked(options), custom })
      return
    }
    const selected = this.options.question.multiSelect === true
      ? this.checked(options)
      : [options[this.cursor]?.label ?? '']
    this.options.onAnswer({ selected })
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
      this.options.onAnswer(undefined)
      return
    }
    if (matchesKey(data, 'escape')) {
      if (this.editing) {
        this.editing = false
        return
      }
      this.options.onAnswer(undefined)
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
      this.cursor = Math.min(options.length, this.cursor + 1)
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
