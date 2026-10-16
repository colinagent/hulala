import { afterEach, expect, test } from 'bun:test'
import { Context } from '@deepseek-ai/cordis'
import { LocalAttachmentStore } from '@deepseek-ai/dsh-attachment-local'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConversationUploads } from '../src/conversationUploads'
import { HarnessApiAdapter } from '../src/runtime'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=', 'base64')
function request(data = png, type = 'image/png', length = data.length) { return new Request('http://localhost/upload?name=image.png', { method: 'PUT', headers: { 'content-type': type, 'content-length': String(length) }, body: data }) }
test('streamed images remain session-bound and readable after Host restart, while prompt RPCs use native image admission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-image-test-'))
  roots.push(root)
  const attachments = new LocalAttachmentStore(new Context(), { dshHome: join(root, 'native') })
  const service = new ConversationUploads(join(root, 'uploads'), attachments)
  const id = crypto.randomUUID()
  const first = await service.upload('one', id, request())
  expect(first.image.width).toBe(1)
  expect(await service.upload('one', id, request())).toEqual(first)
  await expect(service.read('two', id)).rejects.toMatchObject({ status: 403 })
  await expect(service.upload('two', id, request())).rejects.toMatchObject({ status: 403 })
  const restarted = new ConversationUploads(join(root, 'uploads'), attachments)
  const response = await restarted.image('one', id)
  expect(response.headers.get('content-type')).toBe('image/png')
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(png))
  let delivered: any
  const adapter = new HarnessApiAdapter({ conversationUploads: restarted, typertGateway: { invoke: async (value: unknown) => { delivered = value; return { accepted: true } } } as never })
  const requestId = crypto.randomUUID()
  await adapter.prompt('one', { requestId, mode: 'queue', content: [{ type: 'image', uploadId: id, mediaType: 'image/png' }] })
  expect(delivered.args.request).toMatchObject({ requestId, content: [{ type: 'image', data: png.toString('base64') }] })
  await restarted.discard('one', id)
  await expect(restarted.read('one', id)).rejects.toMatchObject({ status: 404 })
  // Discarding the browser receipt cannot remove a native object used by a message.
  expect((await attachments.readImage({ ...first.image, attachmentId: first.image.attachmentId as never })).data.length).toBe(png.length)
})
test('invalid media and incomplete transfers leave no upload receipt or intake directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-image-test-'))
  roots.push(root)
  const service = new ConversationUploads(join(root, 'uploads'), new LocalAttachmentStore(new Context(), { dshHome: join(root, 'native') }))
  await expect(service.upload('one', crypto.randomUUID(), request(png, 'image/svg+xml'))).rejects.toMatchObject({ status: 415 })
  await expect(service.upload('one', crypto.randomUUID(), request(png, 'image/png', png.length + 1))).rejects.toMatchObject({ status: 400 })
  expect(await readdir(join(root, 'uploads'))).toEqual([])
})
