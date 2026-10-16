import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceFiles, resolveWorkspacePath } from '../src/files.ts'
import { fakeFileSystem } from './harness-fixture.ts'
import { ProtectedPaths } from '../src/protectedPaths'
import { ResourceService } from '../src/resources'

const temporaryDirectories: string[] = []
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hulala-files-test-'))
  temporaryDirectories.push(root)
  const workspacePath = join(root, 'workspace')
  await mkdir(workspacePath)
  return { root, workspace: { id: 'workspace', name: 'workspace', path: workspacePath } }
}

test('provider credentials stay out of file reads, downloads, aliases, and recursive copies', async () => {
  const { workspace } = await fixture()
  const directory = join(workspace.path, 'provider')
  await mkdir(directory)
  const secret = join(directory, 'auth.json')
  await writeFile(secret, 'synthetic credential fixture')
  await writeFile(join(directory, 'settings.json'), '{}')
  await symlink(secret, join(workspace.path, 'alias.json'))
  const files = new WorkspaceFiles(fakeFileSystem(), undefined, new ProtectedPaths([secret]))
  const resources = new ResourceService({} as never, files)
  for (const path of [secret, 'alias.json']) {
    await expect(files.readText(workspace, path)).rejects.toMatchObject({ status: 403 })
    await expect(resources.createHandle(workspace, path)).rejects.toMatchObject({ status: 403 })
    await expect(files.writeText(workspace, path, 'replacement', null)).rejects.toMatchObject({ status: 403 })
  }
  expect((await files.readdir(workspace, 'provider')).entries.map(item => item.name)).toEqual(['settings.json'])
  expect(JSON.stringify(await files.tree(workspace, '.', 3))).not.toContain('auth.json')
  expect(JSON.stringify(await files.tree(workspace, '.', 3))).not.toContain('alias.json')
  await expect(files.copy(workspace, 'provider', 'copy')).rejects.toMatchObject({ status: 403 })
  await expect(files.rename(workspace, 'provider', 'moved')).rejects.toMatchObject({ status: 403 })
  await expect(files.remove(workspace, 'provider')).rejects.toMatchObject({ status: 403 })
  expect(await readFile(secret, 'utf8')).toBe('synthetic credential fixture')
})

test('reads and atomically writes workspace text', async () => {
  const { workspace } = await fixture()
  let policy: unknown
  const files = new WorkspaceFiles(fakeFileSystem(value => { policy = value }))
  await files.writeText(workspace, 'notes/day.md', '# day', null)
  expect(await files.readText(workspace, 'notes/day.md')).toMatchObject({ content: '# day' })
  expect(policy).toEqual({ mode: 'workspace-write', workspaceRoot: workspace.path })
})

test('rejects lexical and symlink workspace escapes', async () => {
  const { root, workspace } = await fixture()
  const outside = join(root, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'secret.txt'), 'secret')
  await symlink(outside, join(workspace.path, 'escape'))
  await expect(resolveWorkspacePath(workspace, '../outside/secret.txt')).rejects.toThrow('workspace')
  await expect(resolveWorkspacePath(workspace, 'escape/secret.txt')).rejects.toThrow('path is outside the workspace')
  const tree = await new WorkspaceFiles(fakeFileSystem()).tree(workspace, '.', 8)
  expect(tree.children?.find(entry => entry.name === 'escape')).toMatchObject({ kind: 'symlink' })
  expect(JSON.stringify(tree)).not.toContain('secret.txt')
})

test('refuses a rename over another file and removes a link without deleting its target', async () => {
  const { workspace } = await fixture()
  const files = new WorkspaceFiles(fakeFileSystem())
  await writeFile(join(workspace.path, 'one.txt'), 'one')
  await writeFile(join(workspace.path, 'two.txt'), 'two')
  await expect(files.rename(workspace, 'one.txt', 'two.txt')).rejects.toThrow('already exists')
  await symlink(join(workspace.path, 'one.txt'), join(workspace.path, 'alias.txt'))
  await files.remove(workspace, 'alias.txt')
  expect(await readFile(join(workspace.path, 'one.txt'), 'utf8')).toBe('one')
  expect(await readFile(join(workspace.path, 'two.txt'), 'utf8')).toBe('two')
})

