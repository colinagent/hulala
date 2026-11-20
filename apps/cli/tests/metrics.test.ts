import { expect, test } from 'bun:test'
import { emptyMetrics, formatTokens, tokensPerSecond, usageTotal } from '../src/tui/data/viewModel.js'

test('sums every disjoint bucket DSH reports, cache write included', () => {
  expect(usageTotal({ uncachedInputTokens: 120, cacheReadTokens: 380, cacheWriteTokens: 40, outputTokens: 60 }))
    .toBe(600)
  expect(usageTotal({ uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 })).toBe(0)
})

test('derives speed from the Host decode window and its own output tokens', () => {
  expect(tokensPerSecond({ decodeTokens: 80, decodeMs: 1_000 })).toBe(80)
  // A measured session: 71,146 output tokens over 402 s of decode.
  expect(tokensPerSecond({ decodeTokens: 71_146, decodeMs: 402_061 }) ?? 0).toBeCloseTo(176.95, 2)
})

test('shows nothing until the Host reports a timed window', () => {
  expect(emptyMetrics()).toEqual({})
  expect(tokensPerSecond({})).toBeUndefined()
  expect(tokensPerSecond({ decodeTokens: 10 })).toBeUndefined()
  expect(tokensPerSecond({ decodeTokens: 10, decodeMs: 0 })).toBeUndefined()
  expect(tokensPerSecond({ decodeTokens: 0, decodeMs: 500 })).toBeUndefined()
})

test('formats token totals the way pi does', () => {
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(12_400)).toBe('12k')
  expect(formatTokens(3_120_000)).toBe('3.1M')
  expect(formatTokens(1_000_000)).toBe('1.0M')
  expect(formatTokens(6_405_575)).toBe('6.4M')
  expect(formatTokens(118_000_000)).toBe('118M')
})
