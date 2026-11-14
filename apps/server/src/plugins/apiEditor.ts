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
import { readFileSync, rmSync, statSync, watch } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
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
  /**
   * The client's identity for this editor.
   *
   * A window that loses its socket reconnects with the same id, and the Host
   * hands back the Neovim it never killed — the buffers are the user's work, so
   * a dropped connection must not be a lost edit.
   */
  readonly id?: string
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
  const id = record.id
  if (id !== undefined && (typeof id !== 'string' || id === '' || id.length > 128)) return undefined
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) return undefined
  if (typeof cols !== 'number' || !Number.isInteger(cols) || cols < 1 || cols > MAX_COLS) return undefined
  if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < 1 || rows > MAX_ROWS) return undefined
  if (theme === null || typeof theme !== 'object') return undefined
  try {
    if (!statSync(cwd).isDirectory()) return undefined
  } catch {
    return undefined
  }
  return { kind: 'open', ...(id === undefined ? {} : { id }), cwd, cols, rows, theme: theme as EditorTheme }
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
/** One Neovim the Host owns, and the socket currently watching it. */
export interface EditorCamp {
  /** The client's identity, or one the Host minted for a client that sent none. */
  readonly id: string
  /** The tree-boundary file the vendored explorer writes. */
  readonly treeFile: string
  /** The executable reported to the client, known once it spawned. */
  readonly command: string
  child: ChildProcessWithoutNullStreams
  /** The socket attached right now, if any. */
  socket?: WebSocket
  /** Set while no socket is attached; when it fires the editor is killed. */
  detachTimer?: ReturnType<typeof setTimeout>
  /** Stop watching the tree file. */
  stopWatching?: () => void
}

/** How one editor process is started; injected so tests need no Neovim. */
export type EditorSpawner = (options: {
  command: string
  cwd: string
  environment: NodeJS.ProcessEnv
}) => ChildProcessWithoutNullStreams

/**
 * How long a Neovim outlives the socket that opened it.
 *
 * Long enough for a client to notice a dropped connection and reconnect, short
 * enough that a window closed for good does not leave an editor running.
 */
export const DETACH_GRACE_MS = 20_000

/** End one editor: stop watching, stop the process, remove its tree file. */
export function killCamp(camp: EditorCamp): void {
  if (camp.detachTimer !== undefined) clearTimeout(camp.detachTimer)
  camp.detachTimer = undefined
  camp.stopWatching?.()
  camp.stopWatching = undefined
  camp.socket = undefined
  camp.child.kill('SIGTERM')
  rmSync(camp.treeFile, { force: true })
}

/**
 * Report the tree boundary when it changes.
 *
 * The vendored explorer writes the boundary into a file and only when it moves,
 * so watching the directory is the event: polling it would spend a read per
 * editor per interval to learn that nothing happened. The directory is watched
 * rather than the file because the file is created by the first report.
 */
function watchTree(camp: EditorCamp, onColumn: (column: number) => void): () => void {
  let column: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const read = (): void => {
    timer = undefined
    let text: string
    try {
      text = readFileSync(camp.treeFile, 'utf8')
    } catch {
      return
    }
    const [left, width] = text.trim().split(' ').map(Number)
    if (left === undefined || width === undefined || !Number.isFinite(left) || !Number.isFinite(width)) return
    const next = left + width
    if (next === column) return
    column = next
    onColumn(next)
  }
  let watcher: ReturnType<typeof watch> | undefined
  try {
    watcher = watch(dirname(camp.treeFile), { persistent: false }, (_event, filename) => {
      if (filename !== null && filename !== basename(camp.treeFile)) return
      // A write is several events; one read after they settle is enough.
      if (timer !== undefined) return
      timer = setTimeout(read, 25)
    })
    watcher.unref?.()
  } catch {
    // A host without inotify-style watching still works: the first pointer move
    // over the divider asks again, and the reader below is cheap.
  }
  return () => {
    if (timer !== undefined) clearTimeout(timer)
    watcher?.close()
  }
}

/**
 * Own one editor process for as long as the client keeps coming back.
 *
 * The first `open` spawns Neovim; a later `open` with the same id attaches to it
 * instead — a dropped socket is usually a reconnect, and the buffers are the
 * user's work. The process outlives the socket by {@link DETACH_GRACE_MS} and is
 * killed when no one came back, or when the plugin is disposed.
 */
