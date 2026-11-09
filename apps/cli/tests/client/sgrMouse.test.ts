import { expect, test } from 'bun:test'
import type { TuiMouseEvent } from '@earendil-works/pi-tui'
import { sgrMouse } from '../../src/tui/view/sgrMouse.js'

/** One pointer event, with the defaults a click in a pane carries. */
function event(overrides: Partial<TuiMouseEvent>): TuiMouseEvent {
  return {
    type: 'press',
    button: 'left',
    x: 0,
    y: 0,
    screenX: 0,
    screenY: 0,
    width: 40,
    height: 20,
    shift: false,
    alt: false,
    ctrl: false,
    ...overrides,
  }
}

test('a press reports the button at one-based pane coordinates', () => {
  expect(sgrMouse(event({ x: 0, y: 0 }))).toBe('\u001b[<0;1;1M')
  expect(sgrMouse(event({ x: 11, y: 4 }))).toBe('\u001b[<0;12;5M')
})

test('a drag sets the motion bit so the program sees a held button', () => {
  expect(sgrMouse(event({ type: 'drag', x: 9, y: 2 }))).toBe('\u001b[<32;10;3M')
  expect(sgrMouse(event({ type: 'drag', button: 'right', x: 9, y: 2 }))).toBe('\u001b[<34;10;3M')
})

test('a release ends with m, which is what SGR needs to tell it apart', () => {
  expect(sgrMouse(event({ type: 'release', x: 3, y: 3 }))).toBe('\u001b[<0;4;4m')
})

test('the middle and right buttons keep their own codes', () => {
  expect(sgrMouse(event({ button: 'middle' }))).toBe('\u001b[<1;1;1M')
  expect(sgrMouse(event({ button: 'right' }))).toBe('\u001b[<2;1;1M')
})

test('modifiers are added to the button code', () => {
  expect(sgrMouse(event({ ctrl: true }))).toBe('\u001b[<16;1;1M')
  expect(sgrMouse(event({ shift: true, alt: true }))).toBe('\u001b[<12;1;1M')
  expect(sgrMouse(event({ type: 'drag', ctrl: true, shift: true }))).toBe('\u001b[<52;1;1M')
})

test('a click is the renderer synthesizing the release it already sent', () => {
  expect(sgrMouse(event({ type: 'click', clickCount: 2 }))).toBeUndefined()
})

test('bare motion and the wheel are not reports a program asked for', () => {
  expect(sgrMouse(event({ type: 'move' }))).toBeUndefined()
  expect(sgrMouse(event({ type: 'wheel', button: 'none', wheelDelta: 3 }))).toBeUndefined()
})
