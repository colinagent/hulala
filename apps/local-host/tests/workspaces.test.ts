import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveHulalaPaths } from '@hulala/workbench-contracts/paths'
import { parseServerConfig } from '../src/config'
import { WorkspaceRegistry, normalizeManagedWorkspaceName } from '../src/workspaces'
import { fakeWorkspaceRegistry } from './harness-fixture.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hulala-workspaces-test-'))
  roots.push(root)
  const paths = resolveHulalaPaths(join(root, 'state'), join(root, 'managed'))
  await mkdir(paths.config, { recursive: true })
  const native = fakeWorkspaceRegistry()
  const registry = new WorkspaceRegistry(paths, native)
  await registry.initialize()
  return { root, paths, registry, native }
}

test('a browser worker exposes only its selected Workspace even when the native registry has more entries', async () => {
  const { paths, native, registry } = await fixture()
  const foreign = await registry.createManaged('another')
  const worker = new WorkspaceRegistry(paths, native, false)
  await worker.initialize()
  expect(worker.list()).toHaveLength(1)
  expect(worker.list()[0]?.path).toBe(await realpath(paths.workspace))
  expect(() => worker.get(foreign.id)).toThrow('selected Workspace')
  await expect(worker.add(foreign.path)).rejects.toMatchObject({ status: 403 })
  await expect(worker.createManaged('not-here')).rejects.toMatchObject({ status: 403 })
})

test('parses independent state and Workspace roots from Server arguments', () => {
  expect(parseServerConfig([
    '--port', '0',
    '--hulala-home', '/tmp/hulala-state',
    '--workspace-root', '/tmp/hulala-workspace-root',
  ])).toMatchObject({
    hulalaRoot: '/tmp/hulala-state',
    workspaceRoot: '/tmp/hulala-workspace-root',
  })
})

test('creates and registers a Unicode managed Workspace directly below workspaceRoot', async () => {
  const { paths, registry } = await fixture()
  const workspace = await registry.createManaged('  个人 项目  ')
  expect(workspace.path).toBe(await realpath(join(paths.workspaceRoot, '个人 项目')))
  expect(workspace.name).toBe('个人 项目')
  expect((await stat(workspace.path)).isDirectory()).toBeTrue()
  expect(registry.list()).toContainEqual(workspace)
})

test('initializes the built-in Workspace as a minimal persistent Wiki', async () => {
  const { paths } = await fixture()
  expect((await stat(join(paths.workspace, 'raw'))).isDirectory()).toBeTrue()
  expect((await stat(join(paths.workspace, 'wiki'))).isDirectory()).toBeTrue()
  expect(await readFile(join(paths.workspace, 'AGENTS.md'), 'utf8')).toContain('Treat it as the source of truth')
  expect(await readFile(join(paths.workspace, 'wiki', 'index.md'), 'utf8')).toContain('## Start here')
  expect(await readFile(join(paths.workspace, 'wiki', 'log.md'), 'utf8')).toContain('Append-only history')
})

test('preserves existing files when initializing the built-in Workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-workspaces-preserve-test-'))
  roots.push(root)
  const paths = resolveHulalaPaths(join(root, 'state'), join(root, 'managed'))
  await mkdir(join(paths.workspace, 'wiki'), { recursive: true })
  await writeFile(join(paths.workspace, 'AGENTS.md'), 'custom agent rules\n')
  await writeFile(join(paths.workspace, 'wiki', 'index.md'), '# My existing index\n')
  await writeFile(join(paths.workspace, 'wiki', 'log.md'), '# My existing log\n')

  const registry = new WorkspaceRegistry(paths, fakeWorkspaceRegistry())
  await registry.initialize()

  expect(await readFile(join(paths.workspace, 'AGENTS.md'), 'utf8')).toBe('custom agent rules\n')
  expect(await readFile(join(paths.workspace, 'wiki', 'index.md'), 'utf8')).toBe('# My existing index\n')
  expect(await readFile(join(paths.workspace, 'wiki', 'log.md'), 'utf8')).toBe('# My existing log\n')
  expect((await stat(join(paths.workspace, 'raw'))).isDirectory()).toBeTrue()
})

test('keeps newly managed Workspaces empty', async () => {
  const { registry } = await fixture()
  const workspace = await registry.createManaged('blank-project')
  await expect(stat(join(workspace.path, 'AGENTS.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(stat(join(workspace.path, 'raw'))).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(stat(join(workspace.path, 'wiki'))).rejects.toMatchObject({ code: 'ENOENT' })
})

test('rejects invalid names and every kind of existing direct child', async () => {
  const { paths, registry } = await fixture()
  for (const name of ['', ' ', '.', '..', 'nested/name', 'nested\\name', 'bad\u0000name']) {
    expect(() => normalizeManagedWorkspaceName(name)).toThrow()
  }

  await mkdir(join(paths.workspaceRoot, 'existing-directory'))
  await writeFile(join(paths.workspaceRoot, 'existing-file'), 'occupied')
  await symlink(paths.workspace, join(paths.workspaceRoot, 'existing-link'))
  for (const name of ['existing-directory', 'existing-file', 'existing-link']) {
    await expect(registry.createManaged(name)).rejects.toMatchObject({ code: 'workspace_exists', status: 409 })
  }
})

test('allows only one winner when the same Workspace name is created concurrently', async () => {
  const { registry } = await fixture()
  const results = await Promise.allSettled([
    registry.createManaged('concurrent'),
    registry.createManaged('concurrent'),
  ])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
})

test('rolls back a newly created directory when native registration fails', async () => {
  const { paths, registry, native } = await fixture()
  const create = native.create.bind(native)
  native.create = async (path, title) => {
    if (path.endsWith('rollback')) throw new Error('registration failed')
    return create(path, title)
  }
  await expect(registry.createManaged('rollback')).rejects.toThrow('registration failed')
  await expect(stat(join(paths.workspaceRoot, 'rollback'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(registry.list().some(workspace => workspace.name === 'rollback')).toBeFalse()
  native.create = create
})

test('does not create a parallel private Workspace registry file', async () => {
  const { paths } = await fixture()
  await expect(stat(join(paths.config, 'workspaces.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})
