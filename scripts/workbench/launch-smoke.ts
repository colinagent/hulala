import { mkdtemp, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
async function port(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test port available')
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return address.port
}
const root = await mkdtemp(join(tmpdir(), 'hulala-cli-smoke-'))
const launcherPort = await port()
let workbenchPort = await port()
while (workbenchPort === launcherPort) workbenchPort = await port()
const repositoryRoot = join(import.meta.dir, '../..')
const child = Bun.spawn([process.execPath, join(repositoryRoot, 'apps/cli/src/main.ts'), '--foreground', ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, HULALA_REPOSITORY_ROOT: repositoryRoot, HULALA_HOME: join(root, 'state'), HULALA_WORKSPACE_ROOT: join(root, 'workspaces'), PI_CODING_AGENT_DIR: join(root, 'pi'), HULALA_PORT: String(launcherPort), HULALA_WORKBENCH_PORT: String(workbenchPort) },
  stdout: 'inherit', stderr: 'inherit',
})
const result = { pid: child.pid, root, launcherPort, workbenchPort, url: `http://hulala.localhost:${launcherPort}` }
await writeFile(join(tmpdir(), 'hulala-cli-smoke.json'), JSON.stringify(result))
console.log(JSON.stringify(result))
process.once('SIGTERM', () => child.kill('SIGTERM'))
process.once('SIGINT', () => child.kill('SIGINT'))
process.exitCode = await child.exited
