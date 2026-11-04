/**
 * User-question modal: single select, multi select, or free text.
 *
 * @module hulala-cli/tui/view/overlays/question
 */
import type { Component } from '@earendil-works/pi-tui'
import { matchesKey, truncateToWidth } from '@earendil-works/pi-tui'
import type { TerminalQuestion } from '../../data/remote.js'
import { LIST_MOVE_HINT, listMove } from '../../keys.js'
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

export class QuestionOverlay implements Component {
  private readonly options: QuestionOverlayOptions
  private cursor = 0
  private readonly toggled = new Set<number>()
  private text = ''

  constructor(options: QuestionOverlayOptions) {
    this.options = options
  }

  invalidate(): void {}

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
    } else {
      body.push(s.accent(`> ${this.text}▌`))
    }

    const footer = options.length === 0
      ? [s.dim('输入答案，Enter 确认 · Esc 取消')]
      : question.multiSelect === true
        ? [s.dim(`${LIST_MOVE_HINT} · Space 勾选 · Enter 确认 · Esc 取消`)]
        : [s.dim(`${LIST_MOVE_HINT} · Enter 确认 · Esc 取消`)]
    return panel(panelWidth, question.header ?? '提问', body, footer)
  }

  handleInput(data: string): void {
    const question = this.options.question
    const options = question.options ?? []

    if (matchesKey(data, 'ctrl+c') || matchesKey(data, 'escape')) {
      this.options.onAnswer(undefined)
      return
    }
    if (listMove(data, 'up')) {
      this.cursor = Math.max(0, this.cursor - 1)
      return
    }
    if (listMove(data, 'down')) {
      this.cursor = Math.min(Math.max(0, options.length - 1), this.cursor + 1)
      return
    }

    if (options.length === 0) {
      if (matchesKey(data, 'backspace')) {
        this.text = this.text.slice(0, -1)
        return
      }
      if (matchesKey(data, 'enter')) {
        this.options.onAnswer({ selected: [], custom: this.text })
        return
      }
      if (data.length === 1 && data.charCodeAt(0) >= 0x20) {
        this.text += data
      }
      return
    }

    if (matchesKey(data, 'space') && question.multiSelect === true) {
      if (this.toggled.has(this.cursor)) this.toggled.delete(this.cursor)
      else this.toggled.add(this.cursor)
      return
    }
    if (matchesKey(data, 'enter')) {
      const selected = question.multiSelect === true
        ? options.filter((_option, index) => this.toggled.has(index)).map(option => option.label)
        : [options[this.cursor]?.label ?? '']
      this.options.onAnswer({ selected })
    }
  }
}
