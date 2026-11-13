/**
 * `hulala-api-editor` — the editor column's Neovim, owned by the Host.
 *
 * The column is a UI, not a terminal: the Host starts `nvim --embed` in the
 * Session's directory and pumps the msgpack channel over one authenticated
 * WebSocket, so the client draws Neovim's grid and sends it key notation instead
 * of owning a pty. That is what lets the same code run against a Host reached
 * over SSH, and why the editor's runtime, plugins and config live in the state
 * root on this machine rather than next to the client.
 *
 * The protocol is deliberately thin: the first client frame is a JSON `open`,
 * the Host answers with a JSON `ready` or `error`, and every frame after that is
 * a raw channel chunk in either direction. Neovim's own protocol owns everything
 * above that, so a new UI feature needs no change here.
 *
 * @module hulala-server/api-editor
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync, rmSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import {
  editorEnvironment,
  ensureEditorConfig,
  publishEditor,
  resolveEditorHome,
  ripgrepPathEntry,
  type EditorTheme,
} from '@hulala/editor-home'

/** Largest grid the editor may open with; matches the terminal column's ceiling. */
const MAX_COLS = 500
const MAX_ROWS = 200

/** One `open` request: where to edit, how big, and which colours to paint. */
interface EditorOpen {
  readonly kind: 'open'
  readonly cwd: string
  readonly cols: number
  readonly rows: number
  readonly theme: EditorTheme
}

/**
 * Parse and validate one client frame as an `open` request.
 *
 * Everything here is a bound the Host refuses to guess: an absolute existing
 * directory, a grid inside the terminal column's own limits, and a theme object.
 * @param value - the first frame's decoded JSON.
 * @returns the request, or undefined when it is not one the Host will run.
 */
export function parseEditorOpen(value: unknown): EditorOpen | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (record.kind !== 'open') return undefined
  const { cwd, cols, rows, theme } = record
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) return undefined
  if (typeof cols !== 'number' || !Number.isInteger(cols) || cols < 1 || cols > MAX_COLS) return undefined
  if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < 1 || rows > MAX_ROWS) return undefined
  if (theme === null || typeof theme !== 'object') return undefined
  try {
    if (!statSync(cwd).isDirectory()) return undefined
  } catch {
    return undefined
  }
  return { kind: 'open', cwd, cols, rows, theme: theme as EditorTheme }
}

/** Write one JSON control frame. */
function sendJson(socket: WebSocket, value: unknown): void {
  if (socket.readyState !== socket.OPEN) return
  socket.send(JSON.stringify(value))
}

/**
 * Own one editor process for one socket.
 *
 * A socket that goes away takes its Neovim with it: the column owns the process
 * lifetime, and a Host that kept editors alive for windows that no longer exist
 * would accumulate them the way detached shells do.
 */
