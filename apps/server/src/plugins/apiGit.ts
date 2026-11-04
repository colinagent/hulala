/**
 * `@hulala/api-git` — the repository commands DeepSeek Harness does not provide.
 *
 * The Host already owns Session workspaces and the subprocess execution world;
 * this plugin exposes the small read/refresh surface a client needs: status,
 * branch listing, checkout and diff. It never interprets shell input: every
 * argument is passed to `git` as its own argv entry.
 *
 * @module hulala-server/api-git
 */
import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertRemoteCodecSpec, TypertRemoteParameterSpec } from '@deepseek-ai/dsh-typert-protocol'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import { z } from 'zod'

/** Parsed `git status --porcelain=v1 --branch` result. */
export interface GitStatus {
  branch: string
  changes: string[]
}

/** Local branches plus the checked-out branch. */
export interface GitBranches {
  current: string
  branches: string[]
}

function badRequest(message: string): RemoteError<'gateway/bad-request'> {
  return new RemoteError('gateway/bad-request', message, {})
}

function failed(message: string): RemoteError<'gateway/internal'> {
  return new RemoteError('gateway/internal', message, {})
}

/** Host-side Git service exported as the `hulalaGit` Remote namespace. */
export class HulalaGit extends TypertRemoteService {
  static inject: string[] = ['subprocess']

  constructor(ctx: Context) {
    super(ctx, 'hulalaGit')
  }

  private get subprocess(): SubprocessRuntime {
    return this.ctx.subprocess
  }

  /** Require an absolute, existing workspace directory. */
  private async workspace(workspaceRoot: string): Promise<string> {
    if (workspaceRoot.trim().length === 0) throw badRequest('workspaceRoot is required')
    if (!isAbsolute(workspaceRoot)) throw badRequest('workspaceRoot must be absolute')
    const path = resolve(workspaceRoot)
    const metadata = await stat(path).catch(() => undefined)
    if (metadata === undefined || !metadata.isDirectory()) throw badRequest(`workspace root is not a directory: ${workspaceRoot}`)
    return path
  }

  private async run(workspaceRoot: string, args: string[], signal?: AbortSignal): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    const cwd = await this.workspace(workspaceRoot)
    const process = this.subprocess.spawn({
      argv: ['git', '--no-pager', '-C', cwd, ...args],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 4 * 1024 * 1024 },
        stderr: { maxBytes: 1024 * 1024 },
      },
      graceMs: 5_000,
      ...(signal === undefined ? {} : { signal }),
    })
    const outcome = await process.done
    return {
      stdout: process.collected.stdout?.readFrom(0).text ?? '',
      stderr: process.collected.stderr?.readFrom(0).text ?? '',
      exitCode: outcome.exitCode,
    }
  }

  /** Read the current branch and porcelain change rows. */
  @Remote
  async status(workspaceRoot: string, signal?: AbortSignal): Promise<GitStatus> {
    const result = await this.run(workspaceRoot, ['status', '--porcelain=v1', '--branch'], signal)
    if (result.exitCode !== 0) throw failed(result.stderr.trim() || 'git status failed')
    const [head = '', ...changes] = result.stdout.trimEnd().split('\n')
    return {
      branch: head.replace(/^##\s*/u, '').split('...')[0] || 'HEAD',
      changes: changes.filter(Boolean),
    }
  }

  /** List local branches and identify the checked-out one. */
  @Remote
  async branches(workspaceRoot: string, signal?: AbortSignal): Promise<GitBranches> {
    const result = await this.run(workspaceRoot, ['branch', '--format=%(HEAD)%09%(refname:short)'], signal)
    if (result.exitCode !== 0) throw failed(result.stderr.trim() || 'git branch failed')
    const rows = result.stdout.trim().split('\n').filter(Boolean).map(row => {
      const separator = row.indexOf('\t')
      return separator < 0
        ? [row.trim(), row.trim()] as const
        : [row.slice(0, separator).trim(), row.slice(separator + 1).trim()] as const
    })
    return {
      current: rows.find(([marker]) => marker === '*')?.[1] ?? '',
      branches: rows.map(([, branch]) => branch).filter(branch => branch.length > 0),
    }
  }

  /** Switch to a local branch, optionally creating it first. */
  @Remote
  async checkout(workspaceRoot: string, branch: string, create?: boolean, signal?: AbortSignal): Promise<{ branch: string }> {
    if (!/^[A-Za-z0-9._/-]+$/u.test(branch) || branch.startsWith('-') || branch.includes('..')) {
      throw badRequest('branch name is invalid')
    }
    const result = await this.run(workspaceRoot, create === true ? ['switch', '-c', branch] : ['switch', branch], signal)
    if (result.exitCode !== 0) throw failed(result.stderr.trim() || 'git switch failed')
    return { branch }
  }

  /** Read a unified diff for the working tree or one workspace path. */
  @Remote
  async diff(workspaceRoot: string, path?: string, signal?: AbortSignal): Promise<{ patch: string }> {
    if (path !== undefined && (path.includes('\0') || isAbsolute(path) || path.split(/[\\/]/u).includes('..'))) {
      throw badRequest('path must be a relative path inside the workspace')
    }
    const args = path === undefined ? ['diff'] : ['diff', '--', path]
    const result = await this.run(workspaceRoot, args, signal)
    if (result.exitCode !== 0) throw failed(result.stderr.trim() || 'git diff failed')
    return { patch: result.stdout }
  }
}

