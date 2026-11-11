import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { lstat } from 'node:fs/promises'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {} from '@deepseek-ai/dsh-authorization'
import { createNativeHarnessPatch, harnessWebCommand, resolveRuntimePaths } from '../src/index'
import { bootRepositoryHarness, seedHostProfile } from '../src/in-process'
import { readCreatorMode, writeCreatorMode } from '../src/creator'

test('resolves every runtime path below an injected HULALA root', () => {
  const paths = resolveRuntimePaths({ root: '/tmp/hulala-runtime-test' })
  expect(paths.workspaceDir).toBe('/tmp/hulala-runtime-test/workspace')
  expect(Object.values(paths).every(path => path.startsWith('/tmp/hulala-runtime-test'))).toBeTrue()
})

test('composes one native DeepSeek Harness Agent Loop', () => {
  const patch = createNativeHarnessPatch()
  const serialized = JSON.stringify(patch)
  expect(serialized).toContain('@deepseek-ai/dsh-agent-loop')
  expect(serialized).toContain('@deepseek-ai/dsh-authorization')
  expect(serialized).not.toContain('agent-loop-selector')
  expect(serialized).not.toContain('agent-loop-pi')
  expect(serialized).not.toContain('network-proxy')
})

test('Desktop Runtime starts Harness without opening an external browser', () => {
  expect(harnessWebCommand('/bin/bun', '/runtime/dsh.js', '/tmp/profile.json', '127.0.0.1', 43140)).toEqual([
    '/bin/bun',
    '/runtime/dsh.js',
    'web',
    '--patch', '/tmp/profile.json',
    '--host', '127.0.0.1',
    '--port', '43140',
    '--no-open',
  ])
})

test('boots the public Harness profile in the caller process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-in-process-runtime-'))
  const repositoryRoot = join(import.meta.dir, '..', '..', '..')
  const runtime = await bootRepositoryHarness({
    repositoryRoot,
    paths: { root },
    environment: { DSH_TELEMETRY_DISABLED: '1' },
  })
  try {
    expect(runtime.state()).toBe('running')
    expect(runtime.ctx.get('sessions')).toBeDefined()
    expect(runtime.ctx.get('fileUploads')).toBeDefined()
    expect(runtime.ctx.get('sessionController')).toBeDefined()
    expect(runtime.ctx.get('authorization')).toBeDefined()
    expect(runtime.ctx.authorization.list().some(entry => entry.key === 'llm-pi-ai/openai-codex')).toBeTrue()
    expect(runtime.ctx.get('workspaceRegistry')).toBeDefined()
    expect(runtime.ctx.get('webServer')?.port).toBeGreaterThan(0)
    expect(runtime.ctx.get('connection')).toBeDefined()
    // Creator mode is opt-in, so a default boot has no inspect registry at all.
    expect(runtime.ctx.get('cordisInspect')).toBeUndefined()
  } finally {
    await runtime.stop()
    await rm(root, { recursive: true, force: true })
  }
  expect(runtime.state()).toBe('stopped')
})

