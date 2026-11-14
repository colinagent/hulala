/**
 * The editor column's channel to the Host.
 *
 * One authenticated WebSocket per editor: a JSON `open` frame, the Host's
 * `ready` answer, and then Neovim's own msgpack bytes in both directions. The
 * channel buffers anything sent before `ready`, because the column builds its
 * grid and can receive keys before the socket has opened.
 *
 * @module hulala-cli/tui/data/editorChannel
 */
import WebSocket from 'ws'

/** What one open request tells the Host. */
export interface EditorOpenRequest {
  /**
   * This column's identity, stable across a reconnect.
   *
   * The Host keeps the Neovim it started for an id, so a dropped socket can
   * attach to the same editor instead of starting one that lost the buffers.
   */
  readonly id?: string
  /** Absolute directory on the Host. */
  readonly cwd: string
  readonly cols: number
  readonly rows: number
  /** Colours the client's terminal actually shows. */
  readonly theme: unknown
}

/** The editor channel the column drives. */
export interface EditorChannel {
  /** Resolves once Neovim is running; rejects with the Host's reason. */
  open(request: EditorOpenRequest): Promise<void>
  onData(handler: (chunk: Uint8Array) => void): void
  /** Neovim's diagnostics, which never enter the msgpack stream. */
  onProblem(handler: (text: string) => void): void
  /** Where Neovim's file tree ends, in pane columns. */
  onTree(handler: (column: number | undefined) => void): void
  onExit(handler: (event: { code: number | null }) => void): void
  /**
   * Called after a reconnect attached to the editor the Host kept.
   *
   * The grid is stale — Neovim has been running without us — so the UI resets it
   * and attaches again, which is what makes Neovim send the whole screen.
   */
  onReconnect(handler: () => void): void
  send(chunk: Uint8Array): void
  close(): void
}

/** How the channel opens its socket; injected so tests need no Host. */
export type EditorSocketFactory = (url: string, headers: Record<string, string>) => WebSocket

export interface EditorChannelOptions {
  /** Host origin, e.g. `http://127.0.0.1:1234`. */
  readonly baseUrl: string
  /** The `/connect` cookie, sent as one `Cookie` header. */
  readonly cookie: string
  readonly socket?: EditorSocketFactory
  /** Reconnect budget: attempts and the first delay; tests shrink both. */
  readonly reconnect?: { readonly attempts?: number; readonly delayMs?: number }
}

/** Build the channel one editor column uses. */
export function createEditorChannel(options: EditorChannelOptions): EditorChannel {
  const factory = options.socket ?? ((url, headers) => new WebSocket(url, { headers }))
  const url = `${options.baseUrl.replace(/^http/u, 'ws')}/api/editor`
  const maxAttempts = options.reconnect?.attempts ?? 6
  const firstDelayMs = options.reconnect?.delayMs ?? 400
  let data: (chunk: Uint8Array) => void = () => undefined
  let problem: (text: string) => void = () => undefined
  let exit: (event: { code: number | null }) => void = () => undefined
  let tree: (column: number | undefined) => void = () => undefined
  let reconnected: () => void = () => undefined
  let ready = false
  let settled: { resolve: () => void; reject: (error: Error) => void } | undefined
  let request: EditorOpenRequest | undefined
  /** The request that opened this editor, re-sent on every reconnect. */
  let lastRequest: EditorOpenRequest | undefined
  let socket: WebSocket
  /** Bumped on every connection, so a stale socket's events are ignored. */
  let generation = 0
  /** The reconnect budget for the current drop. */
  let attempts = 0
  let closedByUs = false
  let ended = false
  /** Chunks written before the Host said `ready`; replayed on each connection. */
  const queued: Uint8Array[] = []

  /** One attempt's socket, wired to the current handlers. */
  const connect = (): void => {
    generation += 1
    const mine = generation
    socket = factory(url, { cookie: options.cookie, origin: options.baseUrl })
    socket.on('open', () => {
      if (mine !== generation) return
      flushRequests()
    })
    socket.on('message', (payload: Buffer, isBinary: boolean) => {
      if (mine !== generation) return
      if (isBinary) {
        data(new Uint8Array(payload))
        return
      }
      let message: Record<string, unknown>
      try {
        message = JSON.parse(payload.toString('utf8')) as Record<string, unknown>
      } catch {
        return
      }
      if (message.kind === 'ready') {
        const resumed = message.resumed === true
        ready = true
        attempts = 0
        settled?.resolve()
        settled = undefined
        if (resumed) {
          // Neovim has been running without this UI: the grid must be rebuilt
          // from a fresh attach, and what was queued belongs to the old session.
          queued.length = 0
          reconnected()
        } else {
          flush()
        }
        return
      }
      if (message.kind === 'error') {
        const reason = typeof message.message === 'string' ? message.message : 'the editor failed to start'
        settled?.reject(new Error(reason))
        settled = undefined
        problem(reason)
        return
      }
      if (message.kind === 'stderr' && typeof message.text === 'string') {
        problem(message.text)
        return
      }
      if (message.kind === 'tree') {
        tree(typeof message.column === 'number' ? message.column : undefined)
        return
      }
      if (message.kind === 'exit') {
        ended = true
        exit({ code: typeof message.code === 'number' ? message.code : null })
      }
    })
    socket.on('close', () => {
      if (mine !== generation) return
      ready = false
      if (closedByUs || ended) {
        settled?.reject(new Error('the editor connection closed'))
        settled = undefined
        if (!ended) exit({ code: null })
        return
      }
      retry()
    })
    socket.on('error', error => {
      if (mine !== generation) return
      settled?.reject(error instanceof Error ? error : new Error(String(error)))
      settled = undefined
    })
  }

  /**
   * Try to reach the editor the Host is keeping for us.
   *
   * A dropped socket is usually a dropped tunnel or a restarted client, not a
   * dead editor: the Host keeps the process for a grace window, so reconnecting
   * with the same id attaches to the buffers the user was writing.
   */
  const retry = (): void => {
    attempts += 1
    if (attempts > maxAttempts) {
      ended = true
      exit({ code: null })
      return
    }
    const delay = firstDelayMs * 2 ** (attempts - 1)
    const timer = setTimeout(() => {
      if (closedByUs) return
      connect()
    }, delay)
    timer.unref?.()
  }

  /** Send what was written before the Host said `ready`. */
  const flush = (): void => {
    for (const chunk of queued.splice(0)) socket.send(chunk, { binary: true })
  }

  /**
   * Send the open request once the socket can carry it.
   *
   * Every new socket needs one, and a reconnect must send the same identity: the
   * Host looks the editor up by it, which is what makes the reconnect attach to
   * the buffers instead of starting a new editor.
   */
  const flushRequests = (): void => {
    const next = request ?? lastRequest
    if (next === undefined) return
    socket.send(JSON.stringify({ kind: 'open', ...next }))
    lastRequest = next
    request = undefined
  }

  connect()

  return {
    open(next) {
      request = next
      if (socket.readyState === socket.OPEN) flushRequests()
      return new Promise((resolve, reject) => {
        settled = { resolve, reject }
        if (ready) {
          settled = undefined
          resolve()
        }
      })
    },
    onData(handler) { data = handler },
    onProblem(handler) { problem = handler },
    onTree(handler) { tree = handler },
    onExit(handler) { exit = handler },
    onReconnect(handler) { reconnected = handler },
    send(chunk) {
      if (ready) socket.send(chunk, { binary: true })
      else queued.push(chunk)
    },
    close() {
      closedByUs = true
      ended = true
      socket.close()
    },
  }
}
