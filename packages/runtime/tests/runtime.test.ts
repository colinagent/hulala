import { expect, test } from 'bun:test'
import { lstat } from 'node:fs/promises'
import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveRuntimePaths } from '../src/index'
import { bootRepositoryHarness, seedHostProfile } from '../src/in-process'
import { readCreatorMode, writeCreatorMode } from '../src/creator'
import { bootInNode } from './support/nodeBoot'

const REPOSITORY_ROOT = join(import.meta.dir, '..', '..', '..')

/** The profile manifest a boot seeds. */
async function readProfileManifest(root: string): Promise<{
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}> {
  return JSON.parse(await readFile(join(root, 'harness', 'profiles', 'tui', 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    dsh?: { profile?: { bundles?: string[] } }
  }
}

test('resolves every runtime path below an injected HULALA root', () => {
  const paths = resolveRuntimePaths({ root: '/tmp/hulala-runtime-test' })
  expect(paths.workspaceDir).toBe('/tmp/hulala-runtime-test/workspace')
  expect(Object.values(paths).every(path => path.startsWith('/tmp/hulala-runtime-test'))).toBeTrue()
})

test('composes the Host from DSH\'s own profile bundles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-runtime-bundles-'))
  try {
    const paths = resolveRuntimePaths({ root })
    const profileDir = await seedHostProfile(paths, REPOSITORY_ROOT)
    // DSH's `web` profile template, plus the one bundle this Host adds.
    expect((await readProfileManifest(root)).dsh?.profile?.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@colinagent/dsh-mcp',
    ])
    // Nothing of ours re-declares a bundle row: the profile patch holds only
    // id-level overrides, so no upstream row is duplicated or frozen here.
    const patch = JSON.parse(await readFile(join(profileDir, 'cordis.patch.yml'), 'utf8')) as Array<Record<string, unknown>>
    expect(patch.every(entry => Array.isArray(entry.insert) === false)).toBeTrue()
    expect(patch.map(entry => entry.id)).toEqual([
      'plugin-package-inventory-deepseek',
      'session-log-deepseek',
      'cordis-host-runner',
      'cordis-inspect-providers',
    ])
    expect(JSON.stringify(patch)).not.toContain('agent-loop')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('boots the public Harness profile through DSH\'s own profile boot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-in-process-runtime-'))
  // DSH's profile boot needs Node's module internals, so the Host runs where it
  // runs in production: its own Node process, not the Bun test runner.
  const runtime = await bootInNode({
    root,
    services: ['sessions', 'fileUploads', 'sessionController', 'authorization', 'workspaceRegistry', 'connection', 'cordisInspect'],
  })
  try {
    expect(runtime.report.state).toBe('running')
    expect(runtime.report.services).toEqual({
      sessions: true,
      fileUploads: true,
      sessionController: true,
      authorization: true,
      workspaceRegistry: true,
      connection: true,
      // Creator mode is opt-in, so a default boot has no inspect registry at all.
      cordisInspect: false,
    })
    expect(runtime.report.authorizationKeys).toContain('llm-pi-ai/openai-codex')
    expect(runtime.report.webServerPort).toBeGreaterThan(0)
  } finally {
    await runtime.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('the composition refuses a bundle that renamed an overridden row', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-runtime-rows-'))
  // An installation whose bundle patch has lost a row this Host overrides: the
  // boot must refuse rather than let the Loader skip the override in silence.
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'hulala-runtime-rows-repo-'))
  try {
    await writeFile(join(repositoryRoot, 'package.json'), '{"name":"stale-bundle-check"}')
    for (const [name, rows] of [
      ['dsh-base', ['workspace']],
      ['dsh-web-app', ['cordis-host-runner', 'cordis-inspect-providers']],
    ] as const) {
      const bundle = join(repositoryRoot, 'node_modules', '@deepseek-ai', name)
      await mkdir(bundle, { recursive: true })
      await writeFile(join(bundle, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${name}`, version: '0.0.0' }))
      await writeFile(join(bundle, 'cordis.patch.yml'), `- insert:\n${rows.map(id => `    - id: ${id}\n`).join('')}`)
    }
    await expect(bootRepositoryHarness({
      repositoryRoot,
      paths: { root },
      environment: { DSH_TELEMETRY_DISABLED: '1' },
    })).rejects.toThrow(/no profile bundle declares .*session-log-deepseek/u)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(repositoryRoot, { recursive: true, force: true })
  }
})

test('Creator mode adds the inspect registry, and turning it off removes it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-runtime-creator-'))
  const boot = async (): Promise<void> => {
    const runtime = await bootInNode({ root, services: ['cordisInspect'] })
    try {
      expect(runtime.report.services.cordisInspect).toBe(readCreatorMode(join(root, 'config')))
    } finally {
      await runtime.stop()
    }
  }
  try {
    const profile = join(root, 'harness', 'profiles', 'tui', 'cordis.patch.yml')
    /** Whether the profile patch disables the Creator-mode rows. */
    const creatorRowsDisabled = async (): Promise<boolean> => {
      const patch = JSON.parse(await readFile(profile, 'utf8')) as Array<{ id?: string; disabled?: boolean }>
      const rows = patch.filter(entry => entry.id === 'cordis-host-runner' || entry.id === 'cordis-inspect-providers')
      expect(rows).toHaveLength(2)
      expect(rows[0]?.disabled).toBe(rows[1]?.disabled)
      return rows[0]?.disabled === true
    }

    writeCreatorMode(join(root, 'config'), true)
    await boot()
    expect(await creatorRowsDisabled()).toBe(false)

    // Off must disable the rows a profile already enabled, not merely stop
    // enabling them: the capability has to disappear.
    writeCreatorMode(join(root, 'config'), false)
    await boot()
    expect(await creatorRowsDisabled()).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

test('prunes agent presets an older Host copied into the profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-runtime-preset-'))
  const profile = join(root, 'harness', 'profiles', 'tui', 'cordis.patch.yml')
  try {
    const first = await bootInNode({ root })
    await first.stop()
    // A profile seeded by an older Host carries its own copy of the presets,
    // including a tool row a newer release retired. Keeping the copy would make
    // every later boot fail the preset check instead of starting the agent; the
    // bundle owns the declarations, so the copy is pruned.
    const patches = JSON.parse(await readFile(profile, 'utf8')) as Array<Record<string, unknown>>
    patches.push({ insert: [{
      id: 'preset-legacy',
      name: '@deepseek-ai/dsh-agent-preset',
      config: { plugins: [{ id: 'tool-subagent-list-agents', name: '@deepseek-ai/dsh-tool-subagent-control/list-agents' }] },
    }] })
    await writeFile(profile, JSON.stringify(patches, null, 2), 'utf8')

    const second = await bootInNode({ root })
    try {
      expect(second.report.state).toBe('running')
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
    const first = await bootInNode({ root })
    await first.stop()
    const profile = join(root, 'harness', 'profiles', 'tui', 'cordis.patch.yml')
    const patches = JSON.parse(await readFile(profile, 'utf8')) as Array<Record<string, unknown>>
    // A profile written by an older Host still declares rows the bundles own
    // today (and the loop this repository used to insert under its own id).
    patches.push({ insert: [
      { id: 'workspace', name: '/stale/workspace/lib/index.js' },
      { id: 'agent-loop-runtime', name: '/stale/agent-loop-pi/lib/index.js' },
      { id: 'hulala-network', name: '/stale/network-proxy/lib/index.js' },
      { id: 'agent-loop-selector', name: '/stale/agent-loop-selector/lib/index.js' },
    ] })
    await writeFile(profile, JSON.stringify(patches, null, 2), 'utf8')

    const second = await bootInNode({ root, services: ['networkProxy', 'agentLoopSelector', 'workspaceRegistry', 'schedule'] })
    try {
      expect(second.report.services.networkProxy).toBeFalse()
      expect(second.report.services.agentLoopSelector).toBeFalse()
      // The rows the bundles own still mount, from the bundle this time.
      expect(second.report.services.workspaceRegistry).toBeTrue()
      expect(second.report.services.schedule).toBeTrue()
    } finally {
      await second.stop()
    }
    const text = await readFile(profile, 'utf8')
    expect(text).not.toContain('/stale/')
    expect(text).not.toContain('hulala-network')
    expect(text).not.toContain('agent-loop-selector')
    expect(text).not.toContain('"id": "workspace"')
    expect(text).toContain('"id": "session-log-deepseek"')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

test('repairs a bundle link an older runtime left dangling', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-runtime-relink-'))
  try {
    const paths = resolveRuntimePaths({ root })
    const profileDir = await seedHostProfile(paths, REPOSITORY_ROOT)
    const link = join(profileDir, 'node_modules', '@colinagent', 'dsh-mcp')
    const source = await readlink(link)
    // The profile a pruned runtime leaves behind: a link into a version tree
    // that no longer exists, plus the `link:` spec that named it. `access`
    // follows the link, so the old presence check saw "absent" while the entry
    // still occupied the path and creation failed with EEXIST.
    const pruned = join(profileDir, 'node_modules', '.pruned-runtime-version', '@colinagent', 'dsh-mcp')
    await rm(link, { force: true })
    await symlink(pruned, link, 'dir')
    const manifestPath = join(profileDir, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { dependencies: Record<string, string> }
    manifest.dependencies['@colinagent/dsh-mcp'] = `link:${pruned}`
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

    const again = await seedHostProfile(paths, REPOSITORY_ROOT)
    expect(await readlink(join(again, 'node_modules', '@colinagent', 'dsh-mcp'))).toBe(source)
    expect((await readProfileManifest(root)).dependencies?.['@colinagent/dsh-mcp']).toBe(`link:${source}`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('links the bundles the user installed into their own DSH profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-detect-'))
  const userHome = join(root, 'dsh-home')
  const repositoryRoot = REPOSITORY_ROOT
  const previous = process.env.HULALA_DSH_DETECT_HOME
  process.env.HULALA_DSH_DETECT_HOME = userHome
  try {
    const theirProfile = join(userHome, 'profiles', 'tui')
    const bundle = join(theirProfile, 'node_modules', 'demo-plugin')
    await mkdir(bundle, { recursive: true })
    await writeFile(join(bundle, 'package.json'), '{"name":"demo-plugin","version":"1.0.0"}')
    // Their own copy of a bundle this Host composes from its runtime: linking it
    // would shadow the pinned version with whatever their DSH install resolved.
    const shadowed = join(theirProfile, 'node_modules', '@deepseek-ai', 'dsh-web-app')
    await mkdir(shadowed, { recursive: true })
    await writeFile(join(shadowed, 'package.json'), '{"name":"@deepseek-ai/dsh-web-app","version":"0.0.0"}')
    await writeFile(join(theirProfile, 'package.json'), JSON.stringify({
      name: 'dsh-profile-tui', private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'demo-plugin'] } },
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
    // The Host's own composition comes from the runtime, not from the user's DSH.
    expect(manifest.dependencies?.['@deepseek-ai/dsh-web-app']).toBeUndefined()
    await expect(lstat(join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-web-app'))).rejects.toThrow()
    expect(manifest.dsh?.profile?.bundles).toContain('@deepseek-ai/dsh-web-app')
    expect(manifest.hulala?.detected).toEqual(['demo-plugin'])
    // The Host's own bundle comes from the runtime, not from the user's DSH.
    expect(manifest.dsh?.profile?.bundles).toContain('@colinagent/dsh-mcp')
    expect(manifest.dependencies?.['@colinagent/dsh-mcp']).toMatch(/^link:/u)
    expect((await lstat(join(profileDir, 'node_modules', '@colinagent', 'dsh-mcp'))).isSymbolicLink()).toBeTrue()
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
    // Removing a user-installed bundle must not take the Host's own bundle with it.
    expect(refreshed.dsh?.profile?.bundles).toContain('@colinagent/dsh-mcp')
  } finally {
    if (previous === undefined) delete process.env.HULALA_DSH_DETECT_HOME
    else process.env.HULALA_DSH_DETECT_HOME = previous
    await rm(root, { recursive: true, force: true })
  }
})
