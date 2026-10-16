import { afterEach, expect, test } from 'bun:test'
import { Context } from '@deepseek-ai/cordis'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GitService } from '../src/git'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action() })
test('branch listing keeps the first non-current branch, supports Unicode, and rechecks dirty files before checkout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-git-test-'))
  const context = new Context(); await context.plugin(LocalSubprocessRuntime)
  cleanup.push(() => rm(root, { recursive: true, force: true }), () => context.fiber.dispose())
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(['git', '-C', root, ...args], { env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } })
    if (result.exitCode) throw new Error(result.stderr.toString())
  }
  const service = new GitService(context.get('subprocess'))
  const workspace = { id: 'workspace', name: 'Test', path: root }
  expect(await service.branches(workspace)).toEqual({ current: '', branches: [], isRepo: false })
  expect(await service.status(workspace)).toEqual({ branch: '', changes: [], isRepo: false })
  git('init', '-b', 'zeta'); git('config', 'user.name', 'Hulala QA'); git('config', 'user.email', 'qa@example.invalid'); git('config', 'commit.gpgsign', 'false'); git('config', 'core.hooksPath', '')
  await writeFile(join(root, 'note.txt'), 'original')
  git('add', '.'); git('commit', '-m', 'Synthetic fixture'); git('branch', 'alpha')
  expect(await service.branches(workspace)).toEqual({ current: 'zeta', branches: ['alpha', 'zeta'] })
  await mkdir(join(root, 'subfolder'))
  const childWorkspace = { ...workspace, path: join(root, 'subfolder') }
  expect((await service.branches(childWorkspace)).isRepo).toBeFalse()
  await expect(service.checkout(childWorkspace, 'alpha')).rejects.toMatchObject({ code: 'git_workspace_scope' })
  await service.checkout(workspace, '功能/中文', true)
  expect((await service.branches(workspace)).current).toBe('功能/中文')
  await writeFile(join(root, 'note.txt'), 'unsaved external change')
  await expect(service.checkout(workspace, 'alpha')).rejects.toMatchObject({ code: 'git_dirty' })
  expect((await service.branches(workspace)).current).toBe('功能/中文')
  await expect(service.checkout(workspace, '--detach')).rejects.toMatchObject({ code: 'branch_invalid' })
})
