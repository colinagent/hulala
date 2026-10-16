import type { HarnessInProcessServices } from '../src/runtime.ts'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve as resolvePath, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { HarnessStreamEnvelope } from '../src/runtime.ts'
import type { NativeWorkspaceRegistry } from '../src/workspaces.ts'

type UnaryHandler = (
  method: string,
  payload: Record<string, unknown>,
) => unknown | Promise<unknown>

export interface FakeHarnessClientOptions {
  unary: UnaryHandler
  muxFrames?: HarnessStreamEnvelope[]
  hostFrames?: HarnessStreamEnvelope[]
  respond?: (message: unknown) => { accepted: boolean; reason?: string } | Promise<{ accepted: boolean; reason?: string }>
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
}

async function* stream(
  frames: HarnessStreamEnvelope[],
  signal: AbortSignal,
  onOpen?: () => void,
): AsyncGenerator<HarnessStreamEnvelope> {
  onOpen?.()
  for (const frame of frames) yield frame
  await waitForAbort(signal)
}

/** Native API-client test double; it never opens an HTTP or WebSocket transport. */
export function fakeHarnessClient(options: FakeHarnessClientOptions): {
  services: HarnessInProcessServices
  calls: string[]
} {
  const calls: string[] = []
  const call = async (endpoint: string, args: Readonly<Record<string, unknown>>) => {
    calls.push(endpoint)
    return options.unary(endpoint, (args.request ?? args._request ?? args) as Record<string, unknown>)
  }
  const services: HarnessInProcessServices = {
    typertGateway: {
      async invoke({ namespace, method, args }) {
        const value = await call(namespace + '/' + method, args)
        if (namespace === 'agentPresets' && method === 'select') return (value as { agentPreset: string }).agentPreset
        if (namespace === 'llm' && method === 'listConfigurableProviders') return (value as { providers: unknown[] }).providers
        return value
      },
      async stream({ namespace, method, args }) {
        const value = await call(namespace + '/' + method, args) as { events?: Array<{ event: unknown }>; hasMore?: boolean; projections?: unknown }
        if (namespace === 'workspace') return (async function* () { yield { type: 'baseline', value } })()
        return (async function* () { yield {
          type: 'snapshot', header: {}, cursor: -1,
          records: (value.events ?? []).map(entry => ({ type: 'event', event: entry.event })),
          hasMore: value.hasMore ?? false, projections: value.projections,
        } })()
      },
    },
    notifications: {
      events: (kind, signal, onOpen) => stream(kind === 'mux' ? options.muxFrames ?? [] : options.hostFrames ?? [], signal, onOpen),
      respond: async (rpcId, result) => options.respond?.({ rpcId, result }) ?? { accepted: true },
    },
  }
  return { services, calls }
}

export function fakeWorkspaceRegistry(): NativeWorkspaceRegistry {
  const items = new Map<string, { id: string; path: string; title: string }>()
  return {
    list: () => [...items.values()],
    get: id => items.get(id),
    async resolveByPath(path) {
      const canonical = await realpath(resolvePath(path)).catch(() => undefined)
      return canonical === undefined
        ? undefined
        : [...items.values()].find(item => item.path === canonical)
    },
    async create(path, title) {
      const canonical = await realpath(resolvePath(path))
      const metadata = await stat(canonical)
      if (!metadata.isDirectory()) throw new Error('workspace must be a directory')
      const existing = [...items.values()].find(item => item.path === canonical)
      if (existing !== undefined) return existing
      const item = {
        id: crypto.randomUUID(),
        path: canonical,
        title: title ?? (basename(canonical) || canonical),
      }
      items.set(item.id, item)
      return item
    },
  }
}

function targetPath(target: FsTarget): string {
  return target.targetKey as string
}

function localTarget(path: string): FsTarget {
  return { targetKey: path as never, displayPath: path }
}

