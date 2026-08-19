import { createRequire } from 'node:module'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface RuntimePaths {
  root: string
  configDir: string
  dataDir: string
  workspaceDir: string
  runtimeDir: string
  logsDir: string
  cacheDir: string
}

export interface RuntimeDescriptor {
  id: string
  name: string
  package: string
}

export interface RuntimeProfileOptions {
  defaultRuntime: string
  runtimes: RuntimeDescriptor[]
  networkPlugin?: string
  selectorPlugin: string
  bunLifecyclePlugin?: string
}

export interface StartRuntimeOptions {
  host?: '127.0.0.1'
  port?: number
  paths?: Partial<RuntimePaths> & { root?: string }
  patch: unknown[]
  version?: string
  startupTimeoutMs?: number
  environment?: Record<string, string | undefined>
  stdout?: 'inherit' | 'pipe'
  stderr?: 'inherit' | 'pipe'
}

export type RuntimeState = 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'

export interface RuntimeHandle {
  readonly host: '127.0.0.1'
  readonly port: number
  readonly url: string
  readonly paths: RuntimePaths
  state(): RuntimeState
  stop(): Promise<void>
  exited: Promise<number>
}

export function resolveRuntimePaths(
  input: Partial<RuntimePaths> & { root?: string } = {},
): RuntimePaths {
  const root = resolve(input.root ?? process.env.LWA_HOME ?? join(homedir(), '.config', 'lwa'))
  return {
    root,
    configDir: resolve(input.configDir ?? join(root, 'config')),
    dataDir: resolve(input.dataDir ?? join(root, 'server')),
    workspaceDir: resolve(input.workspaceDir ?? join(root, 'workspace')),
    runtimeDir: resolve(input.runtimeDir ?? join(root, 'runtime')),
    logsDir: resolve(input.logsDir ?? join(root, 'logs')),
    cacheDir: resolve(input.cacheDir ?? join(root, 'cache')),
  }
}

export async function ensureRuntimePaths(paths: RuntimePaths): Promise<void> {
  await Promise.all(Object.entries(paths)
    .filter(([name]) => name !== 'root')
    .map(([, path]) => mkdir(path, { recursive: true, mode: 0o700 })))
}

export function createHarnessPatch(options: RuntimeProfileOptions): unknown[] {
  if (!options.runtimes.some(runtime => runtime.id === options.defaultRuntime)) {
    throw new Error(`unknown default runtime "${options.defaultRuntime}"`)
  }
  const defaultDescriptor = options.runtimes.find(runtime => runtime.id === options.defaultRuntime)!
  const insert: unknown[] = []
  if (options.bunLifecyclePlugin) insert.push({ id: 'loopwithai-bun-lifecycle', name: options.bunLifecyclePlugin })
  if (options.networkPlugin) insert.push({ id: 'loopwithai-network', name: options.networkPlugin })
  insert.push(
    { id: 'agent-loop-runtime', name: defaultDescriptor.package },
    {
      id: 'agent-loop-selector',
      name: options.selectorPlugin,
      config: {
        defaultRuntime: options.defaultRuntime,
        entryId: 'agent-loop-runtime',
        runtimes: Object.fromEntries(options.runtimes.map(runtime => [runtime.id, {
          name: runtime.name,
          package: runtime.package,
        }])),
      },
    },
  )
  return [
    { id: 'agent-loop', disabled: true },
    // DeepSeek's optional code-mode worker currently imports Node-only
    // stripTypeScriptTypes. LoopWithAI uses native tool presentation under Bun.
    { id: 'code-runtime', disabled: true },
    { insert },
  ]
}

function repositoryPlugin(repositoryRoot: string, packageDirectory: string): string {
  return pathToFileURL(resolve(repositoryRoot, 'packages', packageDirectory, 'lib', 'index.js')).href
}

