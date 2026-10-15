import { afterEach, expect, test } from 'bun:test'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalPluginManager, type PluginServices } from '../src/localPlugins/manager.ts'
import { pluginManifestSchema } from '../src/localPlugins/manifest.ts'
const roots: string[] = [], managers: LocalPluginManager[] = [], contexts: Context[] = []
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.stop()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const services: PluginServices = {
  ai: { currentModel: async () => ({ provider: 'fixture', model: 'test' }), analyze: async () => ({ text: '{}', model: { provider: 'fixture', model: 'test' } }) },
  secrets: () => ({ resolve: async () => undefined, describe: async () => ({ configured: false }), set: async () => {}, unset: async () => {} }),
}
async function fixture(customServices = services) {
  const root = await mkdtemp(join(tmpdir(), 'hulala-local-plugin-test-')); roots.push(root)
  const source = join(root, 'source'); await mkdir(source)
  const result = await Bun.build({ entrypoints: [join(import.meta.dir, 'fixtures/local-plugin.ts')], outdir: source, naming: 'backend.js', target: 'bun', format: 'esm' })
  if (!result.success) throw new AggregateError(result.logs)
  await writeFile(join(source, 'ui.js'), 'export function activate() {}')
  const manifest = { id: 'probe', name: 'Probe', version: '1.0.0', apiVersion: 1, backend: 'backend.js', ui: 'ui.js' }
  await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest))
  const ctx = new Context(); contexts.push(ctx)
  const manager = new LocalPluginManager(join(root, 'state'), ctx, customServices); managers.push(manager)
  await manager.initialize()
  return { root, source, manager, manifest }
}
test('install stays disabled; enable is idempotent; disable drains requests and releases plugin resources', async () => {
  const { root, source, manager } = await fixture()
  const plugin = await manager.install(source)
  expect(plugin.state).toBe('disabled')
  await manager.enable('probe', true); await manager.enable('probe', true)
  expect(await manager.rpc('probe', 'count', null)).toBe(1)
  await expect(manager.rpc('probe', 'validated', 'invalid')).rejects.toThrow('number required')
  expect(await manager.rpc('probe', 'validated', 2)).toBe(3)
  const waiting = manager.rpc('probe', 'wait', null)
  await Bun.sleep(1)
  await manager.enable('probe', false)
  expect(await waiting).toBe('aborted')
  expect(await readFile(join(root, 'state/server/plugins/probe/disposed'), 'utf8')).toBe('yes')
  await expect(manager.rpc('probe', 'count', null)).rejects.toThrow()
})
test('enabled plugins restore on restart, uninstall preserves user data', async () => {
  const { root, source, manager } = await fixture()
  await manager.install(source); await manager.enable('probe', true); await manager.stop()
  const ctx = new Context(); contexts.push(ctx)
  const next = new LocalPluginManager(join(root, 'state'), ctx, services); managers.push(next)
  await next.initialize()
  expect(await next.rpc('probe', 'count', null)).toBe(2)
  await next.uninstall('probe')
  expect(next.list()).toHaveLength(0)
  expect(await readFile(join(root, 'state/config/plugins/probe.json'), 'utf8')).toContain('2')
})
test('failed update rolls back to last installed revision and leaves it running', async () => {
  const { source, manager, manifest } = await fixture()
  const old = await manager.install(source); await manager.enable('probe', true)
  await writeFile(join(source, 'manifest.json'), JSON.stringify({ ...manifest, version: '2.0.0' }))
  await writeFile(join(source, 'backend.js'), 'export function activate() { throw new Error("fixture activation failure") }')
  await expect(manager.install(source)).rejects.toThrow('fixture activation failure')
  expect(manager.list()[0]?.revision).toBe(old.revision)
  expect(manager.list()[0]?.state).toBe('active')
  expect(await manager.rpc('probe', 'count', null)).toBe(2)
})
test('rejects incompatible SDK, traversal, symbolic links and backend asset exposure', async () => {
  expect(() => pluginManifestSchema.parse({ id: 'bad', name: 'Bad', version: '1.0.0', apiVersion: 2, backend: '../host.js', ui: 'ui.js' })).toThrow()
  expect(() => pluginManifestSchema.parse({ id: 'bad', name: 'Bad', version: '1.0.0', apiVersion: 1, backend: 'shared.js', ui: 'shared.js' })).toThrow()
  const { root, source, manager } = await fixture()
  await symlink(join(root, 'state'), join(source, 'linked'))
  await expect(manager.install(source)).rejects.toThrow('symbolic')
  await rm(join(source, 'linked'))
  const item = await manager.install(source); await manager.enable('probe', true)
  expect(await manager.asset('probe', item.revision, 'ui.js')).toContain('ui.js')
  await expect(manager.asset('probe', item.revision, 'backend.js')).rejects.toThrow('not exposed')
  await expect(manager.asset('probe', item.revision, '../backend.js')).rejects.toThrow()
  await expect(manager.asset('probe', 'wrong-version', 'ui.js')).rejects.toThrow()
})

