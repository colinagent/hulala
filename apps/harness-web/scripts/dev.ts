import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

const host = '127.0.0.1'
// Keep 5173 available for OpenBrain's desktop Vite process.
const preferredPort = Number.parseInt(process.env.LOOPWITHAI_VITE_PORT ?? '5174', 10)

if (!Number.isInteger(preferredPort) || preferredPort < 1 || preferredPort > 65_535) {
  throw new Error(`LOOPWITHAI_VITE_PORT must be a valid TCP port, received ${process.env.LOOPWITHAI_VITE_PORT}`)
}

async function available(port: number): Promise<boolean> {
  return await new Promise(resolve => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ host, port }, () => server.close(() => resolve(true)))
  })
}

async function selectPort(start: number): Promise<number> {
  for (let port = start; port < start + 50 && port <= 65_535; port += 1) {
    if (await available(port)) return port
  }
  throw new Error(`No available Vite port found from ${start} through ${Math.min(start + 49, 65_535)}`)
}

const vitePort = await selectPort(preferredPort)
if (vitePort === preferredPort) {
  console.log(`[dev] Vite HMR: http://${host}:${vitePort}`)
} else {
  console.log(`[dev] Port ${preferredPort} is busy; using Vite HMR http://${host}:${vitePort}`)
}

const child = spawn('npm', [
  'exec', '--', 'concurrently',
  '--kill-others',
  '--names', 'ui,harness',
  '--prefix-colors', 'cyan,green',
  `npm run dev:ui -- --port ${vitePort} --strictPort`,
  'npm run dev:server',
], {
  stdio: 'inherit',
  env: {
    ...process.env,
    LOOPWITHAI_UI_DEV_URL: `http://${host}:${vitePort}`,
  },
})

child.on('error', error => {
  console.error('[dev] Failed to start development processes:', error)
  process.exitCode = 1
})

const code = await new Promise<number | null>(resolve => child.once('exit', resolve))
if (code !== null) process.exitCode = code
