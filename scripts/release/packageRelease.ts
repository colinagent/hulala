/**
 * Build the standalone TUI package.
 *
 * Layout:
 *   bin/hulala                 Node ESM CLI/TUI entry
 *   server/hulala-host.mjs     Host wrapper (the real Host lives in runtime/)
 *   runtime/host.mjs           compiled Node Host
 *   runtime/node_modules/      DSH engine and native dependencies
 *   bin/nvim                   bundled Neovim binary for this platform
 *   bin/ime                    macOS input-source helper (darwin targets only)
 *   runtime/editor/nvim/       Neovim runtime tree and tree-sitter parsers
 *   runtime/editor/nvim-plugins/  vendored plugins (snacks.nvim, reader.nvim)
 *   manifest.json              package integrity manifest
 *
 * Bundled binaries are real files under `bin/`, never symlinks; the client
 * copies them (and the editor's runtime data) into `<data>/bin/nvim` and
 * `<data>/runtime/editor/` the first time the editor opens after an upgrade.
 *
 * The Host runs on Node; this package does not embed a second Runtime or a
 * browser workbench. It is the TUI distribution only.
 *
 * @module hulala/release/package-tui
 */
import { chmod, copyFile, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { packageFiles, verifyPackage, type PackageManifest } from '@hulala/distribution/manifest'
import { bundleEditor } from './editorBundle.ts'
import { bundleNativeTools } from './nativeTools.ts'

const repositoryRoot = resolve(import.meta.dirname, '../..')
const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}
const version = argument('--version') ?? String(JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')).version)
if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error(`invalid version: ${version}`)
const target = argument('--target') ?? `${process.platform}-${process.arch}`
if (!/^(darwin|linux|win32)-(arm64|x64)$/.test(target)) throw new Error(`invalid target: ${target}`)
if (target !== `${process.platform}-${process.arch}`) throw new Error(`build the TUI package on its target platform (${process.platform}-${process.arch})`)
if (target.startsWith('win32-')) throw new Error('Windows TUI packaging requires a native launcher and is not implemented yet')
const outputRoot = resolve(argument('--output') ?? join(repositoryRoot, 'dist', 'release'))
const packageName = `hulala-${version}-${target}`
const staging = join(outputRoot, packageName)
const archive = join(outputRoot, `${packageName}.tar.gz`)

async function run(command: string[], cwd: string, env: Record<string, string | undefined> = {}): Promise<void> {
  const child = Bun.spawn(command, { cwd, stdout: 'inherit', stderr: 'inherit', env: { ...process.env, ...env } })
  if (await child.exited !== 0) throw new Error(`command failed: ${command.join(' ')}`)
}

/** Remove symlinks and package-manager bin shims; the package format forbids symlinks. */
async function removeLinks(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.name === '.bin' || entry.isSymbolicLink()) { await rm(path, { recursive: true, force: true }); continue }
    if (entry.isDirectory()) await removeLinks(path)
  }
}

function dependenciesOf(manifest: { dependencies?: Record<string, string> }): Record<string, string> {
  return Object.fromEntries(Object.entries(manifest.dependencies ?? {}).filter(([name]) => !name.startsWith('@hulala/')))
}

await rm(staging, { recursive: true, force: true })
await mkdir(staging, { recursive: true })

console.log('Building the TUI executable...')
await run([process.execPath, 'run', '--cwd', 'apps/cli', 'build:client'], repositoryRoot, { HULALA_TUI_VERSION: version })
// The Host bundle inlines @hulala/runtime, and that package's lib/ is a build
// artifact (gitignored), so it must be compiled before the Host on a fresh
// checkout — CI has no previous build to reuse.
console.log('Building the composition runtime...')
await run([process.execPath, 'run', '--cwd', 'packages/runtime', 'build'], repositoryRoot)
console.log('Building the Node Host...')
await run([process.execPath, 'run', '--cwd', 'apps/server', 'build'], repositoryRoot)

await mkdir(join(staging, 'bin'), { recursive: true })
await copyFile(join(repositoryRoot, 'apps/cli/dist/hulala.mjs'), join(staging, 'bin', target.startsWith('win32-') ? 'hulala.exe' : 'hulala'))
await chmod(join(staging, 'bin', target.startsWith('win32-') ? 'hulala.exe' : 'hulala'), 0o755)
await mkdir(join(staging, 'server'), { recursive: true })
await writeFile(join(staging, 'server', 'hulala-host.mjs'), "import('../runtime/host.mjs')\n", { mode: 0o600 })
await mkdir(join(staging, 'runtime'), { recursive: true })
await copyFile(join(repositoryRoot, 'apps/server/dist/hulala-desktop-server.mjs'), join(staging, 'runtime', 'host.mjs'))