async function canonicalPath(candidate: string): Promise<string> {
  try {
    return await realpath(candidate)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    let parent = dirname(candidate)
    while (true) {
      try {
        const canonicalParent = await realpath(parent)
        return resolvePath(canonicalParent, relative(parent, candidate))
      } catch (parentError) {
        if ((parentError as NodeJS.ErrnoException).code !== 'ENOENT') throw parentError
        const next = dirname(parent)
        if (next === parent) throw parentError
        parent = next
      }
    }
  }
}

export function fakeFileSystem(onWritePolicy?: (policy: unknown) => void): FileSystem {
  return {
    async resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }) {
      const candidate = isAbsolute(path) ? resolvePath(path) : resolvePath(options?.cwd ?? process.cwd(), path)
      return localTarget(await canonicalPath(candidate))
    },
    processPath: targetPath,
    fileUrl: (target: FsTarget) => pathToFileURL(targetPath(target)).href,
    contains(parent: FsTarget, child: FsTarget) {
      const difference = relative(targetPath(parent), targetPath(child))
      return difference === '' || (!difference.startsWith(`..${sep}`) && difference !== '..' && !isAbsolute(difference))
    },
    async stat(target: FsTarget) {
      const metadata = await stat(targetPath(target)).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      })
      return metadata === undefined ? undefined : {
        version: `${metadata.mtimeMs}:${metadata.size}` as never,
        type: metadata.isFile() ? 'file' : metadata.isDirectory() ? 'directory' : 'other',
        size: metadata.isFile() ? metadata.size : undefined,
      }
    },
    async lstat(path: string, options?: { cwd?: string }) {
      const candidate = isAbsolute(path) ? resolvePath(path) : resolvePath(options?.cwd ?? process.cwd(), path)
      const metadata = await lstat(candidate).catch(error => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      })
      return metadata === undefined ? undefined : {
        version: `${metadata.mtimeMs}:${metadata.size}` as never,
        type: metadata.isSymbolicLink() ? 'symlink' : metadata.isFile() ? 'file' : metadata.isDirectory() ? 'directory' : 'other',
        size: metadata.isFile() ? metadata.size : undefined,
      }
    },
    readText: (target: FsTarget) => readFile(targetPath(target), 'utf8'),
    async streamText(target: FsTarget) {
      const content = await readFile(targetPath(target), 'utf8')
      return (async function* () { yield content })()
    },
    async readBytes(target: FsTarget, _signal: AbortSignal | undefined, maxBytes: number) {
      const content = await readFile(targetPath(target))
      if (content.byteLength > maxBytes) throw new Error('file too large')
      return content
    },
    async listDir(target: FsTarget) {
      const path = targetPath(target)
      const entries = await readdir(path, { withFileTypes: true })
      return Promise.all(entries.sort((left, right) => left.name.localeCompare(right.name)).map(async entry => {
        const childPath = resolvePath(path, entry.name)
        const metadata = await stat(childPath)
        return {
          name: entry.name,
          type: entry.isFile() ? 'file' as const : entry.isDirectory() ? 'directory' as const : 'other' as const,
          target: localTarget(await realpath(childPath)),
          version: `${metadata.mtimeMs}:${metadata.size}` as never,
          size: entry.isFile() ? metadata.size : undefined,
        }
      }))
    },
    async writeText(target: FsTarget, content: string, _expected?: unknown, _signal?: AbortSignal, policy?: unknown) {
      onWritePolicy?.(policy)
      const path = targetPath(target)
      const before = await readFile(path, 'utf8').catch(() => null)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content)
      const metadata = await stat(path)
      return {
        operation: before === null ? 'create' as const : 'update' as const,
        version: `${metadata.mtimeMs}:${metadata.size}` as never,
        before,
        after: content,
      }
    },
  } as unknown as FileSystem
}

export function fakeNativeServices(): {
  workspaceRegistry: NativeWorkspaceRegistry
  fs: FileSystem
} {
  return { workspaceRegistry: fakeWorkspaceRegistry(), fs: fakeFileSystem() }
}

export function unavailableSubprocess(): SubprocessRuntime {
  return {
    spawn() { throw new Error('subprocess is unavailable in this test') },
  } as unknown as SubprocessRuntime
}