test.each([
  ['jev，一个不一样的模型.md', 'Jev，一个不一样的模型.md'],
  ['Jev，一个不一样的模型.md', 'jev，一个不一样的模型.md'],
])('persists a case-only rename from %s to %s in the directory listing', async (from, to) => {
  const { workspace } = await fixture()
  const files = new WorkspaceFiles(fakeFileSystem())
  const content = '正文保持不变\n'
  await writeFile(join(workspace.path, from), content)
  const original = await stat(join(workspace.path, from))

  await files.rename(workspace, from, to)

  // Reading the new path alone cannot catch this bug on a case-insensitive disk.
  expect(await readdir(workspace.path)).toEqual([to])
  expect((await files.readdir(workspace, '.')).entries.map(entry => entry.name)).toEqual([to])
  expect(await readFile(join(workspace.path, to), 'utf8')).toBe(content)
  expect((await stat(join(workspace.path, to))).ino).toBe(original.ino)
})

test('persists case-only directory renames and retains their children', async () => {
  const { workspace } = await fixture()
  const files = new WorkspaceFiles(fakeFileSystem())
  await mkdir(join(workspace.path, 'notes'))
  await writeFile(join(workspace.path, 'notes', 'article.md'), 'article')

  await files.rename(workspace, join(workspace.path, 'notes'), join(workspace.path, 'Notes'))

  expect(await readdir(workspace.path)).toEqual(['Notes'])
  expect(await readFile(join(workspace.path, 'Notes', 'article.md'), 'utf8')).toBe('article')
})

test('keeps the requested filename when the destination parent is an in-workspace symlink', async () => {
  const { workspace } = await fixture()
  const files = new WorkspaceFiles(fakeFileSystem())
  await mkdir(join(workspace.path, 'notes'))
  await writeFile(join(workspace.path, 'notes', 'jev.md'), 'article')
  await symlink(join(workspace.path, 'notes'), join(workspace.path, 'alias'))

  await files.rename(workspace, 'alias/jev.md', 'alias/Jev.md')

  expect(await readdir(join(workspace.path, 'notes'))).toEqual(['Jev.md'])
  expect(await readFile(join(workspace.path, 'alias', 'Jev.md'), 'utf8')).toBe('article')
})

test('still renames into new directories and accepts an unchanged filename', async () => {
  const { workspace } = await fixture()
  const files = new WorkspaceFiles(fakeFileSystem())
  await writeFile(join(workspace.path, 'article.md'), 'article')

  await files.rename(workspace, 'article.md', 'article.md')
  await files.rename(workspace, 'article.md', 'new/nested/Renamed.md')

  expect(await readdir(workspace.path)).toEqual(['new'])
  expect(await readFile(join(workspace.path, 'new/nested/Renamed.md'), 'utf8')).toBe('article')
})

test('rename destinations still reject traversal and symlinks outside the workspace', async () => {
  const { root, workspace } = await fixture()
  const files = new WorkspaceFiles(fakeFileSystem())
  const outside = join(root, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'target.md'), 'outside')
  await writeFile(join(workspace.path, 'source.md'), 'source')
  await symlink(outside, join(workspace.path, 'escape'))
  await symlink(join(outside, 'target.md'), join(workspace.path, 'target-link.md'))

  for (const destination of ['../outside/new.md', 'escape/new.md', 'escape/target.md', 'target-link.md']) {
    await expect(files.rename(workspace, 'source.md', destination)).rejects.toThrow('workspace')
  }

  expect(await readFile(join(workspace.path, 'source.md'), 'utf8')).toBe('source')
  expect(await readFile(join(outside, 'target.md'), 'utf8')).toBe('outside')
  expect(await readdir(outside)).toEqual(['target.md'])
})