const runtimeManifest = JSON.parse(await readFile(join(repositoryRoot, 'packages/runtime/package.json'), 'utf8')) as { dependencies?: Record<string, string> }
const serverManifest = JSON.parse(await readFile(join(repositoryRoot, 'apps/server/package.json'), 'utf8')) as { dependencies?: Record<string, string> }
const rootManifest = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as { patchedDependencies?: Record<string, string> }
const dependencies = { ...dependenciesOf(runtimeManifest), ...dependenciesOf(serverManifest) }
await writeFile(join(staging, 'runtime', 'package.json'), `${JSON.stringify({
  name: '@hulala/tui-runtime',
  version,
  private: true,
  type: 'module',
  dependencies,
  trustedDependencies: ['@deepseek-ai/dsh-subprocess-local', 'koffi', 'node-pty', 'protobufjs'],
  ...(rootManifest.patchedDependencies === undefined ? {} : { patchedDependencies: rootManifest.patchedDependencies }),
}, null, 2)}\n`, { mode: 0o600 })
if (rootManifest.patchedDependencies !== undefined) {
  for (const patch of Object.values(rootManifest.patchedDependencies)) {
    await mkdir(dirname(join(staging, 'runtime', patch)), { recursive: true })
    await cp(join(repositoryRoot, patch), join(staging, 'runtime', patch))
  }
}
console.log('Installing the Runtime dependencies...')
await run([process.execPath, 'install', '--production'], join(staging, 'runtime'))
await removeLinks(join(staging, 'runtime', 'node_modules'))

await writeFile(join(staging, 'package.json'), `${JSON.stringify({ name: 'hulala', version, private: true, type: 'module' }, null, 2)}\n`, { mode: 0o600 })
async function removeSourceMaps(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) { await removeSourceMaps(path); continue }
    if (entry.isFile() && entry.name.endsWith('.map')) await rm(path, { force: true })
  }
}
await removeSourceMaps(staging)

async function assertNoPrivateContent(directory: string): Promise<void> {
  const forbidden = ['hulala-dev', '/Users/colin', 'BEGIN PRIVATE KEY', 'BEGIN OPENSSH PRIVATE KEY']
  const textExtensions = /\.(?:js|mjs|cjs|json|jsonc|yml|yaml|md|txt|d\.ts)$/
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) { await assertNoPrivateContent(path); continue }
    if (!entry.isFile()) continue
    if (path.endsWith('.map')) throw new Error(`package contains a source map: ${path}`)
    if (path.includes(`${sep}node_modules${sep}`)) continue
    if (!textExtensions.test(entry.name) || (await stat(path)).size > 4 * 1024 * 1024) continue
    const text = await readFile(path, 'utf8')
    for (const marker of forbidden) if (text.includes(marker)) throw new Error(`package contains private content (${marker}): ${path}`)
  }
}
console.log('Bundling the editor (Neovim + snacks.nvim + reader.nvim)...')
await bundleEditor({ staging, target, repositoryRoot })

console.log('Building native helpers...')
await bundleNativeTools({ staging, target, repositoryRoot })

await assertNoPrivateContent(staging)

await copyFile(join(repositoryRoot, 'LICENSE'), join(staging, 'LICENSE'))
await copyFile(join(repositoryRoot, 'THIRD_PARTY_NOTICES.md'), join(staging, 'THIRD_PARTY_NOTICES.md'))
await copyFile(join(repositoryRoot, 'apps/cli/THIRD_PARTY_NOTICES.md'), join(staging, 'THIRD_PARTY_NOTICES.cli.md'))

const files = await packageFiles(staging)
const manifest: PackageManifest = {
  format: 1,
  product: 'hulala',
  stage: 'workbench',
  version,
  target,
  protocol: 1,
  dataFormat: 1,
  lockSha256: createHash(await readFile(join(repositoryRoot, 'bun.lock'))),
  entrypoint: target.startsWith('win32-') ? 'bin/hulala.exe' : 'bin/hulala',
  files,
}
await writeFile(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
await verifyPackage(staging)

await rm(archive, { force: true })
// `--no-mac-metadata` is a bsdtar flag; GNU tar refuses it, so Linux archives
// only drop extended attributes.
const tarFlags = ['-czf', archive, '-C', outputRoot, packageName]
const archiveFlags = process.platform === 'darwin' ? ['--no-xattrs', '--no-mac-metadata'] : ['--no-xattrs']
const tar = Bun.spawn(['tar', ...archiveFlags, ...tarFlags], { stdout: 'inherit', stderr: 'inherit' })
if (await tar.exited !== 0) throw new Error('failed to create the TUI archive')
const hash = createHash(await readFile(archive))
await writeFile(archive + '.sha256', `${hash}  ${packageName}.tar.gz\n`, { mode: 0o600 })
console.log(JSON.stringify({ directory: staging, archive, version, target, files: files.length, sha256: hash }, null, 2))

function createHash(bytes: Uint8Array): string {
  return new Bun.CryptoHasher('sha256').update(bytes).digest('hex')
}
