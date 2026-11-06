/**
 * Generate the terminal-client install metadata for one release.
 *
 * The Hulala archive carries the client and the embedded Host in one package, so
 * the install path needs no bootstrap binary: `install.sh` secures a Node.js
 * 24.9+ first (the machine's own, or one it offers to install), downloads the
 * archive for the detected platform, verifies its SHA-256, extracts it, hands it
 * to the package's own `bin/hulala install` (one versioned layout, so
 * `hulala update` can replace it) and publishes the bundled binaries into
 * `<state root>/bin` (no symlinks anywhere) — see `installScriptTemplate.ts`.
 *
 * Produces, next to the archives:
 *   install.sh         the `curl -fsSL https://hulala.ai/install.sh | sh` script
 *   web-releases.json  the release index `hulala install/update` reads
 *   SHASUMS256.txt     checksums for every archive, runtime pack and the lock
 *
 * Every platform also publishes `hulala-<version>-<target>-runtime.tar.gz` (the
 * installed, patched dependency tree) and one `runtime-package-lock.json`; the
 * archive itself carries no `node_modules`.
 *
 * @module hulala/release/install-script
 */
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { buildInstallMetadata } from './installMetadata.ts'
import { RELEASE_TARGETS } from './r2Retention'

const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const version = argument('--version') ?? String(JSON.parse(await readFile(join(resolve(import.meta.dirname, '../..'), 'package.json'), 'utf8')).version)
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`invalid stable version: ${version}`)
const directory = resolve(argument('--dir') ?? join(import.meta.dirname, '../../dist/release'))
const downloadBase = `https://downloads.hulala.ai/hulala/web/${version}`
const githubBase = `https://github.com/colinagent/hulala/releases/download/hulala-v${version}`

interface Archive {
  target: string
  file: string
  size: number
  sha256: string
  manifestSha256: string
  /** Per-target dependency tree for machines without npm or registry access. */
  runtimePack: { file: string, sha256: string }
}

const present = new Set(await readdir(directory))
// One npm lock resolves the dependency tree for every target.
const lockFile = 'runtime-package-lock.json'
if (!present.has(lockFile)) throw new Error(`missing dependency lock: ${lockFile}`)
const lockSha256 = createHash('sha256').update(await readFile(join(directory, lockFile))).digest('hex')
const archives: Archive[] = []
for (const target of RELEASE_TARGETS) {
  const file = `hulala-${version}-${target}.tar.gz`
  if (!present.has(file)) throw new Error(`missing archive: ${file}`)
  const bytes = await readFile(join(directory, file))
  const manifest = await Bun.file(join(directory, file)).arrayBuffer()
  void manifest
  // Read manifest.json out of the archive without unpacking it.
  const child = Bun.spawn(['tar', '-xzOf', join(directory, file), `hulala-${version}-${target}/manifest.json`], { stdout: 'pipe', stderr: 'pipe' })
  const manifestBytes = new Uint8Array(await new Response(child.stdout).arrayBuffer())
  if (await child.exited !== 0) throw new Error(`cannot read manifest.json from ${file}`)
  const parsed = JSON.parse(new TextDecoder().decode(manifestBytes)) as { version?: string, target?: string, dataFormat?: number }
  if (parsed.version !== version || parsed.target !== target || parsed.dataFormat !== 1) {
    throw new Error(`${file} does not describe ${version}/${target} dataFormat 1`)
  }
  const packFile = `hulala-${version}-${target}-runtime.tar.gz`
  if (!present.has(packFile)) throw new Error(`missing runtime pack: ${packFile}`)
  const packSha256 = createHash('sha256').update(await readFile(join(directory, packFile))).digest('hex')
  archives.push({
    target,
    file,
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
    runtimePack: { file: packFile, sha256: packSha256 },
  })
}

// The Node.js line is a deliberate release decision: it must match the
// `engines` floor DSH declares and the `node-version` the release CI builds on.
const nodeLine = argument('--node-line') ?? process.env.HULALA_NODE_LINE
const metadata = buildInstallMetadata({
  version,
  downloadBase,
  githubBase,
  lockFile,
  lockSha256,
  archives,
  ...(nodeLine === undefined ? {} : { nodeLine }),
})

await writeFile(join(directory, 'install.sh'), metadata.installScript, { mode: 0o644 })
await writeFile(join(directory, 'web-releases.json'), `${JSON.stringify(metadata.index, null, 2)}\n`)
await writeFile(join(directory, 'SHASUMS256.txt'), `${metadata.shasums}\n`)
console.log(JSON.stringify({ version, files: archives.map(a => ({ file: a.file, size: a.size, sha256: a.sha256 })) }, null, 2))
