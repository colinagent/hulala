import { chmod, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { verifyPackage } from './package-manifest'
import { RELEASE_TARGETS, platformPackage, platformVersion, type ReleaseTarget } from '@hulala/distribution/targets'

const root = join(import.meta.dir, '../..')
const native = resolve(process.argv[2] || '')
if (!process.argv[2]) throw new Error('Pass a verified complete platform package')
const manifest = await verifyPackage(native)
if (manifest.stage !== 'workbench') throw new Error('npm requires a complete browser package')
const target = manifest.target as ReleaseTarget
if (!Object.hasOwn(RELEASE_TARGETS, target)) throw new Error('Unsupported platform package')
const output = resolve(process.argv[3] || join(root, 'dist/npm'))
await mkdir(output, { recursive: true })
const stage = await mkdtemp(join(output, '.packages-'))
const meta = join(stage, 'hulala'), platform = join(stage, 'platform')
await mkdir(join(meta, 'dist'), { recursive: true })
await mkdir(platform, { recursive: true })
const built = await Bun.build({ entrypoints: [join(root, 'apps/cli/src/npm-entry.ts')], target: 'node', format: 'esm', minify: true, sourcemap: 'none',
  define: { __HULALA_VERSION__: JSON.stringify(manifest.version) } })
if (!built.success || !built.outputs[0]) throw new AggregateError(built.logs, 'Could not build npm launcher')
await writeFile(join(meta, 'dist/cli.js'), '#!/usr/bin/env node\n' + await built.outputs[0].text())
await chmod(join(meta, 'dist/cli.js'), 0o755)
const common = { name: 'hulala', type: 'module', license: 'Apache-2.0', repository: { type: 'git', url: 'git+https://github.com/colinagent/hulala.git' } }
await writeFile(join(meta, 'package.json'), JSON.stringify({ ...common, version: manifest.version,
  description: 'Local Hulala browser workbench', bin: { hulala: './dist/cli.js' }, engines: { node: '>=18' }, files: ['dist/', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md'],
  optionalDependencies: Object.fromEntries(Object.keys(RELEASE_TARGETS).map(key => [platformPackage(key as ReleaseTarget), 'npm:hulala@' + platformVersion(manifest.version, key as ReleaseTarget)])),
}, null, 2) + '\n')
await writeFile(join(platform, 'package.json'), JSON.stringify({ ...common, version: platformVersion(manifest.version, target),
  description: 'Hulala platform package: ' + target, os: [target.split('-')[0]], cpu: [target.split('-')[1]], files: ['vendor/', 'LICENSE', 'THIRD_PARTY_NOTICES.md'],
}, null, 2) + '\n')
await cp(native, join(platform, 'vendor'), { recursive: true })
for (const directory of [meta, platform]) for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await cp(join(root, file), join(directory, file))
await writeFile(join(meta, 'README.md'), '# Hulala\n\nRun `hulala` to open the local browser workbench at hulala.localhost.\nThe platform package includes Bun, Harness and web assets. User data stays in ~/.config/hulala and ~/hulala-workspace.\n')
const artifacts: string[] = []
for (const directory of [platform, meta]) {
  const child = Bun.spawn(['npm', 'pack', '--ignore-scripts', '--json', '--pack-destination', output], { cwd: directory, stdout: 'pipe', stderr: 'pipe' })
  const logs = new Response(child.stdout).text(), errors = new Response(child.stderr).text()
  if (await child.exited !== 0) throw new Error(await errors)
  const result = JSON.parse(await logs) as Array<{ filename: string }>
  const archive = join(output, result[0]!.filename)
  artifacts.push(archive)
  if (directory === platform) {
    // Validate npm's actual packlist result; npm can omit files despite `files`.
    const extracted = await mkdtemp(join(output, '.verify-'))
    try {
      const unpack = Bun.spawn(['tar', '-xzf', archive, '-C', extracted], { stdout: 'ignore', stderr: 'inherit' })
      if (await unpack.exited !== 0) throw new Error('Cannot inspect generated npm tarball')
      await verifyPackage(join(extracted, 'package/vendor'))
    } finally { await rm(extracted, { recursive: true, force: true }) }
  }
}
console.log(JSON.stringify({ meta, platform, artifacts, version: manifest.version, target }))
