import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { availablePort } from '../../apps/cli/src/distribution/validate'
import { fileSha256 } from '@hulala/distribution/archive'
import { verifyPackage } from './package-manifest'

if (!process.argv[2] || !process.argv[3]) throw new Error('Pass current and next native packages')
const initial = resolve(process.argv[2]), candidate = resolve(process.argv[3]), firstManifest = await verifyPackage(initial), nextManifest = await verifyPackage(candidate)
const temp = await mkdtemp(join(tmpdir(), 'hulala update 中文 ')), state = join(temp, 'state'), root = join(temp, 'program'), bin = join(temp, 'bin'), workspace = join(temp, 'workspaces')
const port = await availablePort(), backend = await availablePort(), origin = `http://127.0.0.1:${port}`
const archive = candidate + '.tar.gz', archiveSha256 = await fileSha256(archive), manifestSha256 = await fileSha256(join(candidate, 'manifest.json'))
let index: unknown
const mirror = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: request => new URL(request.url).pathname === '/package.tar.gz' ? new Response(Bun.file(archive)) : Response.json(index) })
index = { format: 1, product: 'hulala', channels: { stable: nextManifest.version }, releases: [{ version: nextManifest.version, dataFormat: 1, platforms: { [nextManifest.target]: { url: `http://127.0.0.1:${mirror.port}/package.tar.gz`, sha256: archiveSha256, manifestSha256 } } }] }
const env = { ...process.env, HULALA_HOME: state, HULALA_WORKSPACE_ROOT: workspace, PI_CODING_AGENT_DIR: join(temp, 'pi'), HULALA_PORT: String(port), HULALA_WORKBENCH_PORT: String(backend), HULALA_NO_OPEN: '1', HULALA_RELEASE_INDEX_URL: `http://127.0.0.1:${mirror.port}/index`, HULALA_INSTALL_ROOT: undefined, HULALA_PACKAGE_ROOT: undefined }
const command = join(bin, process.platform === 'win32' ? 'hulala.exe' : 'hulala')
const run = async (executable: string, args: string[], succeeds = true) => {
  const child = Bun.spawn([executable, ...args], { cwd: temp, env, stdout: 'pipe', stderr: 'pipe' })
  const out = new Response(child.stdout).text(), err = new Response(child.stderr).text(), code = await child.exited
  const text = (await out) + (await err)
  if (succeeds ? code !== 0 : code === 0) throw new Error(`Update command returned ${code}: ${text.slice(-5000)}`)
  return text
}
const health = async () => { try { return await (await fetch(origin + '/api/hulala/health', { signal: AbortSignal.timeout(1000) })).json() as any } catch { return undefined } }
let pid: number | undefined
try {
  await mkdir(join(state, 'config'), { recursive: true }); await writeFile(join(state, 'config/user-preserved.txt'), 'unchanged')
  await run(join(initial, firstManifest.entrypoint), ['install', '--root', root, '--bin', bin])
  await run(command, ['--no-open']); pid = (await health())?.pid
  await run(command, ['update', '--from', archive, '--sha256', '0'.repeat(64)], false)
  if ((await health())?.pid !== pid || (await run(command, ['--version'])).trim() !== firstManifest.version) throw new Error('A damaged update changed the active service')
  await run(command, ['update'])
  const upgraded = await health(); pid = upgraded?.pid
  if (upgraded?.version !== nextManifest.version || (await run(command, ['--version'])).trim() !== nextManifest.version) throw new Error('The channel update did not activate and restart the matching version')
  await run(command, ['rollback'])
  const rolledBack = await health(); pid = rolledBack?.pid
  if (rolledBack?.version !== firstManifest.version || (await run(command, ['--version'])).trim() !== firstManifest.version) throw new Error('Rollback did not restore the previous working version')
  await writeFile(join(state, 'server/browser-data-format.json'), '{"format":2}')
  await run(command, ['rollback'], false)
  if ((await health())?.pid !== pid) throw new Error('An incompatible rollback stopped the active service')
  await writeFile(join(state, 'server/browser-data-format.json'), '{"format":1}')
  if (await readFile(join(state, 'config/user-preserved.txt'), 'utf8') !== 'unchanged') throw new Error('Update changed user data')
  await run(command, ['service', 'shutdown']); pid = undefined
  console.log(JSON.stringify({ channelUpdate: true, versions: [firstManifest.version, nextManifest.version], corruptUpdateRetainsService: true,
    atomicActivation: true, stableLauncherTracksVersion: true, rollbackRestartsPreviousVersion: true, incompatibleDataRollbackRefused: true, userDataPreserved: true }))
} finally {
  mirror.stop(true)
  if (pid) { try { process.kill(pid, 'SIGTERM') } catch {}; await Bun.sleep(1000) }
  await rm(temp, { recursive: true, force: true })
}
