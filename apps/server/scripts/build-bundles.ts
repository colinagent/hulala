import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { privateHostBuildPlugins } from './buildPrivacy.ts'
import { HULALA_VERSION } from '@hulala/desktop-contracts/version'

if (!Bun.semver.satisfies(Bun.version, '>=1.4.2')) throw new Error('Harness Host builds require Bun >=1.4.2')

const packageRoot = join(import.meta.dirname, '..')
const outputRoot = join(packageRoot, 'dist', 'bundles')
const supportedTargets = [
  'bun-darwin-arm64',
  'bun-darwin-x64',
  'bun-linux-x64-baseline',
  'bun-linux-arm64',
  'bun-windows-x64-baseline',
] as const
const nativeCompile = process.argv.includes('--native') || process.env.HULALA_NATIVE_COMPILE === '1'
const requested = process.argv.slice(2).filter(argument => argument !== '--native')
const targets = requested.length ? supportedTargets.filter(target => requested.includes(target)) : supportedTargets
if (targets.length === 0) throw new Error('no supported Bun target selected')
if (nativeCompile && targets.length !== 1) throw new Error('native Host compilation requires exactly one target')
const nativeTarget = process.platform === 'darwin'
  ? `bun-darwin-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
  : process.platform === 'linux'
    ? `bun-linux-${process.arch === 'arm64' ? 'arm64' : 'x64-baseline'}`
    : `bun-windows-${process.arch === 'arm64' ? 'arm64' : 'x64-baseline'}`
if (nativeCompile && targets[0] !== nativeTarget) throw new Error(`native Host target ${targets[0]} does not match ${nativeTarget}`)

await rm(outputRoot, { recursive: true, force: true })
await mkdir(outputRoot, { recursive: true })
const artifacts: Array<{ target: string; file: string; sha256: string; size: number }> = []

for (const target of targets) {
  const directory = join(outputRoot, target)
  await mkdir(directory, { recursive: true })
  const filename = target.includes('windows') ? 'hulala-server.exe' : 'hulala-server'
  const outfile = join(directory, filename)
  const result = await Bun.build({
    entrypoints: [join(packageRoot, 'src', 'main.ts')],
    compile: nativeCompile ? { outfile } : { target, outfile },
    format: 'cjs',
    bytecode: !target.includes('windows'),
    minify: true,
    sourcemap: 'none',
    plugins: privateHostBuildPlugins(),
  })
  if (!result.success) throw new AggregateError(result.logs, `failed to build ${target}`)
  const file = Bun.file(outfile)
  const sha256 = new Bun.CryptoHasher('sha256').update(await file.arrayBuffer()).digest('hex')
  artifacts.push({ target, file: `${target}/${filename}`, sha256, size: file.size })
}

await Bun.write(join(outputRoot, 'manifest.json'), `${JSON.stringify({ version: HULALA_VERSION, artifacts }, null, 2)}\n`)
