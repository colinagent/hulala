import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { packageFiles, verifyPackage, type PackageManifest } from './package-manifest'
import { RELEASE_TARGETS, releaseTarget, type ReleaseTarget } from '@hulala/distribution/targets'
import { prepareRemotePackage } from './remote-package'
import { copyCliLicenses } from './licenses'
import { writeReleaseArchive } from './archive'

const root = join(import.meta.dir, '../..')
const argument = (name: string) => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
const target = argument('--target') || releaseTarget()
if (!Object.hasOwn(RELEASE_TARGETS, target)) throw new Error('Unsupported release target')
if (!Bun.semver.satisfies(Bun.version, '>=1.4.2')) throw new Error('Use the repository-pinned Bun to build releases')
const bunTarget = RELEASE_TARGETS[target as ReleaseTarget]
const pkg = JSON.parse(await readFile(join(root, 'apps/workbench/package.json'), 'utf8')) as { version: string }
if (argument('--version')) pkg.version = argument('--version')!
if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(pkg.version)) throw new Error('Invalid release version')
const output = resolve(argument('--output') || join(root, 'dist'))
await mkdir(output, { recursive: true })
const staging = await mkdtemp(join(output, `hulala-${pkg.version}-${target}-`))
const runtime = join(staging, 'runtime')
const run = async (args: string[], env: NodeJS.ProcessEnv = process.env) => {
  const child = Bun.spawn(args, { cwd: root, env, stdout: 'inherit', stderr: 'inherit' })
  if (await child.exited !== 0) throw new Error('Package build step failed: ' + args[1])
}
await run([process.execPath, join(root, 'packages/runtime/scripts/build-portable.ts'), bunTarget], {
  ...process.env, HULALA_PORTABLE_OUTPUT: runtime, HULALA_PORTABLE_WORKBENCH: '1', HULALA_PORTABLE_SKIP_ARCHIVE: '1', HULALA_HOST_RELEASE_VERSION: pkg.version,
})
await prepareRemotePackage(runtime, true)
if (argument('--web')) {
  const web = resolve(argument('--web')!)
  if (!await Bun.file(join(web, 'index.html')).exists()) throw new Error('Web build has no index.html')
  await cp(web, join(staging, 'web'), { recursive: true })
} else await run([process.execPath, 'run', '--cwd', join(root, 'apps/workbench'), 'build', '--outDir', join(staging, 'web')])
await cp(join(root, 'apps/workbench/settings'), join(staging, 'settings'), { recursive: true })
await mkdir(join(staging, 'bin'))
const executable = `bin/hulala${target.startsWith('win32-') ? '.exe' : ''}`
await run([process.execPath, 'build', join(import.meta.dir, 'package-entry.ts'), '--compile', '--minify', '--target', bunTarget,
  ...(target.startsWith('win32-') ? [] : ['--bytecode']), '--define', `HULALA_PACKAGE_VERSION=${JSON.stringify(pkg.version)}`,
  '--define', `__HULALA_VERSION__=${JSON.stringify(pkg.version)}`, '--define', '__HULALA_COMPILED__=true', '--outfile', join(staging, executable)])
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await cp(join(root, file), join(staging, file))
await copyCliLicenses(root, join(staging, 'licenses/cli'))
await cp(join(root, 'apps/workbench/src/renderer/assets/file-icons/seti'), join(staging, 'licenses/seti'), {
  recursive: true, filter: path => !/\.(woff|json)$/.test(path),
})
const lockSha256 = new Bun.CryptoHasher('sha256').update(await readFile(join(root, 'bun.lock'))).digest('hex')
const manifest: PackageManifest = { format: 1, product: 'hulala', stage: 'workbench', version: pkg.version, target,
  protocol: 1, dataFormat: 1, lockSha256, entrypoint: executable, files: await packageFiles(staging) }
const buildPaths = [...new Set([root, staging].flatMap(path => [path, path.replaceAll('\\', '/'), path.replaceAll('\\', '\\\\')]))].map(path => Buffer.from(path))
for (const file of manifest.files) {
  const bytes = await readFile(join(staging, file.path))
  if (buildPaths.some(path => bytes.includes(path))) throw new Error('Package contains a build-machine path: ' + file.path)
}
await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
await verifyPackage(staging)
const archive = staging + '.tar.gz'
await writeReleaseArchive(staging, archive, manifest)
await writeFile(archive + '.sha256', new Bun.CryptoHasher('sha256').update(await readFile(archive)).digest('hex') + '  ' + basename(archive) + '\n')
console.log(JSON.stringify({ directory: staging, archive, stage: manifest.stage, version: manifest.version, target, files: manifest.files.length }))
