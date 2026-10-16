import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startBrowserServer } from '../../apps/local-host/src/browser/server'
import { sshFixture, FixtureSecrets } from '../../apps/local-host/tests/fixtures/ssh-server'

const [packagePath, webPath] = process.argv.slice(2)
if (!packagePath || !webPath) throw new Error('Pass the remote platform package directory and a separate built web directory')
const root = await mkdtemp(join(tmpdir(), 'hulala-browser-ssh-preview-'))
await mkdir(join(root, 'remote'))
await mkdir(join(root, 'local-home/.ssh'), { recursive: true })
process.env.PI_CODING_AGENT_DIR = join(root, 'pi')
const fixture = await sshFixture(join(root, 'remote'))
const second = join(fixture.home, '项目 B')
await mkdir(second)
await writeFile(join(second, 'hello.md'), '# Remote Workspace B\n\nSynthetic browser SSH fixture.\n')
const repositoryRoot = join(import.meta.dir, '../..')
const server = await startBrowserServer({ repositoryRoot, hulalaRoot: join(root, 'state'), workspaceRoot: join(root, 'workspaces'), version: '0.1.5',
  port: 0, publicPort: 0, webDirectory: resolve(webPath), settingsDirectory: join(repositoryRoot, 'apps/workbench/settings'),
  remotePackagesDirectory: resolve(packagePath), sshHome: join(root, 'local-home'), sshSecrets: new FixtureSecrets(),
})
const result = { pid: process.pid, port: server.server.port, root, url: `http://hulala.localhost:${server.server.port}`, sshPort: fixture.port, second }
await writeFile(join(tmpdir(), 'hulala-ssh-preview.json'), JSON.stringify(result))
console.log(JSON.stringify(result))
let stopping = false
const stop = async () => { if (stopping) return; stopping = true; await server.stop(); await fixture.stop(); process.exit(0) }
process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop())
