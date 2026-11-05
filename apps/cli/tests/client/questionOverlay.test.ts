import { expect, test } from 'bun:test'
import { visibleWidth } from '@earendil-works/pi-tui'
import type { TerminalQuestion } from '../../src/tui/data/remote.js'
import { QuestionOverlay, type QuestionAnswer } from '../../src/tui/view/overlays/question.js'

const strip = (lines: readonly string[]): string[] => lines.map(line => line
  .replace(/\u001b\[[0-9;]*m/gu, '')
  .replace(/\u001b_pi:[^\u0007]*\u0007/gu, ''))

function overlay(question: TerminalQuestion): { view: QuestionOverlay; answers: Array<QuestionAnswer | undefined> } {
  const answers: Array<QuestionAnswer | undefined> = []
  const view = new QuestionOverlay({ question, color: false, onAnswer: answer => answers.push(answer) })
  return { view, answers }
}

function text(view: QuestionOverlay, width = 72): string {
  return strip(view.render(width)).join('\n')
}

/** Move the cursor from the first option onto the "other" row. */
function toCustom(view: QuestionOverlay, options: number): void {
  for (let index = 0; index < options; index += 1) view.handleInput('\u000e') // Ctrl-N
}

const single: TerminalQuestion = {
  id: 'dev',
  header: 'dev offline',
  question: '[dev offline] SSH to dev (100.64.0.30) timed out',
  options: [
    { label: 'Power dev back on, then retry (Recommended)', description: 'Ping me when up' },
    { label: 'Use another online host' },
    { label: 'Supply another address/port for dev' },
  ],
}

test('a listed question ends with a typed-answer row without disturbing the options', () => {
  const { view } = overlay(single)
  const rendered = text(view)
  expect(rendered).toContain('› Power dev back on, then retry (Recommended) — Ping me when up')
  expect(rendered).toContain('  Use another online host')
  expect(rendered).toContain('  Other (type your answer)')
  expect(rendered).toContain('Enter confirms · Esc cancels')
  expect(rendered).not.toContain('▌')
})

test('Enter on the other row opens the field and submits exactly what was typed', () => {
  const { view, answers } = overlay(single)
  toCustom(view, 3)
  view.handleInput('\r')
  expect(text(view)).toContain('› Other (type your answer)▌')
  expect(text(view)).toContain('Enter confirms · Esc back to options')
  for (const character of 'switch to cn01') view.handleInput(character)
  view.handleInput('\r')
  expect(answers).toEqual([{ selected: [], custom: 'switch to cn01' }])
})

test('typing on the other row starts the answer without a separate Enter', () => {
  const { view, answers } = overlay(single)
  toCustom(view, 3)
  view.handleInput('j')
  view.handleInput('p')
  view.handleInput('0')
  view.handleInput('1')
  expect(text(view)).toContain('Other: jp01▌')
  view.handleInput('\r')
  expect(answers).toEqual([{ selected: [], custom: 'jp01' }])
})

test('Enter on an option row still answers with that label alone', () => {
  const { view, answers } = overlay(single)
  view.handleInput('\u000e') // Ctrl-N: second row
  view.handleInput('\r')
  expect(answers).toEqual([{ selected: ['Use another online host'] }])
})

test('a multi-select typed answer keeps every checked label', () => {
  const { view, answers } = overlay({ ...single, options: single.options!.slice(0, 2), multiSelect: true })
  view.handleInput(' ') // check the first row
  toCustom(view, 2)
  view.handleInput('\r')
  for (const character of 'try this first') view.handleInput(character)
  view.handleInput('\r')
  expect(answers).toEqual([{ selected: ['Power dev back on, then retry (Recommended)'], custom: 'try this first' }])
})

test('Escape while typing returns to the options and keeps the draft; a second Escape cancels', () => {
  const { view, answers } = overlay(single)
  toCustom(view, 3)
  view.handleInput('\r')
  for (const character of 'cn01') view.handleInput(character)
  view.handleInput('\u001b')
  expect(answers).toEqual([])
  const rendered = text(view)
  expect(rendered).toContain('› Other: cn01')
  expect(rendered).toContain('Esc cancels')
  view.handleInput('\u001b')
  expect(answers).toEqual([undefined])
})

test('the cursor stops on the other row instead of wrapping', () => {
  const { view, answers } = overlay(single)
  for (let index = 0; index < 8; index += 1) view.handleInput('\u000e')
  expect(text(view)).toContain('› Other (type your answer)')
  expect(text(view)).toContain('Enter types your answer · Esc cancels')
  view.handleInput('\r')
  expect(answers).toEqual([])
  expect(text(view)).toContain('Esc back to options')
})

test('Space on the other row of a multi-select list toggles nothing', () => {
  const { view, answers } = overlay({ ...single, options: single.options!.slice(0, 2), multiSelect: true })
  toCustom(view, 2)
  view.handleInput(' ')
  view.handleInput('\r')
  for (const character of 'try them all') view.handleInput(character)
  view.handleInput('\r')
  expect(answers).toEqual([{ selected: [], custom: 'try them all' }])
})

test('an empty Enter in the field answers nothing: it returns to the rows', () => {
  const { view, answers } = overlay(single)
  toCustom(view, 3)
  view.handleInput('\r')
  view.handleInput('\r')
  expect(answers).toEqual([])
  expect(text(view)).toContain('› Other (type your answer)')
})

test('key sequences and an empty line never become the answer', () => {
  const { view, answers } = overlay(single)
  toCustom(view, 3)
  view.handleInput('\r')
  view.handleInput('jp01')
  view.handleInput('\u001b[A') // Up: a key, not text
  view.handleInput('\u001b[200~cn01\u001b[201~') // bracketed paste is text
  view.handleInput('\u001b[3~') // Delete key: ignored
  view.handleInput('\u007f') // Backspace: edits
  view.handleInput('\r')
  expect(answers).toEqual([{ selected: [], custom: 'jp01cn0' }])
})

test('a question without options is still a bare field', () => {
  const question: TerminalQuestion = { id: 'host', question: 'Which host should I use?' }
  const { view, answers } = overlay(question)
  expect(text(view)).toContain('> ▌')
  expect(text(view)).toContain('Type an answer · Enter confirms · Esc cancels')
  for (const character of 'jp01') view.handleInput(character)
  view.handleInput('\r')
  expect(answers).toEqual([{ selected: [], custom: 'jp01' }])
})

test('a long CJK draft keeps the caret and its tail inside the panel', () => {
  const { view } = overlay(single)
  toCustom(view, 3)
  view.handleInput('\r')
  for (const character of '把 dev 换成 jp01，用公网地址，端口 22，密钥不变') view.handleInput(character)
  const lines = view.render(48)
  for (const line of lines) expect(visibleWidth(line) <= 48).toBe(true)
  const row = strip(lines).find(line => line.includes('Other: ')) ?? ''
  expect(row).toContain('…')
  expect(row).toContain('▌')
  expect(row.endsWith('▌ │')).toBe(true)
})

test('the draft is clamped to the panel width while the rows still move', () => {
  const { view } = overlay(single)
  toCustom(view, 3)
  view.handleInput('\r')
  for (let index = 0; index < 40; index += 1) view.handleInput('x')
  const lines = view.render(72)
  for (const line of lines) expect(visibleWidth(line) <= 72).toBe(true)
})
