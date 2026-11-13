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
}

/** Build the channel one editor column uses. */
export function createEditorChannel(options: EditorChannelOptions): EditorChannel {
  const socket = (options.socket ?? ((url, headers) => new WebSocket(url, { headers })))(
    `${options.baseUrl.replace(/^http/u, 'ws')}/api/editor`,
    { cookie: options.cookie, origin: options.baseUrl },
  )
  let data: (chunk: Uint8Array) => void = () => undefined
  let problem: (text: string) => void = () => undefined
  let exit: (event: { code: number | null }) => void = () => undefined
  let tree: (column: number | undefined) => void = () => undefined
  let ready = false
  const queued: Uint8Array[] = []
  let settled: { resolve: () => void; reject: (error: Error) => void } | undefined

  const flush = (): void => {
    for (const chunk of queued.splice(0)) socket.send(chunk, { binary: true })
  }

  socket.on('open', () => {
    // The request is sent by `open()`, which the caller may have called already.
    flushRequests()
  })

  let request: EditorOpenRequest | undefined
  const flushRequests = (): void => {
    if (request === undefined) return
    socket.send(JSON.stringify({ kind: 'open', ...request }))
    request = undefined
  }

  socket.on('message', (payload: Buffer, isBinary: boolean) => {
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
      ready = true
      settled?.resolve()
      settled = undefined
      flush()
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
      exit({ code: typeof message.code === 'number' ? message.code : null })
    }
  })
  socket.on('close', () => {
    settled?.reject(new Error('the editor connection closed'))
    settled = undefined
    exit({ code: null })
  })
  socket.on('error', error => {
    settled?.reject(error instanceof Error ? error : new Error(String(error)))
    settled = undefined
  })

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
    send(chunk) {
      if (ready) socket.send(chunk, { binary: true })
      else queued.push(chunk)
    },
    close() {
      socket.close()
    },
  }
}
