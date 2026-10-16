import { constants } from 'node:fs'
import { copyFile, cp, link, lstat, mkdir, open, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { FileEntry, Workspace } from '@hulala/workbench-contracts'
import type { FileSystem, FsTarget, FsVersion } from '@deepseek-ai/dsh-fs'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { resolveRgPath } from '@deepseek-ai/dsh-tool-fs-search'
import { ProtectedPaths } from './protectedPaths'
import { HttpError } from './http.ts'

const MAX_TEXT_FILE_BYTES = 16 * 1024 * 1024
const MAX_TREE_ENTRIES = 20_000

function remainsWithin(root: string, target: string): boolean {
  const difference = relative(root, target)
  return difference === '' || (!difference.startsWith(`..${sep}`) && difference !== '..' && !isAbsolute(difference))
}

async function nearestExistingParent(path: string): Promise<string> {
  let current = path
  while (true) {
    try {
      return await realpath(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }
}

export async function resolveWorkspacePath(
  workspace: Workspace,
  requestedPath: string,
  options: { allowMissing?: boolean; preserveBasename?: boolean } = {},
): Promise<string> {
  if (requestedPath.includes('\0')) throw new HttpError(400, 'path_invalid', 'path contains a null byte')
  const root = await realpath(workspace.path)
  const candidate = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(root, requestedPath || '.')
  try {
    const canonical = await realpath(candidate)
    if (!remainsWithin(root, canonical)) throw new HttpError(403, 'path_outside_workspace', 'path is outside the workspace')
    if (options.preserveBasename) {
      // realpath returns the old spelling for a case-only rename on macOS.
      // Validate the target and its parent, but keep the requested entry name.
      const parent = await resolveWorkspacePath(workspace, dirname(candidate))
      return join(parent, basename(candidate))
    }
    return canonical
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    if (!options.allowMissing) throw new HttpError(404, 'file_not_found', 'file not found')
    const parent = await nearestExistingParent(dirname(candidate))
    if (!remainsWithin(root, parent)) throw new HttpError(403, 'path_outside_workspace', 'path parent escapes the workspace')
    return candidate
  }
}

export class WorkspaceFiles {
  private mutation: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly native: FileSystem,
    private readonly subprocess?: SubprocessRuntime,
    private readonly protectedPaths = new ProtectedPaths(),
  ) {}

  async resolve(workspace: Workspace, path: string, options: { allowMissing?: boolean; preserveBasename?: boolean } = {}): Promise<string> {
    const resolved = await resolveWorkspacePath(workspace, path, options)
    await this.protectedPaths.assert(resolved)
    return resolved
  }

  private async nativeTarget(workspace: Workspace, requestedPath: string): Promise<{
    target: FsTarget
    path: string
  }> {
    const root = await this.native.resolve(workspace.path)
    const target = await this.native.resolve(requestedPath || '.', { cwd: workspace.path })
    if (!this.native.contains(root, target)) {
      throw new HttpError(403, 'path_outside_workspace', 'path is outside the workspace')
    }
    const path = this.native.processPath(target)
    await this.protectedPaths.assert(path)
    return { target, path }
  }

  async stat(workspace: Workspace, requestedPath: string): Promise<{
    path: string
    name: string
    size: number
    isDir: boolean
    modTime: number
    mode: number
    version: string
  }> {
    const { target, path } = await this.nativeTarget(workspace, requestedPath)
    const info = await this.native.stat(target)
    if (info === undefined) throw new HttpError(404, 'file_not_found', 'file not found')
    const metadata = await stat(path)
    return {
      path,
      name: path.split(sep).at(-1) ?? path,
      size: info.size ?? metadata.size,
      isDir: info.type === 'directory',
      modTime: metadata.mtimeMs,
      mode: metadata.mode,
      version: info.version,
    }
  }

  async readdir(workspace: Workspace, requestedPath: string): Promise<{
    path: string
    entries: Array<{ name: string; isDir: boolean; size: number; modTime: number }>
  }> {
    const { target, path } = await this.nativeTarget(workspace, requestedPath)
    const listed = await this.native.listDir(target)
    const visible = (await Promise.all(listed.map(async entry => await this.protectedPaths.visible(this.native.processPath(entry.target)) ? entry : undefined))).filter(entry => entry !== undefined)
    const entries = await Promise.all(visible.map(async entry => {
      const childPath = this.native.processPath(entry.target)
      const metadata = await stat(childPath)
      return {
        name: entry.name,
        isDir: entry.type === 'directory',
        size: entry.size ?? metadata.size,
        modTime: metadata.mtimeMs,
      }
    }))
    return { path, entries }
  }

  async tree(workspace: Workspace, requestedPath = '.', depth = 2): Promise<FileEntry> {
    const target = await this.resolve(workspace, requestedPath)
    let entries = 0
    const visit = async (path: string, remainingDepth: number): Promise<FileEntry> => {
      if (++entries > MAX_TREE_ENTRIES) throw new HttpError(413, 'tree_too_large', 'directory tree is too large')
      const metadata = await lstat(path)
      const workspaceRelative = relative(workspace.path, path) || '.'
      if (metadata.isSymbolicLink()) return { name: path.split(sep).at(-1) ?? path, path: workspaceRelative, kind: 'symlink' }
      if (!metadata.isDirectory()) return {
        name: path.split(sep).at(-1) ?? path,
        path: workspaceRelative,
        kind: 'file',
        size: metadata.size,
        modifiedAt: metadata.mtime.toISOString(),
      }
      const entry: FileEntry = {
        name: path === workspace.path ? workspace.name : path.split(sep).at(-1) ?? path,
        path: workspaceRelative,
        kind: 'directory',
        modifiedAt: metadata.mtime.toISOString(),
      }
      if (remainingDepth > 0) {
        const names = (await Promise.all((await readdir(path)).map(async name => await this.protectedPaths.visible(join(path, name)) ? name : undefined))).filter((name): name is string => name !== undefined)
        entry.children = await Promise.all(names
          .filter(name => name !== '.git' && name !== 'node_modules')
          .sort((left, right) => left.localeCompare(right))
          .map(name => visit(join(path, name), remainingDepth - 1)))
      }
      return entry
    }
    return visit(target, Math.max(0, Math.min(depth, 8)))
  }

  async readText(workspace: Workspace, requestedPath: string): Promise<{ content: string; modifiedAt: string; version: string }> {
    const { target, path } = await this.nativeTarget(workspace, requestedPath)
    for (let attempt = 0; attempt < 3; attempt++) {
      const info = await this.native.stat(target)
      if (info === undefined) throw new HttpError(404, 'file_not_found', 'file not found')
      if (info.type !== 'file') throw new HttpError(400, 'file_invalid', 'path is not a file')
      if ((info.size ?? 0) > MAX_TEXT_FILE_BYTES) throw new HttpError(413, 'file_too_large', 'file is too large for text editing')
      const content = await this.native.readText(target)
      if (Buffer.byteLength(content) > MAX_TEXT_FILE_BYTES) throw new HttpError(413, 'file_too_large', 'file is too large for text editing')
      const after = await this.native.stat(target)
      if (after?.version === info.version) return { content, version: info.version, modifiedAt: (await stat(path)).mtime.toISOString() }
    }
    throw new HttpError(409, 'file_changed', 'The file changed while reading. Try opening it again.')
  }

  async writeText(workspace: Workspace, requestedPath: string, content: string, expectedVersion: string | null): Promise<{ version: string }> {
    if (Buffer.byteLength(content) > MAX_TEXT_FILE_BYTES) throw new HttpError(413, 'file_too_large', 'file is too large for text editing')
    const { target, path } = await this.nativeTarget(workspace, requestedPath)
    return this.serializeWrite(path, async () => { try {
      if (expectedVersion === null) await mkdir(dirname(path), { recursive: true })
      const result = await this.native.writeText(target, content,
        expectedVersion === null ? { kind: 'createIfAbsent' } : { kind: 'replaceIfVersion', version: expectedVersion as FsVersion },
        undefined, { mode: 'workspace-write', workspaceRoot: workspace.path })
      return { version: result.version }
    } catch (error) {
      if (['FS_STALE_VERSION', 'FS_NOT_OBSERVED'].includes((error as { code?: string }).code ?? '')) {
        throw new HttpError(409, 'file_conflict', 'This file changed on disk. Your draft is preserved. Reopen the file to review the new version, or save your draft under a different name.')
      }
      throw error
    } })
  }

  private async serializeWrite<T>(_path: string, operation: () => Promise<T>): Promise<T> {
    // Directory moves also affect child paths. Serialize browser mutations within
    // this Workspace so a concurrent save cannot recreate a just-moved entry.
    const current = this.mutation.catch(() => undefined).then(operation)
    this.mutation = current
    return current
  }

  mutate<T>(operation: () => Promise<T>): Promise<T> { return this.serializeWrite('.', operation) }

  async publishResource(workspace: Workspace, requestedPath: string, source: string, expectedVersion: string | null): Promise<void> {
    const { target, path } = await this.nativeTarget(workspace, requestedPath)
    await this.serializeWrite(path, async () => {
      const check = async () => {
        const current = await this.native.stat(target)
        if (expectedVersion === null ? current !== undefined : current?.version !== expectedVersion) {
          throw new HttpError(409, 'file_conflict', 'The destination changed. Review the import conflicts before trying again.')
        }
        // Revalidate after streaming; a directory may have changed since selection.
        if (await this.resolve(workspace, requestedPath, { allowMissing: true }) !== path) throw new HttpError(409, 'file_conflict', 'The destination changed during import.')
      }
      await check()
      await mkdir(dirname(path), { recursive: true })
      const staged = join(dirname(path), '.hulala-import-' + crypto.randomUUID())
      try {
        await copyFile(source, staged, constants.COPYFILE_EXCL)
        const file = await open(staged, 'r+')
        try { await file.sync() } finally { await file.close() }
        await check()
        if (expectedVersion === null) {
          try { await link(staged, path) } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new HttpError(409, 'file_conflict', 'A file with this name already exists.')
            throw error
          }
        } else await rename(staged, path)
      } finally { await rm(staged, { force: true }) }
    })
  }

  async mkdir(workspace: Workspace, requestedPath: string): Promise<void> {
    await this.serializeWrite(requestedPath, async () => { await mkdir(await this.resolve(workspace, requestedPath, { allowMissing: true }), { recursive: true }) })
  }

  async remove(workspace: Workspace, requestedPath: string): Promise<void> {
    const path = await this.resolve(workspace, requestedPath, { preserveBasename: true })
    if (path === workspace.path) throw new HttpError(403, 'workspace_root_protected', 'workspace root cannot be removed')
    await this.protectedPaths.assert(path, true)
    await this.serializeWrite(path, () => rm(path, { recursive: true, force: false }))
  }

  async rename(workspace: Workspace, from: string, to: string): Promise<{ versionBefore?: string; versionAfter?: string }> {
    const source = await this.resolve(workspace, from, { preserveBasename: true })
    const destination = await this.resolve(workspace, to, { allowMissing: true, preserveBasename: true })
    if (source === workspace.path) throw new HttpError(403, 'workspace_root_protected', 'workspace root cannot be renamed')
    await this.protectedPaths.assert(source, true)
    await this.protectedPaths.assert(destination, true)
    return this.serializeWrite(destination, async () => {
      const sourceTarget = await this.nativeTarget(workspace, from)
      const before = await this.native.stat(sourceTarget.target)
      const beforeMetadata = await lstat(source, { bigint: true })
      const existing = await lstat(destination).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return null })
      if (existing) {
        const original = await lstat(source)
        if (existing.dev !== original.dev || existing.ino !== original.ino) throw new HttpError(409, 'file_conflict', 'A file or folder with this name already exists.')
      }
      await mkdir(dirname(destination), { recursive: true })
      await rename(source, destination)
      const afterMetadata = await lstat(destination, { bigint: true })
      if (before?.type === 'file' && beforeMetadata.ino === afterMetadata.ino && beforeMetadata.size === afterMetadata.size && beforeMetadata.mtimeNs === afterMetadata.mtimeNs) {
        const moved = await this.nativeTarget(workspace, to)
        return { versionBefore: before.version, versionAfter: (await this.native.stat(moved.target))?.version }
      }
      return {}
    })
  }

  async copy(workspace: Workspace, from: string, to: string): Promise<void> {
    const source = await this.resolve(workspace, from)
    const destination = await this.resolve(workspace, to, { allowMissing: true })
    await this.protectedPaths.assert(source, true)
    await this.protectedPaths.assert(destination, true)
    await this.serializeWrite(destination, () => cp(source, destination, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true }))
  }

  async search(workspace: Workspace, query: string, limit = 200, options: { path?: string; regex?: boolean; matchCase?: boolean; wholeWord?: boolean; includes?: string[]; excludes?: string[] } = {}): Promise<Array<{ path: string; line: number; text: string }>> {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return []
    if (this.subprocess === undefined) throw new HttpError(503, 'subprocess_unavailable', 'Harness subprocess provider is unavailable')
    const cwd = await this.resolve(workspace, options.path || '.')
    limit = Math.max(1, Math.min(limit, 2000))
    const flags = [options.regex ? '--regexp' : '--fixed-strings']
    // The pattern is always a separate positional argument after `--`.
    if (options.regex) flags.length = 0
    if (!options.matchCase) flags.push('--ignore-case')
    if (options.wholeWord) flags.push('--word-regexp')
    for (const pattern of options.includes || []) flags.push('--glob', pattern)
    for (const pattern of options.excludes || []) flags.push('--glob', '!' + pattern)
    const process = await this.subprocess.spawn({
      argv: [await resolveRgPath(), '--json', ...flags, '--max-filesize', '16M', '--max-count', String(limit), '--', normalizedQuery, '.'],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 16 * 1024 * 1024 },
        stderr: { maxBytes: 1024 * 1024 },
      },
      graceMs: 5_000,
    })
    const outcome = await process.done
    const captured = process.collected.stdout?.readFrom(0)
    if (captured?.lossy) throw new HttpError(413, 'search_output_limit', 'Search output is too large. Narrow the query or directory.')
    const output = captured?.text ?? ''
    const error = process.collected.stderr?.readFrom(0).text ?? ''
    const exitCode = outcome.exitCode
    if (exitCode !== 0 && exitCode !== 1) throw new HttpError(500, 'search_failed', error.trim() || 'search failed')
    const matches: Array<{ path: string; line: number; text: string }> = []
    for (const line of output.split('\n')) {
      if (!line) continue
      const event = JSON.parse(line) as {
        type: string
        data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } }
      }
      if (event.type !== 'match' || !event.data?.path?.text || !event.data.lines?.text) continue
      if (!await this.protectedPaths.visible(join(cwd, event.data.path.text))) continue
      matches.push({ path: join(cwd, event.data.path.text), line: event.data.line_number ?? 1, text: event.data.lines.text.trimEnd() })
      if (matches.length >= limit) break
    }
    return matches
  }
}
