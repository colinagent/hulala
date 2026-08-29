import { chmod, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'

const repositoryRoot = join(import.meta.dir, '..', '..', '..')
const require = createRequire(import.meta.url)
const packageRoot = join(repositoryRoot, 'packages', 'runtime')
const pluginPackages = ['network-proxy', 'agent-loop-selector', 'agent-loop-pi', 'agent-loop-codex', 'agent-loop-claude'] as const
const desktopHostPackages = [
  '@deepseek-ai/dsh-authorization',
  '@deepseek-ai/dsh-storage',
  '@deepseek-ai/dsh-storage-json',
  '@deepseek-ai/dsh-storage-domain',
  '@deepseek-ai/dsh-workspace',
  '@deepseek-ai/dsh-host-directory-picker-native',
  '@deepseek-ai/dsh-session-projection-cache',
  '@deepseek-ai/dsh-host-plugin-inventory',
  '@deepseek-ai/dsh-host-apiproxy',
  '@deepseek-ai/dsh-agent-presets',
] as const

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
  const unzip = Bun.spawn(['unzip', '-q', download, '-d', extracted], { stdout: 'inherit', stderr: 'inherit' })
  if (await unzip.exited !== 0) throw new Error(`failed to extract Bun ${target}`)
  const directories = await readdir(extracted)
  if (directories.length !== 1) throw new Error(`unexpected Bun archive layout for ${target}`)
  await copyFile(join(extracted, directories[0], bunName), join(output, 'bin', bunName))
  await rm(download, { force: true })
  await rm(extracted, { recursive: true, force: true })
}
await chmod(join(output, 'bin', bunName), 0o700).catch(() => undefined)

const runtimeManifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
}
await writeFile(join(output, 'package.json'), `${JSON.stringify({
  name: '@hulala/runtime-bundle',
  version: '0.1.0',
  private: true,
  type: 'module',
  dependencies: runtimeManifest.dependencies,
}, null, 2)}\n`)

const install = Bun.spawn([process.execPath, 'install', '--production', '--os', targetPlatform.os, '--cpu', targetPlatform.cpu], {
  cwd: output,
  stdout: 'inherit',
  stderr: 'inherit',
})
if (await install.exited !== 0) throw new Error('failed to install portable Runtime dependencies')

