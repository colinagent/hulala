import { expect, test } from 'bun:test'
import { DesktopConnection } from './desktopConnection'

test('concurrent view initialization shares one connection and explicit reconnect opens exactly one replacement', async () => {
  const previous = globalThis.window
  type Listener = (value: { tabId: string; state: 'connected' | 'disconnected' }) => void
  const listeners = new Set<Listener>()
  let starts = 0, connected = 0
  const ready: Array<() => void> = []
  const desktop = {
    connect: () => { starts++; return new Promise(resolve => ready.push(() => { for (const listener of listeners) listener({ tabId: 'view', state: 'connected' }); resolve({ instanceId: 'test' }) })) },
    async disconnect() { for (const listener of listeners) listener({ tabId: 'view', state: 'disconnected' }) },
    onConnection(listener: Listener) { listeners.add(listener); return () => listeners.delete(listener) },
    onEvent() { return () => {} },
  }
  globalThis.window = Object.assign(new EventTarget(), { setTimeout, clearTimeout, hulala: { desktop } }) as unknown as Window & typeof globalThis
  const connection = new DesktopConnection('view')
  try {
    const first = connection.connect({ onConnect: () => { connected += 100 } })
    const second = connection.connect({ onConnect: () => { connected++ } })
    expect(starts).toBe(1)
    ready.shift()!()
    await Promise.all([first, second])
    expect(connected).toBe(1)
    await connection.connect({ onConnect: () => { connected++ } })
    expect(starts).toBe(1)
    const reconnect = connection.forceReconnect()
    await Promise.resolve(); await Promise.resolve()
    expect(starts).toBe(2)
    ready.shift()!()
    await reconnect
    expect(connection.state).toBe('connected')
    expect(connected).toBe(2)
  } finally { connection.dispose(); globalThis.window = previous }
})
