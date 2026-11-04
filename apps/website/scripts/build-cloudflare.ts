import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { runOrThrow } from '../../../scripts/lib/process'

const website = resolve(import.meta.dirname, '..')
const output = join(website, 'dist/cloudflare')
// The pre-render step needs the app's Request→Response entry; the Cloudflare
// plugin would replace it with the Worker, which has no bindings locally.
await runOrThrow(process.execPath, ['run', 'build'], { cwd: website, env: { ...process.env, HULALA_RENDER_ONLY: '1' } })
await rm(output, { recursive: true, force: true })
await cp(join(website, 'dist/client'), output, { recursive: true })
const port = await new Promise<number>((resolve, reject) => {
  const socket = createServer()
  socket.once('error', reject)
  socket.listen(0, '127.0.0.1', () => {
    const value = (socket.address() as { port: number }).port
    socket.close(error => error ? reject(error) : resolve(value))
  })
})
const vinextCli = join(dirname(createRequire(join(website, 'package.json')).resolve('vinext/package.json')), 'dist/cli.js')
const server = spawn(process.execPath, [vinextCli, 'start', '--port', String(port)], {
  cwd: website, env: process.env, stdio: ['ignore', 'ignore', 'inherit'],
})
const serverExit = new Promise<number>((resolveExit, reject) => {
  server.once('error', reject)
  server.once('close', (code) => resolveExit(code ?? 1))
})
try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error('Website rendering server exited')
    try { if ((await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break } } catch {}
    await sleep(100)
  }
  if (!ready) throw new Error('Website rendering server did not become ready')
  for (const route of ['/', '/download/', '/zh-CN/', '/zh-CN/download/', '/robots.txt', '/sitemap.xml']) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, { headers: { host: 'hulala.ai', 'x-forwarded-proto': 'https' } })
    const content = await response.text()
    if (!response.ok || content.includes(`127.0.0.1:${port}`)) throw new Error('Invalid rendered route: ' + route)
    if (route.endsWith('/') && (!content.includes('https://hulala.ai/install.sh') || !content.includes('Hulala'))) throw new Error('Missing terminal installation instructions')
    if (route.includes('/download/') && !content.includes('https://downloads.hulala.ai/hulala/desktop/')) throw new Error('Desktop download metadata was unavailable or still points to the old storage')
    const path = route.endsWith('/') ? join(output, route, 'index.html') : join(output, route)
    await mkdir(resolve(path, '..'), { recursive: true })
    await writeFile(path, content)
  }
} finally { server.kill(); await serverExit }
await writeFile(join(output, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n')
async function verify(directory: string): Promise<void> {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name)
    if (item.isSymbolicLink() || /\.(?:map|ts|tsx)$/.test(item.name) || item.name === '.git') throw new Error('Non-public asset in website output: ' + item.name)
    if (item.isDirectory()) await verify(path)
    else if (/\.(?:html|js|css|json|xml|txt)$/.test(item.name)) {
      const text = await readFile(path, 'utf8')
      if (/\/Users\/colin|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/.test(text)) throw new Error('Private build information in website output')
    }
  }
}
await verify(output)
console.log('Cloudflare static website prepared: ' + output)
