/**
 * `@hulala/api-files` — the file mutations DeepSeek Harness does not provide.
 *
 * Harness already owns reads, directory listings, metadata, content search and
 * change observations through `workspaceFiles` and `tool-fs-search`. This plugin
 * adds only the write side: text writes, directory creation, removal, rename and
 * copy.
 * Every path is resolved through `ctx.fs` and confined to the explicitly named
 * workspace root; reads stay on the Harness service so they keep its pagination
 * and sandbox policy.
 *
 * @module hulala-server/api-files
 */
import { cp, mkdir, rename, rm } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertRemoteCodecSpec, TypertRemoteParameterSpec } from '@deepseek-ai/dsh-typert-protocol'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import { z } from 'zod'

const MAX_TEXT_BYTES = 16 * 1024 * 1024

function badRequest(message: string): RemoteError<'gateway/bad-request'> {
  return new RemoteError('gateway/bad-request', message, {})
}

function internal(message: string, cause?: unknown): RemoteError<'gateway/internal'> {
  return new RemoteError('gateway/internal', cause instanceof Error ? cause.message : message, {}, cause === undefined ? undefined : { cause })
}

/** Host-side file mutation service exported as the `hulalaFiles` Remote namespace. */
export class HulalaFiles extends TypertRemoteService {
  static inject: string[] = ['fs']

  constructor(ctx: Context) {
    super(ctx, 'hulalaFiles')
  }

  private get fs(): FileSystem {
    return this.ctx.fs
  }

  /** Resolve one workspace root and require it to be a directory. */
  private async workspace(workspaceRoot: string, signal?: AbortSignal): Promise<{ target: FsTarget; path: string }> {
    if (workspaceRoot.trim().length === 0) throw badRequest('workspaceRoot is required')
    if (!isAbsolute(workspaceRoot)) throw badRequest('workspaceRoot must be absolute')
    const target = await this.fs.resolve(workspaceRoot, signal === undefined ? {} : { signal })
    const info = await this.fs.stat(target, signal)
    if (info === undefined) throw badRequest(`workspace root does not exist: ${workspaceRoot}`)
    if (info.type !== 'directory') throw badRequest(`workspace root is not a directory: ${workspaceRoot}`)
    return { target, path: this.fs.processPath(target) }
  }

  /** Resolve a workspace-relative or absolute path and confine it to the root. */
  private async confined(root: FsTarget, workspaceRoot: string, path: string, signal?: AbortSignal): Promise<{ target: FsTarget; path: string }> {
    if (path.includes('\0')) throw badRequest('path contains a null byte')
    if (path.trim().length === 0) throw badRequest('path is required')
    const target = await this.fs.resolve(path, { cwd: workspaceRoot, ...(signal === undefined ? {} : { signal }) })
    if (!this.fs.contains(root, target)) throw badRequest(`path is outside the workspace: ${path}`)
    return { target, path: this.fs.processPath(target) }
  }

  /** Resolve the workspace root and one confined target together. */
  private async locate(workspaceRoot: string, path: string, signal?: AbortSignal): Promise<{ root: FsTarget; rootPath: string; target: FsTarget; path: string }> {
    const { target: root, path: rootPath } = await this.workspace(workspaceRoot, signal)
    const confined = await this.confined(root, rootPath, path, signal)
    return { root, rootPath, ...confined }
  }

  /** Create or replace one UTF-8 text file inside the workspace. */
  @Remote
  async writeText(workspaceRoot: string, path: string, content: string, signal?: AbortSignal): Promise<{ path: string }> {
    if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES) throw badRequest('file is too large for text editing')
    const target = await this.locate(workspaceRoot, path, signal)
    if (target.path === target.rootPath) throw badRequest('workspace root cannot be overwritten')
    signal?.throwIfAborted()
    await mkdir(dirname(target.path), { recursive: true, mode: 0o700 })
    try {
      await this.fs.writeText(target.target, content, undefined, signal, {
        mode: 'workspace-write',
        workspaceRoot: target.rootPath,
      })
    } catch (error) {
      throw internal('text write failed', error)
    }
    return { path: target.path }
  }

  /** Create a directory, including missing parents, inside the workspace. */
  @Remote
  async mkdir(workspaceRoot: string, path: string, signal?: AbortSignal): Promise<{ path: string }> {
    const target = await this.locate(workspaceRoot, path, signal)
    signal?.throwIfAborted()
    await mkdir(target.path, { recursive: true, mode: 0o700 })
    return { path: target.path }
  }

  /** Remove one file or directory tree; the workspace root itself is protected. */
  @Remote
  async remove(workspaceRoot: string, path: string, signal?: AbortSignal): Promise<{ path: string }> {
    const target = await this.locate(workspaceRoot, path, signal)
    if (target.path === target.rootPath) throw badRequest('workspace root cannot be removed')
    signal?.throwIfAborted()
    await rm(target.path, { recursive: true, force: false })
    return { path: target.path }
  }

  /** Move or rename one entry inside the workspace. */
  @Remote
  async rename(workspaceRoot: string, from: string, to: string, signal?: AbortSignal): Promise<{ from: string; to: string }> {
    const source = await this.locate(workspaceRoot, from, signal)
    if (source.path === source.rootPath) throw badRequest('workspace root cannot be renamed')
    const destination = await this.confined(source.root, source.rootPath, to, signal)
    if (destination.path === source.rootPath) throw badRequest('workspace root cannot be replaced')
    signal?.throwIfAborted()
    await mkdir(dirname(destination.path), { recursive: true, mode: 0o700 })
    await rename(source.path, destination.path)
    return { from: source.path, to: destination.path }
  }

  /** Copy one file or directory tree to a new path inside the workspace. */
  @Remote
  async copy(workspaceRoot: string, from: string, to: string, signal?: AbortSignal): Promise<{ from: string; to: string }> {
    const source = await this.locate(workspaceRoot, from, signal)
    const destination = await this.confined(source.root, source.rootPath, to, signal)
    if (destination.path === source.rootPath) throw badRequest('workspace root cannot be replaced')
    signal?.throwIfAborted()
    await mkdir(dirname(destination.path), { recursive: true, mode: 0o700 })
    await cp(source.path, destination.path, { recursive: true, errorOnExist: true, verbatimSymlinks: true })
    return { from: source.path, to: destination.path }
  }
}

