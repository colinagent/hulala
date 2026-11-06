import { expect, test } from 'bun:test'
import type { TuiMouseButton, TuiMouseEvent, TuiMouseEventType } from '@earendil-works/pi-tui'
import { splitDivider } from '../../src/tui/view/splitDivider.js'

interface Fixture {
  readonly component: ReturnType<typeof splitDivider>['component']
  readonly drags: number[]
  readonly hovers: boolean[]
}

function divider(): Fixture {
  const drags: number[] = []
  const hovers: boolean[] = []
  const { component } = splitDivider({
    rows: () => 4,
    color: false,
    background: () => '',
    onDrag: screenX => drags.push(screenX),
    onHover: hovered => hovers.push(hovered),
  })
  return { component, drags, hovers }
}

function event(type: TuiMouseEventType, screenX: number, button: TuiMouseButton = 'none'): TuiMouseEvent {
  return {
    type,
    button,
    x: 0,
    y: 2,
    screenX,
    screenY: 2,
    width: 1,
    height: 4,
    shift: false,
    alt: false,
    ctrl: false,
  }
}

test('a resting pointer never resizes the column', () => {
  const { component, drags } = divider()
  component.handleMouse?.(event('move', 60))
  expect(drags).toEqual([])
})

test('motion the terminal labels with a button but never pressed is ignored', () => {
  // Some terminals report hover motion with a pressed button, which reaches the
  // component as `drag` with no `press` ahead of it.
  const { component, drags } = divider()
  component.handleMouse?.(event('drag', 60, 'left'))
  component.handleMouse?.(event('drag', 58, 'left'))
  expect(drags).toEqual([])
})

test('a press captures the pointer and its drag moves the column', () => {
  const { component, drags, hovers } = divider()
  expect(component.handleMouse?.(event('press', 60, 'left'))).toEqual({ handled: true, capture: true })
  component.handleMouse?.(event('drag', 58, 'left'))
  component.handleMouse?.(event('drag', 55, 'left'))
  expect(drags).toEqual([58, 55])
  expect(hovers).toEqual([true])
})

test('a release ends the drag, so later motion stays a hover', () => {
  const { component, drags } = divider()
  component.handleMouse?.(event('press', 60, 'left'))
  component.handleMouse?.(event('drag', 58, 'left'))
  component.handleMouse?.(event('release', 58))
  component.handleMouse?.(event('drag', 50, 'left'))
  expect(drags).toEqual([58])
})

test('a lost release heals on the next hover report', () => {
  const { component, drags } = divider()
  component.handleMouse?.(event('press', 60, 'left'))
  // The terminal reports no button down: the gesture is over even though the
  // release event itself was never delivered.
  component.handleMouse?.(event('move', 60))
  component.handleMouse?.(event('drag', 50, 'left'))
  expect(drags).toEqual([])
})

test('right and middle presses do not start a drag', () => {
  const { component, drags } = divider()
  component.handleMouse?.(event('press', 60, 'right'))
  component.handleMouse?.(event('drag', 50, 'left'))
  expect(drags).toEqual([])
})

test('the rule is painted for every row and thickens while hovered', () => {
  const { component } = divider()
  const idle = component.render(1)
  expect(idle).toHaveLength(4)
  component.handleMouse?.(event('move', 60))
  const active = component.render(1)
  expect(active).toHaveLength(4)
  expect(active[0]).not.toBe(idle[0])
})
