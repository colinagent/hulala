import { expect, test } from 'bun:test'
import { ImeOwnershipGate } from '../../src/tui/editor/imeOwnershipGate.js'

/** A claim that records every call, so a pairing bug is visible as a sequence. */
function gateAt(focused = true): { gate: ImeOwnershipGate; calls: string[] } {
  const calls: string[] = []
  const gate = new ImeOwnershipGate({
    acquire: () => { calls.push('acquire') },
    release: () => { calls.push('release') },
  }, focused)
  return { gate, calls }
}

test('a command surface in front holds English once, not once per event', () => {
  const { gate, calls } = gateAt()
  gate.setPolicy('command')
  gate.setPolicy('command')
  expect(calls).toEqual(['acquire'])
  expect(gate.held).toBe(true)
})

test('a text surface never switches, and gives back what it held', () => {
  const { gate, calls } = gateAt()
  gate.setPolicy('text')
  expect(calls).toEqual([])
  gate.setPolicy('command')
  gate.setPolicy('text')
  expect(calls).toEqual(['acquire', 'release'])
  expect(gate.held).toBe(false)
})

test('losing the window gives the source back at once', () => {
  const { gate, calls } = gateAt()
  gate.setPolicy('command')
  gate.setFocus(false)
  expect(calls).toEqual(['acquire', 'release'])
  expect(gate.held).toBe(false)
})

test('policy changes in a background window call nothing', () => {
  // The bug this rule exists for: an approval card appearing in a window nobody
  // is looking at used to select a source on the machine the user was typing on.
  const { gate, calls } = gateAt(false)
  gate.setPolicy('command')
  gate.setPolicy('text')
  gate.setPolicy('command')
  expect(calls).toEqual([])
})

test('coming back to a command surface acquires; coming back to text does not', () => {
  const first = gateAt(false)
  first.gate.setPolicy('command')
  first.gate.setFocus(true)
  expect(first.calls).toEqual(['acquire'])

  const second = gateAt(false)
  second.gate.setFocus(true)
  expect(second.calls).toEqual([])
})

test('a repeated focus report changes nothing', () => {
  const { gate, calls } = gateAt(true)
  gate.setPolicy('command')
  gate.setFocus(true)
  gate.setFocus(true)
  expect(calls).toEqual(['acquire'])
})