function serveOne(options: {
  socket: WebSocket
  home: ReturnType<typeof resolveEditorHome>
  /** Every live editor, so disposing the plugin ends them. */
  live: Set<ChildProcessWithoutNullStreams>
}): void {
  const { socket, home, live } = options
  let child: ChildProcessWithoutNullStreams | undefined
  let opened = false
  let closed = false

  /** Neovim's own report of where its file tree ends, polled while it runs. */
  let treeFile: string | undefined
  let treeTimer: ReturnType<typeof setInterval> | undefined
  let treeColumn: number | undefined

  const terminate = (): void => {
    if (closed) return
    closed = true
    if (treeTimer !== undefined) clearInterval(treeTimer)
    treeTimer = undefined
    child?.kill('SIGTERM')
    child = undefined
    if (treeFile !== undefined) rmSync(treeFile, { force: true })
  }

  socket.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
    // Binary frames are channel chunks and only make sense once Neovim is up.
    if (isBinary) {
      const chunk = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
      child?.stdin.write(chunk)
      return
    }
    const text = (Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)).toString('utf8')
    if (opened) return
    let request: unknown
    try {
      request = JSON.parse(text)
    } catch {
      sendJson(socket, { kind: 'error', message: 'the editor request is not JSON' })
      socket.close()
      return
    }
    const open = parseEditorOpen(request)
    if (open === undefined) {
      sendJson(socket, { kind: 'error', message: 'the editor request needs an absolute cwd, a size and a theme' })
      socket.close()
      return
    }
    opened = true
    try {
      publishEditor(home)
      ensureEditorConfig(home)
      // The editor's pickers run the shipped `rg`, published beside it.
      const ripgrep = ripgrepPathEntry(home.binHome)
      const environment = editorEnvironment(home, open.theme, ripgrep)
      // The tree boundary is a fact only Neovim has, so it reports it into this
      // file and the Host forwards it; the client never touches the Host's disk.
      treeFile = join(home.dataHome, `tree-${crypto.randomUUID()}.txt`)
      environment.HULALA_NVIM_TREE_FILE = treeFile
      // `.` is the directory, the same argument the pty editor passed: the
      // vendored explorer turns it into the file tree on the first paint.
      child = spawn(home.command, ['--embed', '.'], {
        cwd: open.cwd,
        env: { ...process.env, ...environment },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      sendJson(socket, { kind: 'error', message: error instanceof Error ? error.message : String(error) })
      socket.close()
      return
    }
    const started = child
    live.add(started)
    started.on('exit', () => { live.delete(started) })
    // Half a second is the pace the client used to poll at, and it costs one
    // integer read per editor; a resize is not a keystroke.
    treeTimer = setInterval(() => {
      if (treeFile === undefined) return
      let text: string
      try {
        text = readFileSync(treeFile, 'utf8')
      } catch {
        return
      }
      const [left, width] = text.trim().split(' ').map(Number)
      if (left === undefined || width === undefined || !Number.isFinite(left) || !Number.isFinite(width)) return
      const column = left + width
      if (column === treeColumn) return
      treeColumn = column
      sendJson(socket, { kind: 'tree', column })
    }, 500)
    sendJson(socket, { kind: 'ready', command: home.command })
    started.stdout.on('data', (chunk: Buffer) => {
      if (socket.readyState === socket.OPEN) socket.send(chunk, { binary: true })
    })
    // Neovim writes diagnostics here, and they must not enter the channel: a
    // stray line would be parsed as msgpack and corrupt the grid. They travel as
    // a control frame, so a broken init.lua is visible instead of blank.
    started.stderr.on('data', (chunk: Buffer) => {
      sendJson(socket, { kind: 'stderr', text: chunk.toString('utf8') })
    })
    started.on('error', error => sendJson(socket, { kind: 'error', message: error.message }))
    started.on('exit', (code, signal) => {
      sendJson(socket, { kind: 'exit', code, signal })
      socket.close()
    })
  })

  socket.on('close', terminate)
  socket.on('error', terminate)
}

/** Stable Cordis plugin name. */
export const name = 'hulala-api-editor'

/** Cordis plugin object loaded by the Host assembly. */
export const apiEditorPlugin = {
  name,
  inject: ['webServer', 'connection', 'hulalaHost'],
  apply(ctx: Context): void {
    const webServer = ctx.get('webServer') as WebServer
    const connection = ctx.get('connection') as HostConnectionService
    const dataRoot = ctx.hulalaHost.paths.root
    const home = resolveEditorHome(dataRoot)
    const sockets = new WebSocketServer({ noServer: true })
    /** Live editors, so disposing the plugin ends every one of them. */
    const live = new Set<ChildProcessWithoutNullStreams>()

    ctx.effect(
      () => webServer.registerUpgrade({
        path: '/api/editor',
        handler: (request: IncomingMessage, socket: Duplex, head: Buffer) => {
          // The trust fence with the cookie check, but **not** `admitConnection`:
          // that one claims the single API socket seat the mux owns, so a second
          // upgrade is refused with "Expected 101". This route needs the same
          // authentication and none of the socket ownership.
          const rejection = connection.requestRejection({ headers: request.headers })
          if (rejection !== undefined) {
            socket.write(`HTTP/1.1 ${String(rejection)} Unauthorized\r\nconnection: close\r\n\r\n`)
            socket.destroy()
            return
          }
          sockets.handleUpgrade(request, socket, head, ws => {
            serveOne({ socket: ws, home, live })
          })
        },
      }),
      'hulala-api-editor: channel',
    )

    ctx.effect(
      () => () => {
        for (const child of live) child.kill('SIGTERM')
        live.clear()
        sockets.close()
      },
      'hulala-api-editor: processes',
    )
  },
}
