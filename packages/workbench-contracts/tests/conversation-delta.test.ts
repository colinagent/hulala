import { expect, test } from 'bun:test'
import { applyConversationDelta, conversationDeltaSchema, conversationItemSchema, MAX_CONVERSATION_BLOCKS, type ConversationDelta, type ConversationItem } from '../src/index'

function chunk(index: number, text: string, type: 'text-delta' | 'reasoning-delta' = 'text-delta'): ConversationDelta {
  return { op: 'assistant-chunk', id: 'assistant:1:1', anchorSeq: 1, anchorTime: 1, turn: 1, step: 1, index, chunk: { type, text } }
}

test('silent leading blocks keep their indices without producing undefined entries during streaming', () => {
  const items = new Map<string, ConversationItem>()
  // Harness suppresses empty reasoning at index 0; the first visible block is 1.
  applyConversationDelta(items, chunk(1, 'First'))
  const first = items.get('assistant:1:1')!
  expect(conversationItemSchema.safeParse(first).success).toBe(true)
  applyConversationDelta(items, chunk(1, ' second'))
  const second = items.get('assistant:1:1')!
  expect(conversationItemSchema.safeParse(second).success).toBe(true)
  if (second.kind !== 'assistant') throw new Error('Expected assistant')
  // This is the ActivityPanel preview operation that originally blanked the app.
  expect(second.blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('')).toBe('First second')
  expect(first).toMatchObject({ blocks: [{ type: 'text', text: '' }, { type: 'text', text: 'First' }] })

  applyConversationDelta(items, chunk(0, 'Earlier reasoning', 'reasoning-delta'))
  expect(items.get('assistant:1:1')).toMatchObject({ blocks: [
    { type: 'reasoning', text: 'Earlier reasoning' },
    { type: 'text', text: 'First second' },
  ] })
})

test('out-of-range block indices are rejected before any allocation or item mutation', () => {
  const items = new Map<string, ConversationItem>()
  applyConversationDelta(items, chunk(0, 'Keep this'))
  const previous = items.get('assistant:1:1')
  for (const index of [-1, 0.5, MAX_CONVERSATION_BLOCKS, Number.MAX_SAFE_INTEGER]) {
    expect(conversationDeltaSchema.safeParse(chunk(index, 'invalid')).success).toBe(false)
    expect(() => applyConversationDelta(items, chunk(index, 'invalid'))).toThrow()
    expect(items.get('assistant:1:1')).toBe(previous)
  }
})

test('a later finalized block preserves skipped positions for subsequent chunks', () => {
  const items = new Map<string, ConversationItem>()
  const end = chunk(3, '')
  if (end.op !== 'assistant-chunk') throw new Error('Expected chunk')
  end.chunk = { type: 'block-end', block: { type: 'image', mediaType: 'image/png', attachmentId: 'image-1' } }
  applyConversationDelta(items, end)
  expect(conversationItemSchema.safeParse(items.get(end.id)).success).toBe(true)
  applyConversationDelta(items, chunk(1, 'text in the middle'))
  expect(items.get(end.id)).toMatchObject({ blocks: [
    { type: 'text', text: '' },
    { type: 'text', text: 'text in the middle' },
    { type: 'text', text: '' },
    { type: 'image', mediaType: 'image/png', attachmentId: 'image-1' },
  ] })
})
