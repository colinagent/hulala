import { expect, test } from 'bun:test'
import { EventHub } from '../src/events'

test('new subscriptions request a baseline and slow consumers reconnect instead of losing updates silently', () => {
  const hub = new EventHub()
  const received: any[] = []
  let buffered = 0, closed = 0
  const socket = { send: (value: string) => { received.push(JSON.parse(value)); return 1 }, getBufferedAmount: () => buffered, close: () => { closed++ } }
  hub.add(socket as never)
  expect(received[0]).toMatchObject({ type: 'conversation.reset', reason: 'reconnected' })
  hub.emit({ type: 'conversation.sessionsChanged' })
  expect(received[1].transportCursor.seq).toBeGreaterThan(received[0].transportCursor.seq)
  expect(hub.cursor()).toEqual(received[1].transportCursor)
  buffered = 9 * 1024 * 1024
  hub.emit({ type: 'conversation.sessionsChanged' })
  expect(closed).toBe(1)
  expect(received).toHaveLength(2)
})
