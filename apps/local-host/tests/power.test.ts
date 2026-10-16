import { expect, test } from 'bun:test'
import { SleepPrevention } from '../src/browser/power'

test('service sleep prevention serializes changes and releases one owned assertion', async () => {
  let starts = 0, stops = 0
  const power = new SleepPrevention('darwin', async () => { starts++; return async () => { stops++ } })
  await Promise.all([power.apply(true), power.apply(true)])
  expect(starts).toBe(1)
  expect(power.snapshot().active).toBeTrue()
  await power.stop(); await power.stop()
  expect(stops).toBe(1)
  expect(power.snapshot().active).toBeFalse()
})
test('a denied power request never reports an active inhibitor', async () => {
  const power = new SleepPrevention('darwin', async () => { throw new Error('fixture denial') })
  await expect(power.apply(true)).rejects.toThrow('fixture denial')
  expect(power.snapshot()).toMatchObject({ active: false, error: 'fixture denial' })
  await power.stop()
})
