/**
 * `hulala-api-paste` — one authenticated route that puts clipboard bytes on the
 * Host's machine, in its temp directory, and answers with the absolute path.
 *
 * A paste is a file the model has to be able to open, and the model's tools run
 * on the Host — not on the machine whose clipboard was read. On the user's own
 * machine those are the same filesystem; behind `hulala ssh`, they are not, and a
 * path from the client's `/var/folders/...` names nothing on the far side. So the
 * client sends the bytes here, the Host writes them into its own system temp
 * directory and the client inserts the path it gets back — pi's local temp file,
 * on the machine that can actually open it. A paste is ephemeral by nature, so
 * it goes where the operating system reclaims files on its own schedule and
 * never into the state root, which is kept.
 *
 * The route is registered beside the editor channel and carries the same fence:
 * loopback, the Host's Host/Origin checks and the connection cookie
 * (`connection.requestRejection`). It accepts one bounded JSON body and writes
 * one owner-only file into the temp directory; nothing here can name a path of
 * its own, so a paste can never write outside it.
 *
 * @module hulala-server/api-paste
 */
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'

/** Largest decoded file one paste may carry; the client refuses the same size earlier. */
export const MAX_PASTE_BYTES = 10 * 1024 * 1024

/** Extension per media type the prompt protocol accepts. */
const MEDIA_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/**
 * Subdirectory of the system temp directory pastes are written to.
 *
 * One directory instead of loose files, so a user can find or clear them; the
 * OS still reclaims it on its own schedule (macOS empties `$TMPDIR`, Linux
 * cleans `/tmp` on reboot), which is the point: a screenshot pasted today is
 * not state anyone promised to keep.
 */
export const PASTE_DIRECTORY = 'hulala-pastes'

/** A base64 body is four thirds of the bytes plus padding; this bounds the read. */
const MAX_BODY_BYTES = Math.ceil(MAX_PASTE_BYTES / 3) * 4 + 4096

/** One accepted paste, already decoded and named. */
export interface PastePayload {
  /** The file's bytes, byte-for-byte as the client held them. */
  readonly bytes: Uint8Array
  /** Extension the file is stored under, without the dot. */
  readonly extension: string
  /** Display name the client sent, when it had one. */
  readonly name?: string
}

/**
 * Sanitize one client-supplied name.
 *
 * The name is only ever a leaf inside the paste directory: separators, control
 * characters and a leading dot are dropped rather than escaped, so a name can
 * never describe a different directory.
 * @param value - the request's optional `name`.
 * @returns a safe leaf name, or undefined when nothing usable is left.
 */
function safeName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const leaf = basename(value).replace(/[^A-Za-z0-9._-]/gu, '_').replace(/^\.+/u, '')
  if (leaf === '' || leaf.length > 120) return undefined
  return leaf
}

/**
 * Extension one payload is stored under.
 * @param name - sanitized display name, when there is one.
 * @param mediaType - declared media type, when there is one.
 * @returns a lowercase extension without the dot.
 */
function extensionOf(name: string | undefined, mediaType: unknown): string {
  const declared = typeof mediaType === 'string' ? MEDIA_EXTENSIONS[mediaType.toLowerCase()] : undefined
  if (declared !== undefined) return declared
  const fromName = name?.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : undefined
  if (fromName !== undefined && /^[a-z0-9]{1,8}$/u.test(fromName)) return fromName
  return 'bin'
}

/**
 * Validate and decode one paste request.
 *
 * The body is JSON `{ name?, mediaType?, data }` where `data` is canonical
 * base64. Canonical is checked before decoding, because `Buffer.from` accepts
 * almost anything and a truncated payload that decoded to something plausible
 * would become a file the model cannot open.
 * @param value - the parsed JSON body.
 * @returns the decoded payload, or undefined when the request is not one.
 */
export function parsePaste(value: unknown): PastePayload | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const { data } = record
  if (typeof data !== 'string' || data.length === 0 || data.length % 4 !== 0) return undefined
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(data)) return undefined
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length === 0 || bytes.length > MAX_PASTE_BYTES) return undefined
  const name = safeName(record.name)
  return {
    bytes,
    extension: extensionOf(name, record.mediaType),
    ...(name === undefined ? {} : { name }),
  }
}

