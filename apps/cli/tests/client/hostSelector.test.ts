/**
 * The machine picker.
 *
 * Two things matter here: this machine is always a row, so a window can come back
 * from a remote Host, and the selection is the highlight ink on the label rather
 * than a filled row — the frame's rule for every list.
 */
import { expect, test } from 'bun:test'
import { HostSelector } from '../../src/tui/view/selector/host.ts'

function picker(options: { hosts?: readonly string[]; current?: string } = {}): {
  selector: HostSelector
  resolved: string[]
  cancelled(): number
  text(): string
} {
  const resolved: string[] = []
  let cancelled = 0
  const selector = new HostSelector({
    hosts: options.hosts ?? ['devbox', 'gpu'],
    ...(options.current === undefined ? {} : { current: options.current }),
    local: 'this machine',
    title: 'Select a machine',
    hint: 'Enter attaches',
    empty: 'no hosts yet',
    color: true,
    rows: () => 30,
    onResolve: alias => { resolved.push(alias) },
    onCancel: () => { cancelled += 1 },
  })
  return {
    selector,
    resolved,
    // A live count: the closure mutates it after this helper returned.
    cancelled: () => cancelled,
    text: () => selector.render(60).join('\n').replace(/\u001b\[[0-9;]*m/gu, ''),
  }
}

test('this machine is the first row, and it is a choice', () => {
  const { selector, resolved, text } = picker()
  expect(text()).toContain('this machine')
  selector.handleInput('\r')
  expect(resolved).toEqual([''])
})

test('the cursor starts on the machine this window already uses', () => {
  const { selector, resolved } = picker({ current: 'gpu' })
  selector.handleInput('\r')
  expect(resolved).toEqual(['gpu'])
})

test('Enter picks an alias, and Escape cancels without one', () => {
  const down = picker()
  down.selector.handleInput('\u001b[B')
  down.selector.handleInput('\r')
  expect(down.resolved).toEqual(['devbox'])

  const out = picker()
  out.selector.handleInput('\u001b')
  expect(out.cancelled()).toBe(1)
  expect(out.resolved).toEqual([])
})

test('an empty config still offers this machine and says why the list is short', () => {
  const { text } = picker({ hosts: [] })
  expect(text()).toContain('this machine')
  expect(text()).toContain('no hosts yet')
})
