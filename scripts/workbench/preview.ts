import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startBrowserServer } from '../../apps/local-host/src/browser/server'

const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
const root = argument('--root') ? resolve(argument('--root')!) : await mkdtemp(join(tmpdir(), 'hulala-browser-preview-'))
const port = Number(argument('--port') || 0)
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid preview port')
process.env.PI_CODING_AGENT_DIR = join(root, 'pi')
const repositoryRoot = join(import.meta.dir, '../..')
const server = await startBrowserServer({ repositoryRoot, hulalaRoot: join(root, 'state'), workspaceRoot: join(root, 'workspaces'), version: '0.1.5', port, publicPort: port, webDirectory: argument('--web') ? resolve(argument('--web')!) : join(repositoryRoot, 'apps/workbench/dist'), settingsDirectory: join(repositoryRoot, 'apps/workbench/settings') })
const result = { pid: process.pid, port: server.server.port, root, url: `http://hulala.localhost:${server.server.port}` }
await writeFile(join(tmpdir(), 'hulala-browser-preview.json'), JSON.stringify(result))
console.log(JSON.stringify(result))
const stop = async () => { await server.stop(); process.exit(0) }
process.once('SIGINT', () => void stop())
process.once('SIGTERM', () => void stop())
