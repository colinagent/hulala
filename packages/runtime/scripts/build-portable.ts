import { chmod, copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const repositoryRoot = join(import.meta.dir, '..', '..', '..')
const packageRoot = join(repositoryRoot, 'packages', 'runtime')
const pluginPackages = ['network-proxy', 'agent-loop-selector', 'agent-loop-pi', 'agent-loop-codex', 'agent-loop-claude'] as const

async function bundleFile(entrypoint: string, outfile: string): Promise<void> {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    target: 'bun',
    minify: true,
    sourcemap: 'none',
  })
  if (!result.success || !result.outputs[0]) throw new AggregateError(result.logs, `failed to bundle ${entrypoint}`)
  await Bun.write(outfile, result.outputs[0])
}

function currentTarget(): string {
  const os = process.platform === 'darwin' ? 'darwin' : process.platform === 'linux' ? 'linux' : process.platform === 'win32' ? 'windows' : undefined
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : undefined
  if (!os || !arch) throw new Error(`unsupported build host: ${process.platform}/${process.arch}`)
  return `bun-${os}-${arch}${os !== 'darwin' && arch === 'x64' ? '-baseline' : ''}`
}

const target = process.argv[2] ?? currentTarget()
const targetPlatforms: Record<string, { os: string; cpu: string; bunAsset: string; bunName: string }> = {
  'bun-darwin-arm64': { os: 'darwin', cpu: 'arm64', bunAsset: 'bun-darwin-aarch64.zip', bunName: 'bun' },
  'bun-darwin-x64': { os: 'darwin', cpu: 'x64', bunAsset: 'bun-darwin-x64.zip', bunName: 'bun' },
  'bun-linux-x64-baseline': { os: 'linux', cpu: 'x64', bunAsset: 'bun-linux-x64-baseline.zip', bunName: 'bun' },
  'bun-linux-arm64': { os: 'linux', cpu: 'arm64', bunAsset: 'bun-linux-aarch64.zip', bunName: 'bun' },
  'bun-windows-x64-baseline': { os: 'win32', cpu: 'x64', bunAsset: 'bun-windows-x64-baseline.zip', bunName: 'bun.exe' },
}
const targetPlatform = targetPlatforms[target]
if (!targetPlatform) throw new Error(`unsupported portable Runtime target: ${target}`)
const output = join(packageRoot, 'dist', 'portable', target)
await rm(output, { recursive: true, force: true })
await mkdir(join(output, 'bin'), { recursive: true })
await mkdir(join(output, 'runtime'), { recursive: true })

const bunName = targetPlatform.bunName
if (target === currentTarget()) {
  await copyFile(process.execPath, join(output, 'bin', bunName))
} else {
  const download = join(output, '.bun-download.zip')
  const extracted = join(output, '.bun-download')
  const version = process.versions.bun
  const downloadUrl = `https://github.com/oven-sh/bun/releases/download/bun-v${version}/${targetPlatform.bunAsset}`
  const curl = Bun.spawn(['curl', '-L', '--fail', '--silent', '--show-error', '--output', download, downloadUrl], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (await curl.exited !== 0) throw new Error(`failed to download Bun ${target}`)
  await mkdir(extracted)
  const unzip = Bun.spawn(['tar', '-xf', download, '-C', extracted], { stdout: 'inherit', stderr: 'inherit' })
  if (await unzip.exited !== 0) throw new Error(`failed to extract Bun ${target}`)
  const directories = await readdir(extracted)
  if (directories.length !== 1) throw new Error(`unexpected Bun archive layout for ${target}`)
  await copyFile(join(extracted, directories[0], bunName), join(output, 'bin', bunName))
  await rm(download, { force: true })
  await rm(extracted, { recursive: true, force: true })
}
await chmod(join(output, 'bin', bunName), 0o700).catch(() => undefined)

await writeFile(join(output, 'package.json'), `${JSON.stringify({
  name: '@hulala/runtime-bundle',
  version: '0.1.0',
  private: true,
  type: 'module',
  dependencies: {
    '@deepseek-ai/dsh': '0.1.0-rc.6',
    '@deepseek-ai/dsh-agent-loop': '0.1.0-rc.6',
  },
}, null, 2)}\n`)

const install = Bun.spawn([process.execPath, 'install', '--production', '--os', targetPlatform.os, '--cpu', targetPlatform.cpu], {
  cwd: output,
  stdout: 'inherit',
  stderr: 'inherit',
})
if (await install.exited !== 0) throw new Error('failed to install portable Runtime dependencies')

await bundleFile(join(packageRoot, 'src', 'cli.ts'), join(output, 'runtime', 'launcher.js'))

for (const plugin of pluginPackages) {
  const pluginOutput = join(output, 'packages', plugin, 'lib')
  await mkdir(pluginOutput, { recursive: true })
  await bundleFile(join(repositoryRoot, 'packages', plugin, 'src', 'index.ts'), join(pluginOutput, 'index.js'))
  await copyFile(join(repositoryRoot, 'packages', plugin, 'package.json'), join(output, 'packages', plugin, 'package.json'))
}

const runtimePluginOutput = join(output, 'packages', 'runtime', 'lib')
await mkdir(runtimePluginOutput, { recursive: true })
await bundleFile(join(packageRoot, 'src', 'bun-lifecycle.ts'), join(runtimePluginOutput, 'bun-lifecycle.js'))

const selectorClient = join(output, 'packages', 'agent-loop-selector', 'lib', 'client')
await mkdir(selectorClient, { recursive: true })
await copyFile(
  join(repositoryRoot, 'packages', 'agent-loop-selector', 'lib', 'client', 'runtime-ui.js'),
  join(selectorClient, 'runtime-ui.js'),
)

const criticalFiles = [
  join(output, 'bin', bunName),
  join(output, 'runtime', 'launcher.js'),
  ...pluginPackages.map(plugin => join(output, 'packages', plugin, 'lib', 'index.js')),
]
const artifacts = await Promise.all(criticalFiles.map(async path => {
  const file = Bun.file(path)
  return {
    file: path.slice(output.length + 1),
    size: file.size,
    sha256: new Bun.CryptoHasher('sha256').update(await file.arrayBuffer()).digest('hex'),
  }
}))
await Bun.write(join(output, 'manifest.json'), `${JSON.stringify({ version: '0.1.0', target, artifacts }, null, 2)}\n`)

const archive = join(packageRoot, 'dist', 'portable', `${target}.tar.gz`)
await rm(archive, { force: true })
const tar = Bun.spawn(['tar', '-czf', archive, '-C', join(packageRoot, 'dist', 'portable'), target], {
  stdout: 'inherit',
  stderr: 'inherit',
})
if (await tar.exited !== 0) throw new Error('failed to archive portable Runtime')

const entries = await readdir(output)
console.log(`portable Runtime ${target}: ${entries.map(entry => basename(entry)).join(', ')}`)
