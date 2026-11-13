/**
 * What a prompt frame carries.
 *
 * Text always leads, because the Host's projection and the transcript treat the
 * first text part as the message the user wrote; images follow in paste order.
 * The bytes are already base64 when they arrive here, so this is a pure ordering
 * and shape contract — which is exactly what a mismatch would break.
 */
import { expect, test } from 'bun:test'
import { promptContent, type PromptImage } from '../../src/tui/data/remote.js'

const png: PromptImage = { data: 'iVBORw0KGgo=', mediaType: 'image/png' }
const jpeg: PromptImage = { data: '/9j/4AAQ', mediaType: 'image/jpeg' }

test('a text-only prompt is one text part', () => {
  expect(promptContent('hello')).toEqual([{ type: 'text', text: 'hello' }])
})

test('images follow the text in paste order', () => {
  expect(promptContent('look', [png, jpeg])).toEqual([
    { type: 'text', text: 'look' },
    { type: 'image', mediaType: 'image/png', data: png.data },
    { type: 'image', mediaType: 'image/jpeg', data: jpeg.data },
  ])
})

test('an image-only draft still carries an empty text part', () => {
  expect(promptContent('', [png])).toEqual([
    { type: 'text', text: '' },
    { type: 'image', mediaType: 'image/png', data: png.data },
  ])
})