test('the composition refuses a bundle that renamed an overridden row', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-runtime-rows-'))
  // A checkout whose bundle patch has lost `agent-loop`: the harness must refuse
  // to boot rather than silently keep the upstream loop alongside Hulala's.
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'hulala-runtime-rows-repo-'))
  try {
    await writeFile(join(repositoryRoot, 'package.json'), '{"name":"stale-bundle-check"}')
    const bundle = join(repositoryRoot, 'node_modules', '@deepseek-ai', 'dsh-base')
    await mkdir(bundle, { recursive: true })
    await writeFile(join(bundle, 'package.json'), '{"name":"@deepseek-ai/dsh-base","version":"0.0.0"}')
    await writeFile(join(bundle, 'cordis.patch.yml'), '- insert:\n    - id: workspace\n')
    await expect(bootRepositoryHarness({
      repositoryRoot,
      paths: { root },
      environment: { DSH_TELEMETRY_DISABLED: '1' },
    })).rejects.toThrow(/no longer declares "agent-loop"/u)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test('Creator mode adds the inspect registry, and turning it off removes it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-runtime-creator-'))
  const repositoryRoot = join(import.meta.dir, '..', '..', '..')
  const boot = async (): Promise<void> => {
    const runtime = await bootRepositoryHarness({
      repositoryRoot,
      paths: { root },
      environment: { DSH_TELEMETRY_DISABLED: '1' },
    })
    try {
      if (readCreatorMode(join(root, 'config'))) expect(runtime.ctx.get('cordisInspect')).toBeDefined()
      else expect(runtime.ctx.get('cordisInspect')).toBeUndefined()
    } finally {
      await runtime.stop()
    }
  }
  try {
    writeCreatorMode(join(root, 'config'), true)
    await boot()
    const profile = join(root, 'harness', 'profiles', 'tui', 'cordis.patch.yml')
    const on = await readFile(profile, 'utf8')
    expect(on).toContain('dsh-tool-cordis')
    expect(on).toContain('cordis-host-runner')

    // Off must strip it from a profile that already has it, not merely stop
    // adding it: the capability has to disappear.
    writeCreatorMode(join(root, 'config'), false)
    await boot()
    const off = await readFile(profile, 'utf8')
    expect(off).not.toContain('dsh-tool-cordis')
    expect(off).not.toContain('cordis-host-runner')
    expect(off).toContain('@deepseek-ai/dsh-agent-preset')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('refreshes agent presets from the installed bundle, not a frozen profile copy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-runtime-preset-'))
  const repositoryRoot = join(import.meta.dir, '..', '..', '..')
  const profile = join(root, 'harness', 'profiles', 'tui', 'cordis.patch.yml')
  try {
    const first = await bootRepositoryHarness({
      repositoryRoot,
      paths: { root },
      environment: { DSH_TELEMETRY_DISABLED: '1' },
    })
    await first.stop()
    // A profile seeded by an older bundle carries that bundle's whole preset,
    // including a tool row a newer release retired. Keeping the copy would make
    // every later boot fail the preset check instead of starting the agent.
    const patches = JSON.parse(await readFile(profile, 'utf8')) as Array<Record<string, unknown>>
    let injected = false
    for (const patch of patches) {
      if (!Array.isArray(patch.insert)) continue
      for (const row of patch.insert as Array<Record<string, unknown>>) {
        if (row.name !== '@deepseek-ai/dsh-agent-preset') continue
        const config = row.config as { plugins?: Array<Record<string, unknown>> }
        config.plugins = [...config.plugins ?? [], {
          id: 'tool-subagent-list-agents',
          name: '@deepseek-ai/dsh-tool-subagent-control/list-agents',
        }]
        injected = true
      }
    }
    expect(injected).toBe(true)
    await writeFile(profile, JSON.stringify(patches, null, 2), 'utf8')

    const second = await bootRepositoryHarness({
      repositoryRoot,
      paths: { root },
      environment: { DSH_TELEMETRY_DISABLED: '1' },
    })
    try {
      expect(second.state()).toBe('running')
    } finally {
      await second.stop()
    }
    expect(await readFile(profile, 'utf8')).not.toContain('tool-subagent-list-agents')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

test('replaces stale Host rows in an existing profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-runtime-profile-'))
  try {
    const first = await bootRepositoryHarness({
      repositoryRoot: join(import.meta.dir, '..', '..', '..'),
      paths: { root },
      environment: { DSH_TELEMETRY_DISABLED: '1' },
    })
    await first.stop()
    const profile = join(root, 'harness', 'profiles', 'tui', 'cordis.patch.yml')
    const patches = JSON.parse(await readFile(profile, 'utf8')) as Array<Record<string, unknown>>
    for (const patch of patches) {
      if (!Array.isArray(patch.insert)) continue
      for (const row of patch.insert as Array<Record<string, unknown>>) {
        if (row.id === 'agent-loop-runtime') row.name = '/stale/agent-loop-pi/lib/index.js'
      }
    }
    patches.push({ insert: [
      { id: 'hulala-network', name: '/stale/network-proxy/lib/index.js' },
      { id: 'agent-loop-selector', name: '/stale/agent-loop-selector/lib/index.js' },
      { id: 'schedule', name: '@deepseek-ai/dsh-schedule' },
    ] })
    await writeFile(profile, JSON.stringify(patches, null, 2), 'utf8')

    const second = await bootRepositoryHarness({
      repositoryRoot: join(import.meta.dir, '..', '..', '..'),
      paths: { root },
      environment: { DSH_TELEMETRY_DISABLED: '1' },
    })
    try {
      expect(second.ctx.get('networkProxy' as never)).toBeUndefined()
      expect(second.ctx.get('agentLoopSelector' as never)).toBeUndefined()
      expect(second.ctx.get('schedule' as never)).toBeUndefined()
    } finally {
      await second.stop()
    }
    const text = await readFile(profile, 'utf8')
    expect(text).not.toContain('/stale/')
    expect(text).not.toContain('hulala-network')
    expect(text).not.toContain('agent-loop-selector')
    expect(text).not.toContain('"id": "schedule"')
    expect(text).toContain('@deepseek-ai/dsh-agent-loop')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

test('links the bundles the user installed into their own DSH profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-detect-'))
  const userHome = join(root, 'dsh-home')
  const repositoryRoot = join(import.meta.dir, '..', '..', '..')
  const previous = process.env.HULALA_DSH_DETECT_HOME
  process.env.HULALA_DSH_DETECT_HOME = userHome
  try {
    const theirProfile = join(userHome, 'profiles', 'tui')
    const bundle = join(theirProfile, 'node_modules', 'demo-plugin')
    await mkdir(bundle, { recursive: true })
    await writeFile(join(bundle, 'package.json'), '{"name":"demo-plugin","version":"1.0.0"}')
    await writeFile(join(theirProfile, 'package.json'), JSON.stringify({
      name: 'dsh-profile-tui', private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'demo-plugin'] } },
    }))

    const paths = resolveRuntimePaths({ root })
    const profileDir = await seedHostProfile(paths, repositoryRoot)
    const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
      hulala?: { detected?: string[] }
    }
    expect(manifest.dsh?.profile?.bundles).toContain('demo-plugin')
    expect(manifest.dependencies?.['demo-plugin']).toBe(`link:${bundle}`)
    expect(manifest.hulala?.detected).toEqual(['demo-plugin'])
    expect((await lstat(join(profileDir, 'node_modules', 'demo-plugin'))).isSymbolicLink()).toBeTrue()

    // The user removes it from DSH: the next seed drops the link again.
    await rm(bundle, { recursive: true, force: true })
    await writeFile(join(theirProfile, 'package.json'), JSON.stringify({
      name: 'dsh-profile-tui', private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
    }))
    const again = await seedHostProfile(paths, repositoryRoot)
    const refreshed = JSON.parse(await readFile(join(again, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    expect(refreshed.dsh?.profile?.bundles).not.toContain('demo-plugin')
    await expect(lstat(join(again, 'node_modules', 'demo-plugin'))).rejects.toThrow()
  } finally {
    if (previous === undefined) delete process.env.HULALA_DSH_DETECT_HOME
    else process.env.HULALA_DSH_DETECT_HOME = previous
    await rm(root, { recursive: true, force: true })
  }
})
