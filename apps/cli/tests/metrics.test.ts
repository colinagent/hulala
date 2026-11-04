import { expect, test } from 'bun:test'
import { addDecode, addUsage, cacheHitPercent, emptyMetrics, formatTokens, metricsText, tokensPerSecond, usageOf } from '../src/tui/data/viewModel.js'

test('reads usage out of a settled Assistant event body', () => {
  expect(usageOf({ usage: { inputTokens: 120, outputTokens: 40, cacheReadTokens: 380 } }))
    .toEqual({ inputTokens: 120, outputTokens: 40, cacheReadTokens: 380 })
  expect(usageOf({ usage: { inputTokens: 1 } })).toBeUndefined()
  expect(usageOf({})).toBeUndefined()
  expect(usageOf(null)).toBeUndefined()
})

test('accumulates tokens and decode time across steps', () => {
  let metrics = emptyMetrics()
  metrics = addUsage(metrics, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 300 })
  metrics = addUsage(metrics, { inputTokens: 20, outputTokens: 30 })
  metrics = addDecode(metrics, 1_000)
  metrics = addDecode(metrics, 0)
  expect(metrics).toEqual({ inputTokens: 120, cacheReadTokens: 300, outputTokens: 80, decodeMs: 1_000 })
  expect(tokensPerSecond(metrics)).toBe(80)
  expect(cacheHitPercent(metrics)).toBe(71)
  expect(metricsText(metrics)).toBe('80.0 tok/s · 71% cache · 500 tokens')
})

test('shows nothing until the Host reports activity', () => {
  expect(metricsText(emptyMetrics())).toBe('')
  expect(tokensPerSecond(emptyMetrics())).toBeUndefined()
  expect(cacheHitPercent(emptyMetrics())).toBeUndefined()
})

test('formats token totals the way pi does', () => {
  expect(formatTokens(950)).toBe('950')
  expect(formatTokens(12_400)).toBe('12k')
  expect(formatTokens(3_120_000)).toBe('3.1M')
  expect(formatTokens(1_000_000)).toBe('1.0M')
  expect(formatTokens(118_000_000)).toBe('118M')
})

test('omits speed when no decode window was measured', () => {
  const metrics = addUsage(emptyMetrics(), { inputTokens: 10, outputTokens: 10 })
  // Input and output both count toward the session total.
  expect(metricsText(metrics)).toBe('20 tokens')
})