test('renderer activation failure restores the previous package, stale failure cannot revert a newer install', async () => {
  const { source, manager, manifest } = await fixture()
  const old = await manager.install(source); await manager.enable('probe', true)
  await writeFile(join(source, 'manifest.json'), JSON.stringify({ ...manifest, version: '1.1.0' }))
  const updated = await manager.install(source)
  expect(await manager.rollback('probe', old.revision)).toEqual({ restored: false })
  expect(manager.list()[0]?.revision).toBe(updated.revision)
  expect(await manager.rollback('probe', updated.revision)).toEqual({ restored: true })
  expect(manager.list()[0]?.revision).toBe(old.revision)
  expect(manager.list()[0]?.state).toBe('active')
})
test('invalid UI module cannot replace the installed plugin', async () => {
  const { source, manager } = await fixture()
  const old = await manager.install(source); await manager.enable('probe', true)
  await writeFile(join(source, 'ui.js'), 'export function activate( {')
  await expect(manager.install(source)).rejects.toThrow()
  expect(manager.list()[0]?.revision).toBe(old.revision)
  expect(manager.list()[0]?.state).toBe('active')
})

test('plugin secrets cannot be returned through RPC/events/logs or written to ordinary settings', async () => {
  let secret: string | undefined
  const { root, source, manager } = await fixture({ ...services, secrets: () => ({ resolve: async () => secret, describe: async () => ({ configured: !!secret }), set: async (_name, value) => { secret = value }, unset: async () => { secret = undefined } }) })
  await manager.install(source); await manager.enable('probe', true)
  await manager.setSecret('probe', 'token', 'synthetic-secret-value')
  await expect(manager.rpc('probe', 'secret-probe', 'echo')).rejects.toThrow('configured secret')
  await expect(manager.rpc('probe', 'secret-probe', 'settings')).rejects.toThrow('configured secret')
  await manager.rpc('probe', 'secret-probe', 'events')
  expect(JSON.stringify(manager.events(0))).not.toContain(secret!)
  expect(await readFile(join(root, 'state/config/plugins/probe.json'), 'utf8')).not.toContain(secret!)
})

test('plugin installations and background state belong to their Workspace', async () => {
  const { root, source } = await fixture()
  const aCtx = new Context(), bCtx = new Context(); contexts.push(aCtx, bCtx)
  const a = new LocalPluginManager(join(root, 'state'), aCtx, services, crypto.randomUUID())
  const b = new LocalPluginManager(join(root, 'state'), bCtx, services, crypto.randomUUID()); managers.push(a, b)
  await a.initialize(); await b.initialize()
  await a.install(source); await a.enable('probe', true)
  expect(b.list()).toEqual([])
  await b.install(source); await b.enable('probe', true)
  expect(await a.rpc('probe', 'count', null)).toBe(1)
  expect(await b.rpc('probe', 'count', null)).toBe(1)
  await a.uninstall('probe')
  expect(await b.rpc('probe', 'count', null)).toBe(1)
})
