import { expect, test } from 'bun:test'
import { Context } from '@deepseek-ai/cordis'
import type { ScheduleCatalogEntry } from '@deepseek-ai/dsh-schedule'
import { apply, formatTasks } from '../src/plugins/commandTasks.ts'

function task(overrides: Record<string, unknown> = {}): ScheduleCatalogEntry {
  return {
    id: 'schedule-1',
    title: 'BTC 日报',
    prompt: '写日报',
    kind: 'daily',
    time: '06:00:00.000',
    timeZone: 'Asia/Shanghai',
    scheduledAt: '2026-11-16T22:00:00.000Z',
    target: { kind: 'new', create: {} },
    involvedSessionIds: [],
    status: 'active',
    ...overrides,
  } as unknown as ScheduleCatalogEntry
}

test('an empty Host points at the creation command', () => {
  expect(formatTasks([])).toContain('/create-auto-task')
})

test('a daily task shows its zone, next run, and last delivery', () => {
  const text = formatTasks([task({
    lastDelivery: { deliveredAt: '2026-11-15T22:05:00.000Z' },
  })])
  expect(text).toContain('定时任务 1 个（启用 1）')
  expect(text).toContain('BTC 日报 · [启用] · 每天 06:00 Asia/Shanghai')
  expect(text).toContain('下次 11-17 06:00')
  expect(text).toContain('最近投递 11-16 06:05')
})

test('a paused task has no next run', () => {
  const text = formatTasks([task({ status: 'paused' })])
  expect(text).toContain('[暂停]')
  expect(text).not.toContain('下次')
})

test('a cron task shows its expression', () => {
  const text = formatTasks([task({ kind: 'cron', expression: '0 6 * * *' })])
  expect(text).toContain('cron 0 6 * * * Asia/Shanghai')
})

test('a weekly task names its weekdays in Chinese', () => {
  const text = formatTasks([task({ kind: 'weekly', weekdays: [1, 5] })])
  expect(text).toContain('每周一五 06:00 Asia/Shanghai')
})

test('registers /tasks and answers with the Host list', async () => {
  const ctx = new Context()
  const services = ctx as unknown as { provide(name: string, value: unknown): void }
  let definition: {
    name: string
    handler: (invocation: { rawInput: string }) => Promise<{ kind: string; text?: string }>
  } | undefined
  services.provide('commands', {
    register: (candidate: typeof definition) => {
      definition = candidate
      return () => undefined
    },
  })
  services.provide('schedule', { catalog: async () => [task()] })
  apply(ctx)

  expect(definition?.name).toBe('tasks')
  const listed = await definition?.handler({ rawInput: '' })
  expect(listed?.kind).toBe('success')
  expect(listed?.text).toContain('BTC 日报')

  const usage = await definition?.handler({ rawInput: '  unexpected  ' })
  expect(usage?.kind).toBe('error')
})