const moduleSpecifiers = new Set<string>(desktopHostPackages)
const collectNames = async (path: string): Promise<void> => {
  const source = await readFile(path, 'utf8')
  for (const match of source.matchAll(/^\s*name:\s*['"]?([^'"\s#]+)/gmu)) {
    const specifier = match[1]
    if (specifier?.startsWith('@deepseek-ai/')) moduleSpecifiers.add(specifier)
  }
}
const baseManifestPath = require.resolve('@deepseek-ai/dsh-base/package.json')
const baseManifest = JSON.parse(await readFile(baseManifestPath, 'utf8')) as {
  dsh?: { bundle?: { patch?: string } }
}
if (!baseManifest.dsh?.bundle?.patch) throw new Error('dsh-base has no bundle patch')
await collectNames(join(dirname(baseManifestPath), baseManifest.dsh.bundle.patch))
const presetRoot = join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'config', 'agent-presets')
for (const preset of await readdir(presetRoot)) {
  const config = join(presetRoot, preset, 'agent.cordis.yml')
  if (await Bun.file(config).exists()) await collectNames(config)
}

const portableHostEntry = join(output, '.host-entry.ts')
const moduleImports = [...moduleSpecifiers].sort().map((specifier, index) => ({
  key: specifier,
  identifier: `upstream${index}`,
  specifier,
}))
const localImports = pluginPackages.map((plugin, index) => ({
  key: `@hulala-local/${plugin}`,
  identifier: `hulala${index}`,
  specifier: join(repositoryRoot, 'packages', plugin, 'src', 'index.ts'),
}))
const portableImports = [...moduleImports, ...localImports]
await Bun.write(portableHostEntry, [
  ...portableImports.map(item => `import * as ${item.identifier} from ${JSON.stringify(item.specifier)}`),
  `globalThis.__HULALA_RUNTIME_MODULES__ = new Map([${portableImports
    .map(item => `[${JSON.stringify(item.key)}, ${item.identifier}]`).join(',')}])`,
  `export { bootRepositoryHarness } from ${JSON.stringify(join(packageRoot, 'src', 'in-process.ts'))}`,
  '',
].join('\n'))

const hostBuild = await Bun.build({
  entrypoints: [portableHostEntry],
  target: 'bun',
  minify: true,
  sourcemap: 'none',
  plugins: [{
    name: 'hulala-portable-sharp-binding',
    setup(build) {
      build.onLoad({ filter: /[\\/]sharp[\\/]dist[\\/]sharp\.(?:cjs|mjs)$/u }, ({ path }) => path.endsWith('.mjs')
        ? {
            contents: `
              import { createRequire } from 'node:module'
              import { join } from 'node:path'
              import libvips from './libvips.mjs'
              const root = process.env.HULALA_RUNTIME_REPOSITORY_ROOT
              if (!root) throw new Error('HULALA_RUNTIME_REPOSITORY_ROOT is required to load sharp')
              const request = createRequire(process.execPath)
              export default request(join(root, 'node_modules', '@img', 'sharp-' + libvips.runtimePlatformArch(), 'index.cjs'))
            `,
            loader: 'js',
          }
        : {
            contents: `
              const { createRequire } = require('node:module')
              const { join } = require('node:path')
              const { runtimePlatformArch } = require('./libvips.cjs')
              const root = process.env.HULALA_RUNTIME_REPOSITORY_ROOT
              if (!root) throw new Error('HULALA_RUNTIME_REPOSITORY_ROOT is required to load sharp')
              const request = createRequire(process.execPath)
              module.exports = request(join(root, 'node_modules', '@img', 'sharp-' + runtimePlatformArch(), 'index.cjs'))
            `,
            loader: 'js',
          })
      build.onLoad({ filter: /[\\/]node-pty[\\/]lib[\\/]utils\.js$/u }, () => ({
        contents: `
          'use strict'
          const { createRequire } = require('node:module')
          const { join } = require('node:path')
          exports.assign = function assign(target, ...sources) {
            for (const source of sources) for (const key of Object.keys(source)) target[key] = source[key]
            return target
          }
          exports.loadNativeModule = function loadNativeModule(name) {
            const root = process.env.HULALA_RUNTIME_REPOSITORY_ROOT
            if (!root) throw new Error('HULALA_RUNTIME_REPOSITORY_ROOT is required to load node-pty')
            const dir = join(root, 'node_modules', 'node-pty', 'prebuilds', process.platform + '-' + process.arch)
            const request = createRequire(process.execPath)
            return { dir, module: request(join(dir, name + '.node')) }
          }
        `,
        loader: 'js',
      }))
      build.onLoad({ filter: /[\\/]node-pty[\\/]lib[\\/]unixTerminal\.js$/u }, async ({ path }) => {
        const source = await readFile(path, 'utf8')
        const expected = 'helperPath = path.resolve(__dirname, helperPath);'
        if (!source.includes(expected)) throw new Error('node-pty unix helper path expression changed')
        return { contents: source.replace(expected, 'helperPath = path.resolve(helperPath);'), loader: 'js' }
      })
      build.onLoad({ filter: /[\\/]node-pty[\\/]lib[\\/](?:windowsConoutConnection|windowsPtyAgent)\.js$/u }, async ({ path }) => {
        const source = await readFile(path, 'utf8')
        return {
          contents: source.replaceAll(
            '__dirname',
            "require('node:path').join(process.env.HULALA_RUNTIME_REPOSITORY_ROOT, 'node_modules', 'node-pty', 'lib')",
          ),
          loader: 'js',
        }
      })
      build.onLoad({ filter: /[\\/]@silvia-odwyer[\\/]photon-node[\\/]photon_rs\.js$/u }, async ({ path }) => {
        const source = await readFile(path, 'utf8')
        const expected = "const path = require('path').join(__dirname, 'photon_rs_bg.wasm');"
        if (!source.includes(expected)) throw new Error('photon-node wasm path expression changed')
        return {
          contents: source.replace(
            expected,
            "const path = require('path').join(process.env.HULALA_RUNTIME_REPOSITORY_ROOT, 'runtime', 'photon_rs_bg.wasm');",
          ),
          loader: 'js',
        }
      })
    },
  }],
})
if (!hostBuild.success || !hostBuild.outputs[0]) {
  throw new AggregateError(hostBuild.logs, 'failed to bundle in-process Runtime Host')
}
const hostBytes = await hostBuild.outputs[0].arrayBuffer()
const hostText = new TextDecoder().decode(hostBytes)
for (const forbidden of [repositoryRoot, output]) {
  if (hostText.includes(forbidden)) throw new Error(`portable Host contains build path ${forbidden}`)
}
await Bun.write(join(output, 'runtime', 'host.js'), hostBytes)
const photonRoot = dirname(require.resolve('@silvia-odwyer/photon-node/package.json'))
await copyFile(join(photonRoot, 'photon_rs_bg.wasm'), join(output, 'runtime', 'photon_rs_bg.wasm'))
await rm(portableHostEntry, { force: true })

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
  join(output, 'runtime', 'host.js'),
  join(output, 'runtime', 'photon_rs_bg.wasm'),
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
