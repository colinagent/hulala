/**
 * The editor channel's reconnect.
 *
 * A dropped socket is usually a dropped tunnel or a restarted client, not a dead
 * editor: the Host keeps the Neovim it started for an id, so the channel comes
 * back to the same buffers. What is pinned here is that it does come back, that
 * it says so (so the grid can be rebuilt), and that it gives up instead of
 * reconnecting forever.
 */
import { expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { createEditorChannel } from '../../src/tui/data/editorChannel.ts'

/** The smallest WebSocket a `ws` client has to look like. */
class FakeSocket extends EventEmitter {
  static readonly OPEN = 1
  readyState = 0
  readonly sent: string[] = []
  readonly binary: Uint8Array[] = []

  constructor() {
    super()
    queueMicrotask(() => {
      this.readyState = FakeSocket.OPEN
      this.emit('open')
    })
  }

  send(payload: string | Uint8Array, options?: { binary?: boolean }): void {
    if (typeof payload === 'string') this.sent.push(payload)
    else if (options?.binary === true) this.binary.push(payload)
    else this.sent.push(new TextDecoder().decode(payload))
  }

  close(): void {
    this.readyState = 3
    this.emit('close')
  }

  /** Simulate the network dropping the socket. */
  drop(): void {
    this.readyState = 3
    this.emit('close')
  }

  /** Answer with one control frame. */
  reply(value: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(value)), false)
  }
}

const theme = { background: '#000000', foreground: '#ffffff', palette: [] }

test('a dropped socket reconnects to the editor the Host kept', async () => {
  const sockets: FakeSocket[] = []
  const channel = createEditorChannel({
    baseUrl: 'http://127.0.0.1:1',
    cookie: 'c=1',
    socket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket as never
    },
    reconnect: { attempts: 3, delayMs: 5 },
  })
  let resumed = 0
  channel.onReconnect(() => { resumed += 1 })
  const opened = channel.open({ id: 'editor-1', cwd: '/work', cols: 80, rows: 24, theme })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(sockets[0]?.sent[0]).toContain('"id":"editor-1"')
  sockets[0]!.reply({ kind: 'ready', command: 'nvim', resumed: false })
  await opened

  // The socket drops: the channel retries with the same identity.
  sockets[0]!.drop()
  await new Promise(resolve => setTimeout(resolve, 30))
  expect(sockets).toHaveLength(2)
  expect(sockets[1]?.sent[0]).toContain('"id":"editor-1"')
  sockets[1]!.reply({ kind: 'ready', command: 'nvim', resumed: true })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(resumed).toBe(1)
  channel.close()
})

test('a reconnect that is never answered gives up and reports the column gone', async () => {
  const sockets: FakeSocket[] = []
  const exits: Array<{ code: number | null }> = []
  const channel = createEditorChannel({
    baseUrl: 'http://127.0.0.1:1',
    cookie: 'c=1',
    socket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket as never
    },
    reconnect: { attempts: 2, delayMs: 5 },
  })
  channel.onExit(event => exits.push(event))
  void channel.open({ id: 'editor-2', cwd: '/work', cols: 80, rows: 24, theme })
  await new Promise(resolve => setTimeout(resolve, 0))
  sockets[0]!.reply({ kind: 'ready', command: 'nvim', resumed: false })
  sockets[0]!.drop()
  // Two more attempts, each dropped without an answer.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 40))
    sockets.at(-1)?.drop()
  }
  await new Promise(resolve => setTimeout(resolve, 60))
  expect(exits).toEqual([{ code: null }])
  expect(sockets).toHaveLength(3)
  channel.close()
})

test('a deliberate close never reconnects', async () => {
  const sockets: FakeSocket[] = []
  const channel = createEditorChannel({
    baseUrl: 'http://127.0.0.1:1',
    cookie: 'c=1',
    socket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket as never
    },
    reconnect: { attempts: 3, delayMs: 5 },
  })
  void channel.open({ id: 'editor-3', cwd: '/work', cols: 80, rows: 24, theme })
  await new Promise(resolve => setTimeout(resolve, 0))
  sockets[0]!.reply({ kind: 'ready', command: 'nvim', resumed: false })
  channel.close()
  await new Promise(resolve => setTimeout(resolve, 40))
  expect(sockets).toHaveLength(1)
})