export function serveOne(options: {
  socket: WebSocket
  home: ReturnType<typeof resolveEditorHome>
  /** Every live editor, so disposing the plugin ends them, keyed by identity. */
  live: Map<string, EditorCamp>
  /** How long an editor outlives its socket; tests pass a short window. */
  graceMs?: number
  /** Starts Neovim; injected for tests. */
  spawnEditor?: EditorSpawner
  /** Publishes the editor and builds its environment; injected for tests. */
  prepareEditor?: (open: EditorOpen, treeFile: string) => { command: string; environment: NodeJS.ProcessEnv }
}): void {
  const { socket, home, live } = options
  const graceMs = options.graceMs ?? DETACH_GRACE_MS
  // `.` is the directory, the same argument the pty editor passed: the vendored
  // explorer turns it into the file tree on the first paint.
  const spawnEditor: EditorSpawner = options.spawnEditor ?? (spawnOptions => spawn(
    spawnOptions.command,
    ['--embed', '.'],
    { cwd: spawnOptions.cwd, env: spawnOptions.environment, stdio: ['pipe', 'pipe', 'pipe'] },
  ))
  let opened = false
  let closed = false
  let camp: EditorCamp | undefined

  /** Stop watching this socket: the editor stays, on a timer. */
  const detach = (): void => {
    if (closed) return
    closed = true
    if (camp === undefined) return
    const leaving = camp
    camp = undefined
    if (leaving.socket !== socket) return
    leaving.socket = undefined
    leaving.stopWatching?.()
    leaving.stopWatching = undefined
    leaving.detachTimer = setTimeout(() => {
      if (leaving.socket !== undefined) return
      live.delete(leaving.id)
      killCamp(leaving)
    }, graceMs)
    leaving.detachTimer.unref?.()
  }

  /** Attach this socket to one camp: its output, its tree reports, its exit. */
  const attach = (target: EditorCamp, resumed: boolean): void => {
    camp = target
    target.socket = socket
    if (target.detachTimer !== undefined) clearTimeout(target.detachTimer)
    target.detachTimer = undefined
    target.stopWatching?.()
    target.stopWatching = watchTree(target, column => {
      if (target.socket === socket && socket.readyState === socket.OPEN) sendJson(socket, { kind: 'tree', column })
    })
    sendJson(socket, { kind: 'ready', command: target.command, ...(resumed ? { resumed: true } : {}) })
  }

  socket.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
    // Binary frames are channel chunks and only make sense once Neovim is up.
    if (isBinary) {
      const chunk = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
      camp?.child.stdin.write(chunk)
      return
    }
    if (opened) return
    const text = (Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)).toString('utf8')
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
    const id = open.id ?? crypto.randomUUID()
    const existing = live.get(id)
    if (existing !== undefined && existing.child.exitCode === null && !existing.child.killed) {
      attach(existing, true)
      return
    }
    const treeFile = join(home.dataHome, `tree-${crypto.randomUUID()}.txt`)
    try {
      const prepare = options.prepareEditor ?? (request => {
        publishEditor(home)
        ensureEditorConfig(home)
        // Re-resolve after publishing: `plugin`, `runtime` and `parsers` are paths
        // that did not exist when this state root was first read, so a fresh
        // install would otherwise start Neovim without its vendored plugins — a
        // netrw tree instead of the explorer, and no pickers.
        const resolved = resolveEditorHome(home.dataRoot)
        return {
          command: resolved.command,
          environment: editorEnvironment(resolved, request.theme, ripgrepPathEntry(resolved.binHome)),
        }
      })
      const prepared = prepare(open, treeFile)
      // The tree boundary is a fact only Neovim has, so it reports it into this
      // file and the Host forwards it; the client never touches the Host's disk.
      const environment = { ...process.env, ...prepared.environment, HULALA_NVIM_TREE_FILE: treeFile }
      const started = spawnEditor({ command: prepared.command, cwd: open.cwd, environment })
      const minted: EditorCamp = { id, treeFile, command: prepared.command, child: started }
      live.set(id, minted)
      started.on('exit', (code, signal) => {
        live.delete(id)
        if (minted.socket !== undefined && minted.socket.readyState === minted.socket.OPEN) {
          sendJson(minted.socket, { kind: 'exit', code, signal })
        }
        killCamp(minted)
      })
      started.on('error', error => {
        if (minted.socket !== undefined) sendJson(minted.socket, { kind: 'error', message: error.message })
      })
      // Neovim's diagnostics must not enter the channel: a stray line would be
      // parsed as msgpack and corrupt the grid. They travel as a control frame —
      // a diagnostic, not an ending: the exit frame says the editor is gone.
      started.stderr.on('data', (chunk: Buffer) => {
        if (minted.socket !== undefined) sendJson(minted.socket, { kind: 'stderr', text: chunk.toString('utf8') })
      })
      // One reader for the camp, not one per socket: a reconnect must not add a
      // second copy of every frame.
      started.stdout.on('data', (chunk: Buffer) => {
        if (minted.socket !== undefined && minted.socket.readyState === minted.socket.OPEN) {
          minted.socket.send(chunk, { binary: true })
        }
      })
      attach(minted, false)
    } catch (error) {
      sendJson(socket, { kind: 'error', message: error instanceof Error ? error.message : String(error) })
      socket.close()
    }
  })

  socket.on('close', detach)
  socket.on('error', detach)
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
    const live = new Map<string, EditorCamp>()

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
        for (const camp of live.values()) killCamp(camp)
        live.clear()
        sockets.close()
      },
      'hulala-api-editor: processes',
    )
  },
}