/** Build one strict wire codec so Remote dispatch never depends on parameter names. */
function codec(create: () => z.ZodType, jsonSchema: Record<string, unknown>): TypertRemoteCodecSpec {
  return { mode: 'strict', typeSymbol: 'hulala-api-git', create: create as unknown as TypertRemoteCodecSpec['create'], jsonSchema }
}

/** Build one JSON parameter; `optional` keeps a missing wire field absent. */
function parameter(name: string, create: () => z.ZodType, jsonSchema: Record<string, unknown>, optional = false): TypertRemoteParameterSpec {
  const value = codec(create, jsonSchema)
  return { name, source: 'json', codec: value, strictCodec: value, ...(optional ? { acceptsUndefined: true as const } : {}) }
}

const workspaceParameter = parameter('workspaceRoot', () => z.string(), { type: 'string' })

const gitRemote = createTypertRemoteInfo({
  package: '@hulala/api-git',
  methods: {
    'hulalaGit/status': {
      service: 'hulalaGit',
      invocation: { kind: 'direct' },
      parameters: [workspaceParameter],
      cancellation: { parameter: 'signal' },
      result: codec(() => z.object({ branch: z.string(), changes: z.array(z.string()) }), {
        type: 'object',
        properties: { branch: { type: 'string' }, changes: { type: 'array', items: { type: 'string' } } },
        required: ['branch', 'changes'],
        additionalProperties: false,
      }),
    },
    'hulalaGit/branches': {
      service: 'hulalaGit',
      invocation: { kind: 'direct' },
      parameters: [workspaceParameter],
      cancellation: { parameter: 'signal' },
      result: codec(() => z.object({ current: z.string(), branches: z.array(z.string()) }), {
        type: 'object',
        properties: { current: { type: 'string' }, branches: { type: 'array', items: { type: 'string' } } },
        required: ['current', 'branches'],
        additionalProperties: false,
      }),
    },
    'hulalaGit/checkout': {
      service: 'hulalaGit',
      invocation: { kind: 'direct' },
      parameters: [
        workspaceParameter,
        parameter('branch', () => z.string(), { type: 'string' }),
        parameter('create', () => z.boolean(), { type: 'boolean' }, true),
      ],
      cancellation: { parameter: 'signal' },
      result: codec(() => z.object({ branch: z.string() }), {
        type: 'object',
        properties: { branch: { type: 'string' } },
        required: ['branch'],
        additionalProperties: false,
      }),
    },
    'hulalaGit/diff': {
      service: 'hulalaGit',
      invocation: { kind: 'direct' },
      parameters: [
        workspaceParameter,
        parameter('path', () => z.string(), { type: 'string' }, true),
      ],
      cancellation: { parameter: 'signal' },
      result: codec(() => z.object({ patch: z.string() }), {
        type: 'object',
        properties: { patch: { type: 'string' } },
        required: ['patch'],
        additionalProperties: false,
      }),
    },
  },
}, z as unknown as Parameters<typeof createTypertRemoteInfo>[1])

/** Stable Cordis plugin name. */
export const name = 'hulala-api-git'

/** Cordis plugin object loaded by the Host assembly. */
export const apiGitPlugin = {
  name,
  inject: ['typert'],
  async apply(ctx: Context): Promise<void> {
    await ctx.plugin(HulalaGit)
    const contribution: TypertContribution = {
      package: gitRemote.package,
      face: 'host',
      schemas: [],
      model: { services: [], events: [], objects: [] },
      invocations: gitRemote.descriptors,
    }
    ctx.effect(() => ctx.typert.register(contribution), 'hulala-api-git: Remote descriptors')
  },
}
