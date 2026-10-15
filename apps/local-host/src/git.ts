import type { Workspace } from '@hulala/workbench-contracts'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { HttpError } from './http.ts'
import type { WorkspaceFiles } from './files'
import { realpath } from 'node:fs/promises'

async function runGit(workspace: Workspace, args: string[], native?: SubprocessRuntime): Promise<string> {
  if (native === undefined) {
    throw new HttpError(503, 'subprocess_unavailable', 'Harness subprocess provider is unavailable')
  }
  const process = await native.spawn({
    argv: ['git', '-C', workspace.path, ...args],
    cwd: workspace.path,
    env: { LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 4 * 1024 * 1024 },
      stderr: { maxBytes: 1024 * 1024 },
    },
    graceMs: 5_000,
  })
  const outcome = await process.done
  const stdout = process.collected.stdout?.readFrom(0).text ?? ''
  const stderr = process.collected.stderr?.readFrom(0).text ?? ''
  if (outcome.exitCode !== 0) throw new HttpError(409,
    outcome.exitCode === 128 && /not a git repository/i.test(stderr) ? 'git_not_repository' : 'git_failed',
    stderr.trim() || 'git command failed')
  return stdout
}

export class GitService {
  constructor(private readonly native?: SubprocessRuntime, private readonly files?: WorkspaceFiles) {}

  private async ownsRepository(workspace: Workspace): Promise<boolean> {
    try {
      const root = (await runGit(workspace, ['rev-parse', '--show-toplevel'], this.native)).trim()
      return await realpath(root) === await realpath(workspace.path)
    } catch (error) { if (error instanceof HttpError && error.code === 'git_not_repository') return false; throw error }
  }

  async status(workspace: Workspace): Promise<{ branch: string; changes: string[]; isRepo?: false }> {
    if (!await this.ownsRepository(workspace)) return { branch: '', changes: [], isRepo: false }
    let output: string
    try { output = await runGit(workspace, ['status', '--porcelain=v1', '--branch'], this.native) }
    catch (error) { if (error instanceof HttpError && error.code === 'git_not_repository') return { branch: '', changes: [], isRepo: false }; throw error }
    const [head = '', ...changes] = output.trimEnd().split('\n')
    return { branch: head.replace(/^##\s*(?:No commits yet on |Initial commit on )?/, '').split('...')[0] || 'HEAD', changes: changes.filter(Boolean) }
  }

  async branches(workspace: Workspace): Promise<{ current: string; branches: string[]; isRepo?: false }> {
    if (!await this.ownsRepository(workspace)) return { current: '', branches: [], isRepo: false }
    let output: string
    try { output = await runGit(workspace, ['branch', '--format=%(HEAD)\t%(refname:short)'], this.native) }
    catch (error) { if (error instanceof HttpError && error.code === 'git_not_repository') return { current: '', branches: [], isRepo: false }; throw error }
    const rows = output.split('\n').filter(row => row.trim()).map(row => row.replace(/\r$/, '').split('\t'))
    return {
      current: rows.find(([marker]) => marker === '*')?.[1] ?? (await runGit(workspace, ['symbolic-ref', '--short', 'HEAD'], this.native).catch(() => 'HEAD')).trim(),
      branches: rows.map(([, branch]) => branch).filter(Boolean),
    }
  }

  async checkout(workspace: Workspace, branch: string, create = false): Promise<void> {
    if (!branch.trim() || branch.startsWith('-') || branch.includes('\0') || branch.includes('@{')) {
      throw new HttpError(400, 'branch_invalid', 'branch name is invalid')
    }
    const run = async () => {
      if (!await this.ownsRepository(workspace)) throw new HttpError(403, 'git_workspace_scope', 'Open the Git repository root as a Workspace before switching branches')
      await runGit(workspace, ['check-ref-format', '--branch', branch], this.native)
      if ((await this.status(workspace)).changes.length) throw new HttpError(409, 'git_dirty', 'Commit or discard changes before switching branches')
      await runGit(workspace, create ? ['switch', '-c', branch] : ['switch', branch], this.native)
    }
    if (this.files) await this.files.mutate(run); else await run()
  }
}