/**
 * The path one paste is stored under.
 *
 * The stamp and the random suffix make a collision impossible in practice and
 * keep the directory sorted by time. A copied file keeps its own name at the
 * end, so the path a user sees in the draft is one they recognise; a screenshot
 * has no name, so it gets the media type's extension instead.
 * @param directory - the paste directory to write into.
 * @param payload - the decoded paste.
 * @param options - clock and random suffix, injected for tests.
 * @returns absolute path of the file to write.
 */
export function pastePath(
  directory: string,
  payload: PastePayload,
  options: { readonly now?: Date; readonly random?: string } = {},
): string {
  const now = options.now ?? new Date()
  const stamp = now.toISOString().replace(/[-:]/gu, '').replace(/\..*$/u, '').replace('T', '-')
  const random = options.random ?? crypto.randomUUID().replace(/-/gu, '').slice(0, 8)
  const leaf = payload.name === undefined
    ? `${stamp}-${random}.${payload.extension}`
    : `${stamp}-${random}-${payload.name}`
  return join(directory, `paste-${leaf}`)
}

/**
 * Write one paste into the state root, owner-only and atomically.
 * @param directory - the paste directory to write into.
 * @param payload - the decoded paste.
 * @param options - clock and random suffix, injected for tests.
 * @returns absolute path of the written file.
 */
export async function writePaste(
  directory: string,
  payload: PastePayload,
  options: { readonly now?: Date; readonly random?: string } = {},
): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const path = pastePath(directory, payload, options)
  const staging = join(directory, `.${crypto.randomUUID()}.tmp`)
  try {
    await writeFile(staging, payload.bytes, { mode: 0o600 })
    await rename(staging, path)
  } catch (error) {
    await rm(staging, { force: true }).catch(() => undefined)
    throw error
  }
  return path
}

/**
 * Read one request body, bounded.
 * @param request - the incoming request.
 * @param limit - largest body accepted.
 * @returns the body text, or undefined when it is too large.
 */
async function readBody(request: IncomingMessage, limit: number): Promise<string | undefined> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    total += bytes.length
    if (total > limit) return undefined
    chunks.push(bytes)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Answer one request with JSON. */
function respond(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

/** Stable Cordis plugin name. */
export const name = 'hulala-api-paste'

/** Cordis plugin object loaded by the Host assembly. */
export const apiPastePlugin = {
  name,
  inject: ['webServer', 'connection'],
  apply(ctx: Context): void {
    const webServer = ctx.get('webServer') as WebServer
    const connection = ctx.get('connection') as HostConnectionService
    // Resolved once, from this process's environment: the daemon that owns the
    // agent's tools decides where its own temp files live.
    const directory = join(tmpdir(), PASTE_DIRECTORY)

    ctx.effect(
      () => webServer.register({
        kind: 'exact',
        path: '/api/paste',
        handler: async (request, response) => {
          const rejection = connection.requestRejection({ headers: request.headers })
          if (rejection !== undefined) {
            response.writeHead(rejection, { 'content-type': 'text/plain' })
            response.end('Unauthorized')
            return
          }
          if (request.method !== 'POST') {
            respond(response, 405, { message: 'POST only' })
            return
          }
          const body = await readBody(request, MAX_BODY_BYTES).catch(() => undefined)
          if (body === undefined) {
            respond(response, 413, { message: 'paste is too large' })
            return
          }
          let value: unknown
          try {
            value = JSON.parse(body)
          } catch {
            respond(response, 400, { message: 'body is not JSON' })
            return
          }
          const payload = parsePaste(value)
          if (payload === undefined) {
            respond(response, 400, { message: 'body is not a paste' })
            return
          }
          try {
            respond(response, 200, { path: await writePaste(directory, payload) })
          } catch (error) {
            respond(response, 500, { message: error instanceof Error ? error.message : String(error) })
          }
        },
      }),
      'hulala-api-paste: route',
    )
  },
}