export function createRepositoryHarnessPatch(repositoryRoot: string): unknown[] {
  return createHarnessPatch({
    defaultRuntime: 'pi',
    networkPlugin: repositoryPlugin(repositoryRoot, 'network-proxy'),
    selectorPlugin: repositoryPlugin(repositoryRoot, 'agent-loop-selector'),
    bunLifecyclePlugin: pathToFileURL(resolve(repositoryRoot, 'packages', 'runtime', 'lib', 'bun-lifecycle.js')).href,
    runtimes: [
      { id: 'pi', name: 'Pi', package: repositoryPlugin(repositoryRoot, 'agent-loop-pi') },
      { id: 'deepseek', name: 'DeepSeek', package: '@deepseek-ai/dsh-agent-loop' },
      { id: 'codex', name: 'Codex', package: repositoryPlugin(repositoryRoot, 'agent-loop-codex') },
      { id: 'claude', name: 'Claude Code', package: repositoryPlugin(repositoryRoot, 'agent-loop-claude') },
    ],
  })
}

export async function reserveLoopbackPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolveReady, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveReady)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('unable to reserve loopback port')
  await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  return address.port
}

async function waitForHealth(url: string, process: Bun.Subprocess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Harness exited during startup with code ${process.exitCode}`)
    try {
      const response = await fetch(`${url}/api/loopwithai/health`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(500),
      })
      if (response.ok) return
    } catch {
      // Runtime is still starting.
    }
    await Bun.sleep(100)
  }
  throw new Error(`Harness did not become ready within ${timeoutMs}ms`)
}

export async function startHarnessRuntime(options: StartRuntimeOptions): Promise<RuntimeHandle> {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? await reserveLoopbackPort()
  const paths = resolveRuntimePaths(options.paths)
  await ensureRuntimePaths(paths)

  const temporaryRoot = await mkdtemp(join(paths.runtimeDir, 'profile-'))
  const patchPath = join(temporaryRoot, 'profile.patch.json')
  await writeFile(patchPath, JSON.stringify(options.patch), { encoding: 'utf8', mode: 0o600 })

  const require = createRequire(import.meta.url)
  const dshBin = require.resolve('@deepseek-ai/dsh/lib/bin.js')
  let currentState: RuntimeState = 'starting'
  const child = Bun.spawn([process.execPath, dshBin, 'web', '--patch', patchPath, '--host', host, '--port', String(port)], {
    stdin: 'ignore',
    stdout: options.stdout ?? 'inherit',
    stderr: options.stderr ?? 'inherit',
    env: {
      ...process.env,
      ...options.environment,
      LWA_HOME: paths.root,
      DSH_HOME: join(paths.configDir, 'harness'),
      LOOPWITHAI_CONFIG_DIR: paths.configDir,
      LOOPWITHAI_DATA_DIR: paths.dataDir,
      LOOPWITHAI_WORKSPACE_DIR: paths.workspaceDir,
      LOOPWITHAI_RUNTIME_DIR: paths.runtimeDir,
      LOOPWITHAI_LOGS_DIR: paths.logsDir,
      LOOPWITHAI_CACHE_DIR: paths.cacheDir,
      LOOPWITHAI_VERSION: options.version ?? process.env.LOOPWITHAI_VERSION ?? '0.1.0',
    },
  })
  const url = `http://${host}:${port}`
  const exited = child.exited.then(async code => {
    currentState = currentState === 'stopping' ? 'stopped' : code === 0 ? 'stopped' : 'failed'
    await rm(temporaryRoot, { recursive: true, force: true })
    return code
  })

  try {
    await waitForHealth(url, child, options.startupTimeoutMs ?? 15_000)
    currentState = 'running'
  } catch (error) {
    currentState = 'failed'
    child.kill()
    await exited.catch(() => undefined)
    throw error
  }

  return {
    host,
    port,
    url,
    paths,
    state: () => currentState,
    exited,
    async stop() {
      if (currentState === 'stopped' || currentState === 'failed') return
      currentState = 'stopping'
      child.kill('SIGTERM')
      const forced = Bun.sleep(5_000).then(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
      })
      await Promise.race([exited, forced])
      await exited
    },
  }
}
