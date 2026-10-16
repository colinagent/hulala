import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { AttachmentId, isImageAdmissionError, type AttachmentStore, type ImageAttachmentRef, type ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { z } from 'zod'
import { HttpError } from './http'
import { writeJsonFileAtomic } from './shared/jsonFile'

const mediaType = z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const recordSchema = z.object({ sessionId: z.string().min(1), uploadId: z.string().uuid(), createdAt: z.number(), image: z.object({ attachmentId: z.string().min(1), mediaType, width: z.number().int().positive(), height: z.number().int().positive(), bytes: z.number().int().positive(), name: z.string().optional() }) })
type UploadRecord = z.infer<typeof recordSchema>

/** Browser bytes are streamed, then validated and owned by Harness's attachment store. */
export class ConversationUploads {
  private readonly active = new Map<string, { sessionId: string; promise: Promise<UploadRecord> }>()
  constructor(private readonly root: string, private readonly attachments?: AttachmentStore) {}
  private native(): AttachmentStore {
    if (!this.attachments) throw new HttpError(503, 'attachments_unavailable', 'Harness attachment storage is unavailable')
    return this.attachments
  }
  private path(id: string): string {
    if (!z.string().uuid().safeParse(id).success) throw new HttpError(400, 'upload_invalid', 'Invalid image upload identity')
    return join(this.root, id + '.json')
  }
  async read(sessionId: string, id: string): Promise<UploadRecord> {
    const file = Bun.file(this.path(id))
    if (!await file.exists()) throw new HttpError(404, 'upload_not_found', 'This image is no longer staged. Attach it again.')
    const record = recordSchema.parse(await file.json())
    if (record.sessionId !== sessionId) throw new HttpError(403, 'upload_forbidden', 'This image belongs to another conversation')
    return record
  }
  async upload(sessionId: string, id: string, request: Request): Promise<UploadRecord> {
    this.path(id)
    const pending = this.active.get(id)
    if (pending) {
      if (pending.sessionId !== sessionId) throw new HttpError(403, 'upload_forbidden', 'This image belongs to another conversation')
      await request.body?.cancel()
      return pending.promise
    }
    if (this.active.size >= 4) throw new HttpError(429, 'upload_busy', 'Wait for another image upload to finish')
    const promise = this.receive(sessionId, id, request)
    this.active.set(id, { sessionId, promise })
    try { return await promise } finally { this.active.delete(id) }
  }
  private async receive(sessionId: string, id: string, request: Request): Promise<UploadRecord> {
    const existing = await this.read(sessionId, id).catch(error => { if (error instanceof HttpError && error.status === 404) return undefined; throw error })
    if (existing) { await request.body?.cancel(); return existing }
    const type = mediaType.safeParse(request.headers.get('content-type')?.split(';')[0])
    if (!type.success) throw new HttpError(415, 'image_type_invalid', 'Use PNG, JPEG, WebP, or GIF images')
    const native = this.native()
    const limit = Math.min(native.imageLimits.maxImageBytes, 20 * 1024 * 1024)
    const length = Number(request.headers.get('content-length'))
    if (!request.body || !Number.isSafeInteger(length) || length <= 0 || length > limit) throw new HttpError(413, 'image_too_large', `Each image must be non-empty and at most ${Math.floor(limit / 1024 / 1024)} MiB`)
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    const temporary = await mkdtemp(join(this.root, 'intake-'))
    const path = join(temporary, 'image')
    try {
      let received = 0
      await pipeline(Readable.fromWeb(request.body as unknown as NodeReadableStream), new Transform({ transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        callback(received > length ? new HttpError(413, 'image_too_large', 'Image exceeds its declared length') : null, chunk)
      } }), createWriteStream(path, { flags: 'wx', mode: 0o600 }))
      if (received !== length) throw new HttpError(400, 'upload_incomplete', 'Image upload was interrupted')
      request.signal.throwIfAborted()
      const name = new URL(request.url).searchParams.get('name')?.slice(0, 1024)
      const image = await native.saveImage({ data: new Uint8Array(await Bun.file(path).arrayBuffer()), mediaType: type.data, ...(name ? { name } : {}) }).catch(error => {
        if (isImageAdmissionError(error)) throw new HttpError(400, 'image_invalid', error.message)
        throw error
      })
      const record = recordSchema.parse({ sessionId, uploadId: id, createdAt: Date.now(), image })
      await writeJsonFileAtomic(this.path(id), record)
      return record
    } finally { await rm(temporary, { recursive: true, force: true }) }
  }
  async encoded(sessionId: string, id: string): Promise<{ mediaType: ImageMediaType; data: string; name?: string }> {
    const record = await this.read(sessionId, id)
    const stored = await this.native().readImage({ ...record.image, attachmentId: AttachmentId(record.image.attachmentId) })
    return { mediaType: stored.ref.mediaType, data: Buffer.from(stored.data).toString('base64'), name: stored.ref.name }
  }
  async image(sessionId: string, id: string): Promise<Response> {
    const record = await this.read(sessionId, id)
    const ref: ImageAttachmentRef = { ...record.image, attachmentId: AttachmentId(record.image.attachmentId) }
    const stored = await this.native().readImage(ref)
    const path = this.native().imageHostPath(stored.ref)
    return new Response(path ? Bun.file(path) : Uint8Array.from(stored.data), { headers: { 'content-type': stored.ref.mediaType, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'" } })
  }
  async discard(sessionId: string, id: string): Promise<void> {
    await this.read(sessionId, id)
    await rm(this.path(id), { force: true })
  }
}
