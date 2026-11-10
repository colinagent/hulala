import { expect, test } from 'bun:test'
import { devStart, type DevSteps } from '../scripts/dev'

/** A recorder plus the default successful actions. */
function steps(order: string[], overrides: Partial<DevSteps> = {}): DevSteps {
  return {
    stopHost: async () => {
      order.push('stop')
      return 'stopped'
    },
    buildHost: async () => {
      order.push('host')
      return 0
    },
    buildClient: async () => {
      order.push('client')
      return 0
    },
    runClient: async args => {
      order.push(`run:${args.join(' ')}`)
      return 7
    },
    ...overrides,
  }
}

test('dev start stops the Host, rebuilds it and the client, and only then runs the client', async () => {
  const order: string[] = []
  const previous = process.env.HULALA_PACKAGE_ROOT
  process.env.HULALA_PACKAGE_ROOT = '/an/installed/release'
  try {
    const code = await devStart(['--resume', 'session-1'], steps(order))
    expect(order).toEqual(['stop', 'host', 'client', 'run:--resume session-1'])
    expect(code).toBe(7)
    // The packaged Host must never win in a source checkout.
    expect(process.env.HULALA_PACKAGE_ROOT).toBeUndefined()
  } finally {
    if (previous === undefined) delete process.env.HULALA_PACKAGE_ROOT
    else process.env.HULALA_PACKAGE_ROOT = previous
  }
})

test('a failed Host build leaves the client stopped', async () => {
  const order: string[] = []
  const code = await devStart([], steps(order, {
    buildHost: async () => {
      order.push('host')
      return 3
    },
  }))
  expect(order).toEqual(['stop', 'host'])
  expect(code).toBe(3)
})

test('a failed client build does not run a stale bundle', async () => {
  const order: string[] = []
  const code = await devStart([], steps(order, {
    buildClient: async () => {
      order.push('client')
      return 4
    },
  }))
  expect(order).toEqual(['stop', 'host', 'client'])
  expect(code).toBe(4)
})

test('a Host that cannot be stopped does not start a rival', async () => {
  const order: string[] = []
  const code = await devStart([], steps(order, {
    stopHost: async () => {
      order.push('stop')
      throw new Error('permission denied')
    },
  }))
  expect(order).toEqual(['stop'])
  expect(code).toBe(1)
})