/** Build one strict wire codec so Remote dispatch never depends on parameter names. */
function codec(create: () => z.ZodType, jsonSchema: Record<string, unknown>): TypertRemoteCodecSpec {
  return { mode: 'strict', typeSymbol: 'hulala-api-files', create: create as unknown as TypertRemoteCodecSpec['create'], jsonSchema }
}

/** Build one JSON parameter; a missing wire field is absent, never coerced. */
function parameter(name: string, create: () => z.ZodType, jsonSchema: Record<string, unknown>): TypertRemoteParameterSpec {
  const value = codec(create, jsonSchema)
  return { name, source: 'json', codec: value, strictCodec: value }
}

const pathResult = codec(() => z.object({ path: z.string() }), {
  type: 'object',
  properties: { path: { type: 'string' } },
  required: ['path'],
  additionalProperties: false,
})

const filesRemote = createTypertRemoteInfo({
  package: '@hulala/api-files',
  methods: {
    'hulalaFiles/writeText': {
      service: 'hulalaFiles',
      invocation: { kind: 'direct' },
      parameters: [
        parameter('workspaceRoot', () => z.string(), { type: 'string' }),
        parameter('path', () => z.string(), { type: 'string' }),
        parameter('content', () => z.string(), { type: 'string' }),
      ],
      cancellation: { parameter: 'signal' },
      result: pathResult,
    },
    'hulalaFiles/mkdir': {
      service: 'hulalaFiles',
      invocation: { kind: 'direct' },
      parameters: [
        parameter('workspaceRoot', () => z.string(), { type: 'string' }),
        parameter('path', () => z.string(), { type: 'string' }),
      ],
      cancellation: { parameter: 'signal' },
      result: pathResult,
    },
    'hulalaFiles/remove': {
      service: 'hulalaFiles',
      invocation: { kind: 'direct' },
      parameters: [
        parameter('workspaceRoot', () => z.string(), { type: 'string' }),
        parameter('path', () => z.string(), { type: 'string' }),
      ],
      cancellation: { parameter: 'signal' },
      result: pathResult,
    },
    'hulalaFiles/rename': {
      service: 'hulalaFiles',
      invocation: { kind: 'direct' },
      parameters: [
        parameter('workspaceRoot', () => z.string(), { type: 'string' }),
        parameter('from', () => z.string(), { type: 'string' }),
        parameter('to', () => z.string(), { type: 'string' }),
      ],
      cancellation: { parameter: 'signal' },
      result: codec(() => z.object({ from: z.string(), to: z.string() }), {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'to'],
        additionalProperties: false,
      }),
    },
    'hulalaFiles/copy': {
      service: 'hulalaFiles',
      invocation: { kind: 'direct' },
      parameters: [
        parameter('workspaceRoot', () => z.string(), { type: 'string' }),
        parameter('from', () => z.string(), { type: 'string' }),
        parameter('to', () => z.string(), { type: 'string' }),
      ],
      cancellation: { parameter: 'signal' },
      result: codec(() => z.object({ from: z.string(), to: z.string() }), {
        type: 'object',
        properties: { from: { type: 'string' }, to: { type: 'string' } },
        required: ['from', 'to'],
        additionalProperties: false,
      }),
    },
  },
}, z as unknown as Parameters<typeof createTypertRemoteInfo>[1])

/** Stable Cordis plugin name. */
export const name = 'hulala-api-files'

/** Cordis plugin object loaded by the Host assembly. */
export const apiFilesPlugin = {
  name,
  inject: ['typert'],
  async apply(ctx: Context): Promise<void> {
    await ctx.plugin(HulalaFiles)
    const contribution: TypertContribution = {
      package: filesRemote.package,
      face: 'host',
      schemas: [],
      model: { services: [], events: [], objects: [] },
      invocations: filesRemote.descriptors,
    }
    ctx.effect(() => ctx.typert.register(contribution), 'hulala-api-files: Remote descriptors')
  },
}
