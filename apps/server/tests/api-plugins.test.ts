import { afterEach, test, expect } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { relative, resolve, isAbsolute, sep } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { HulalaFiles } from '../src/plugins/apiFiles.ts'
import { HulalaGit } from '../src/plugins/apiGit.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), label))
  roots.push(root)
  return root
}

function fakeFileSystem(): FileSystem {
  const target = (path: string): FsTarget => ({ targetKey: path as never, displayPath: path })
  return {
    async resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }) {
      const candidate = isAbsolute(path) ? resolve(path) : resolve(options?.cwd ?? process.cwd(), path)
      return target(await realpath(candidate).catch(() => candidate))
    },
    processPath: (value: FsTarget) => value.targetKey as string,
    fileUrl: (value: FsTarget) => `file://${value.targetKey as string}`,
    contains(parent: FsTarget, child: FsTarget) {
      const difference = relative(parent.targetKey as string, child.targetKey as string)
      return difference === '' || (!difference.startsWith(`..${sep}`) && difference !== '..' && !isAbsolute(difference))
    },
    async stat(value: FsTarget) {
      const metadata = await stat(value.targetKey as string).catch(() => undefined)
      return metadata === undefined ? undefined : {
        version: `${metadata.mtimeMs}:${metadata.size}` as never,
        type: metadata.isFile() ? 'file' as const : metadata.isDirectory() ? 'directory' as const : 'other' as const,
        size: metadata.size,
      }
    },
    async writeText(value: FsTarget, content: string) {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(value.targetKey as string, content, 'utf8')
      return { operation: 'create' as const, version: 'fake' as never }
    },
    async deleteFile(value: FsTarget) {
      const { rm } = await import('node:fs/promises')
      await rm(value.targetKey as string)
      return { text: null, version: 'fake' as never }
    },
    async moveFile(source: FsTarget, destination: FsTarget) {
      const { rename } = await import('node:fs/promises')
      await rename(source.targetKey as string, destination.targetKey as string)
      return { destination: { operation: 'create' as const, version: 'fake' as never }, sourceDeleted: true }
    },
  } as unknown as FileSystem
}

class FakeSubprocess {
  constructor(private readonly output: (spec: SubprocessSpawnSpec) => string) {}

  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    const text = this.output(spec)
    const reader = { readFrom: () => ({ text, nextOffset: text.length, lossy: false }) }
    return {
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      control: undefined,
      collected: { stdout: reader, stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) } },
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate: () => undefined,
      waitForExit: async () => true,
    } as unknown as SubprocessHandle
  }
}

async function filesService(): Promise<HulalaFiles> {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('fs', fakeFileSystem())
  await ctx.plugin(HulalaFiles)
  return ctx.get('hulalaFiles')
}

test('files plugin mutates only inside the named workspace', async () => {
  const root = await temporaryRoot('hulala-files-plugin-')
  const workspace = join(root, 'workspace')
  await mkdir(workspace, { recursive: true })
  const files = await filesService()
  await files.writeText(workspace, 'notes/a.txt', 'hello')
  await files.copy(workspace, 'notes/a.txt', 'notes/b.txt')
  await files.rename(workspace, 'notes/b.txt', 'notes/c.txt')
  expect(await readFile(join(workspace, 'notes', 'c.txt'), 'utf8')).toBe('hello')
  await files.remove(workspace, 'notes')
  await expect(stat(join(workspace, 'notes'))).rejects.toThrow()

  await expect(files.writeText(workspace, '../escape.txt', 'nope')).rejects.toMatchObject({
    code: 'gateway/bad-request',
  })
  await expect(files.remove(workspace, '.')).rejects.toMatchObject({
    code: 'gateway/bad-request',
  })
})

test('git plugin reads status, branches, checkout and diff from the execution world', async () => {
  const root = await temporaryRoot('hulala-git-plugin-')
  const ctx = new Context()
  contexts.push(ctx)
  const calls: string[][] = []
  ctx.provide('subprocess', new FakeSubprocess(spec => {
    calls.push([...spec.argv])
    if (spec.argv.includes('status')) return '## main...origin/main\n M file.txt\n'
    if (spec.argv.includes('branch')) return '*\tmain\n \tfeature\n'
    if (spec.argv.includes('diff')) return 'diff --git a/file.txt b/file.txt\n'
    return ''
  }) as unknown as SubprocessRuntime)
  await ctx.plugin(HulalaGit)
  const git = ctx.get('hulalaGit')

  await expect(git.status(root)).resolves.toEqual({ branch: 'main', changes: [' M file.txt'] })
  await expect(git.branches(root)).resolves.toEqual({ current: 'main', branches: ['main', 'feature'] })
  await expect(git.checkout(root, 'feature')).resolves.toEqual({ branch: 'feature' })
  await expect(git.diff(root, 'file.txt')).resolves.toEqual({ patch: 'diff --git a/file.txt b/file.txt\n' })
  expect(calls[0]).toContain('status')
  expect(calls[2]).toContain('switch')
  await expect(git.checkout(root, '--force')).rejects.toMatchObject({ code: 'gateway/bad-request' })
})

function join(...parts: string[]): string {
  return resolve(...parts)
}
