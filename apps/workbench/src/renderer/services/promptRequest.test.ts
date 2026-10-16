import { expect, test } from 'bun:test'
import { PromptRequest } from './promptRequest'

test('retries use the same identity; acknowledged repeats and changed content create a new delivery', () => {
  const request = new PromptRequest()
  const input = { mode: 'queue' as const, content: [{ type: 'text' as const, text: 'Run the tests' }] }
  const first = request.identity('session-a', input)
  expect(request.identity('session-a', structuredClone(input))).toBe(first)
  request.accepted('an older response')
  expect(request.identity('session-a', input)).toBe(first)
  request.accepted(first)
  expect(request.identity('session-a', input)).not.toBe(first)
  const changed = request.identity('session-a', { ...input, mode: 'steer' })
  expect(request.identity('session-b', input)).not.toBe(changed)
})
