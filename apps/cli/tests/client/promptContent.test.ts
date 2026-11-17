/**
 * What a prompt frame carries.
 *
 * A prompt is the text the user wrote and nothing else: a pasted file is a path
 * inside that text, opened by the model's own tools where the file lives, so
 * there is no second content part to order or to validate.
 */
import { expect, test } from 'bun:test'
import { promptContent } from '../../src/tui/data/remote.js'

test('a prompt is one text part', () => {
  expect(promptContent('hello')).toEqual([{ type: 'text', text: 'hello' }])
})

test('a pasted path stays inside the text the user wrote', () => {
  const line = 'describe /root/.hulala/transfers/paste-screenshot-20261117-120000-ab12cd34.png'
  expect(promptContent(line)).toEqual([{ type: 'text', text: line }])
})
