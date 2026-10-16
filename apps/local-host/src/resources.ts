import { mkdir, rm, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import type { HulalaPaths, Workspace } from '@hulala/workbench-contracts'
import { HttpError } from './http.ts'
import { WorkspaceFiles } from './files.ts'

interface ResourceHandle {
  path: string
  workspace: Workspace
  expiresAt: number
}

export interface ResourceHandleDescriptor {
  id: string
  name: string
  size: number
  expiresAt: string
}

interface Transfer {
  path: string
  expiresAt: number
}

export class ResourceService {
  private readonly resources = new Map<string, ResourceHandle>()
  private readonly transfers = new Map<string, Transfer>()

  constructor(private readonly paths: HulalaPaths, private readonly files: WorkspaceFiles) {}

  async pruneExpired(now = Date.now()): Promise<void> {
    for (const [id, handle] of this.resources) {
      if (handle.expiresAt < now) this.resources.delete(id)
    }
    for (const [id, transfer] of this.transfers) {
      if (transfer.expiresAt >= now) continue
      await this.discardTransfer(id)
    }
  }

  async close(): Promise<void> {
    this.resources.clear()
    await Promise.all([...this.transfers.keys()].map(id => this.discardTransfer(id)))
  }

  async createHandle(workspace: Workspace, requestedPath: string): Promise<ResourceHandleDescriptor> {
    const path = await this.files.resolve(workspace, requestedPath)
    const metadata = await stat(path)
    if (!metadata.isFile()) throw new HttpError(400, 'resource_invalid', 'resource must be a file')
    const id = crypto.randomUUID()
    const expiresAt = Date.now() + 10 * 60_000
    this.resources.set(id, { path, workspace, expiresAt })
    return { id, name: basename(path), size: metadata.size, expiresAt: new Date(expiresAt).toISOString() }
  }

  async openHandle(id: string): Promise<Bun.BunFile> {
    const handle = this.resources.get(id)
    if (!handle || handle.expiresAt < Date.now()) {
      this.resources.delete(id)
      throw new HttpError(404, 'resource_not_found', 'resource handle has expired or does not exist')
    }
    return Bun.file(await this.files.resolve(handle.workspace, handle.path))
  }

  async createTransfer(): Promise<{ id: string }> {
    const id = crypto.randomUUID()
    const path = join(this.paths.transfers, id, 'content')
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    this.transfers.set(id, { path, expiresAt: Date.now() + 60 * 60_000 })
    return { id }
  }

  async uploadTransfer(id: string, body: ReadableStream<Uint8Array> | null, contentLength: number): Promise<void> {
    const transfer = this.transfers.get(id)
    if (!transfer || transfer.expiresAt < Date.now()) throw new HttpError(404, 'transfer_not_found', 'transfer does not exist')
    if ((!body && contentLength !== 0) || !Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > 256 * 1024 * 1024) throw new HttpError(413, 'transfer_too_large', 'transfer is too large')
    try {
      let received = 0
      await pipeline(
        body ? Readable.fromWeb(body as unknown as NodeReadableStream) : Readable.from([]),
        new Transform({ transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length
          callback(received > contentLength ? new HttpError(413, 'transfer_too_large', 'transfer exceeds its declared length') : null, chunk)
        } }),
        createWriteStream(transfer.path, { mode: 0o600 }),
      )
      const metadata = await stat(transfer.path)
      if (metadata.size !== contentLength) throw new HttpError(400, 'transfer_incomplete', 'transfer length does not match content-length')
    } catch (error) {
      await this.discardTransfer(id)
      throw error
    }
  }

  async commitTransfer(id: string, workspace: Workspace, requestedPath: string, expectedVersion: string | null = null): Promise<ResourceHandleDescriptor> {
    const transfer = this.transfers.get(id)
    if (!transfer || transfer.expiresAt < Date.now()) throw new HttpError(404, 'transfer_not_found', 'transfer does not exist')
    await this.files.publishResource(workspace, requestedPath, transfer.path, expectedVersion)
    await rm(dirname(transfer.path), { recursive: true, force: true })
    this.transfers.delete(id)
    return this.createHandle(workspace, requestedPath)
  }

  async importResource(
    workspace: Workspace,
    requestedPath: string,
    body: ReadableStream<Uint8Array> | null,
    contentLength: number,
    expectedVersion: string | null = null,
  ): Promise<ResourceHandleDescriptor> {
    const transfer = await this.createTransfer()
    try {
      await this.uploadTransfer(transfer.id, body, contentLength)
      return await this.commitTransfer(transfer.id, workspace, requestedPath, expectedVersion)
    } catch (error) {
      await this.discardTransfer(transfer.id)
      throw error
    }
  }

  private async discardTransfer(id: string): Promise<void> {
    const transfer = this.transfers.get(id)
    this.transfers.delete(id)
    if (transfer) await rm(dirname(transfer.path), { recursive: true, force: true }).catch(() => undefined)
  }
}
