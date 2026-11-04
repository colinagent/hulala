import { expect, test } from 'bun:test'
import { visibleWidth } from '@earendil-works/pi-tui'
import { fitPath } from '../../src/tui/view/pathText.js'

const HOME = process.env.HOME ?? '/Users/nobody'
const DEEP = '/opt/company/teams/platform/services/hulala'

test('a path that fits is shown as it is, with home shortened', () => {
  expect(fitPath(`${HOME}/note`, 24)).toBe('~/note')
  expect(fitPath(`${HOME}/note/projects/hulala`, 22)).toBe('~/note/projects/hulala')
})

test('a long path loses whole leading segments, never half of one', () => {
  expect(fitPath(DEEP, 18)).toBe('…/services/hulala')
  expect(fitPath(DEEP, 12)).toBe('…/hulala')
  for (const width of [8, 12, 16, 18, 20, 24]) {
    expect(visibleWidth(fitPath(DEEP, width))).toBeLessThanOrEqual(width)
  }
})

test('a single segment that cannot fit is clipped from the right', () => {
  expect(fitPath('/hulala-workspace-long-name', 12)).toBe('hulala-work…')
  expect(fitPath('/hulala-workspace-long-name', 4)).toBe('hul…')
})
