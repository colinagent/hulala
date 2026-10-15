import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureHulalaPaths } from '../src/config'
import { ServerDatabase } from '../src/database'
import { ArchiveService } from '../src/archive'
import { WorkspaceFiles } from '../src/files'
import { fakeFileSystem } from './harness-fixture'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
test('archive cleanup never follows an external link and preserves recently modified descendants', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-archive-test-')); roots.push(root)
  const paths = await ensureHulalaPaths(join(root, 'state'), join(root, 'workspaces'))
  const database = new ServerDatabase(paths)
  try {
    const workspace = { id: 'workspace', name: 'Test', path: paths.workspace }
    const archive = new ArchiveService(database, new WorkspaceFiles(fakeFileSystem()))
    const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'keep.txt'), 'keep')
    await mkdir(join(workspace.path, '.agent'))
    await symlink(outside, join(workspace.path, '.agent/archive'))
    expect((await archive.run(workspace, 1, true)).candidates).toEqual([])
    const stored = join(workspace.path, '.hulala/archive/old')
    await mkdir(stored, { recursive: true }); await writeFile(join(stored, 'old.txt'), 'old'); await symlink(outside, join(stored, 'external'))
    const old = new Date('2020-01-01T00:00:00Z')
    await utimes(join(stored, 'old.txt'), old, old); await utimes(stored, old, old)
    const recent = join(workspace.path, '.hulala/archive/recent')
    await mkdir(recent); await writeFile(join(recent, 'new.txt'), 'new'); await utimes(recent, old, old)
    const result = await archive.run(workspace, 1, true)
    expect(result.candidates.map(candidate => candidate.path)).toEqual(['.hulala/archive/old'])
    expect(result.reclaimedBytes).toBe(3)
    expect(await readFile(join(outside, 'keep.txt'), 'utf8')).toBe('keep')
    expect(await readFile(join(recent, 'new.txt'), 'utf8')).toBe('new')
  } finally { database.close() }
})
