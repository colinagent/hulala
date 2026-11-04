/**
 * Generate the terminal-client install metadata for one release.
 *
 * The Hulala archive carries the client and the embedded Host in one package, so
 * the install path needs no bootstrap binary: `install.sh` downloads the
 * archive for the detected platform, verifies its SHA-256, extracts it, hands it
 * to the package's own `bin/hulala install` (one versioned layout, so
 * `hulala update` can replace it) and publishes the bundled binaries into
 * `<state root>/bin` (no symlinks anywhere) — see `installScriptTemplate.ts`.
 *
 * Produces, next to the archives:
 *   install.sh         the `curl -fsSL https://hulala.ai/install.sh | sh` script
 *   web-releases.json  the release index `hulala install/update` reads
 *   SHASUMS256.txt     checksums for every archive
 *
 * @module hulala/release/install-script
 */
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { renderInstallScript } from './installScriptTemplate.ts'
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
}

const present = new Set(await readdir(directory))
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
  archives.push({
    target,
    file,
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
  })
}

const cases = archives.map(archive => `  ${archive.target}) archive='${archive.file}' archive_sha='${archive.sha256}' ;;`).join('\n')

const installScript = renderInstallScript({ version, cases, downloadBase, githubBase })

const index = {
  format: 1 as const,
  product: 'hulala' as const,
  channels: { stable: version },
  releases: [{
    version,
    dataFormat: 1,
    platforms: Object.fromEntries(archives.map(archive => [archive.target, {
      url: `${downloadBase}/${archive.file}`,
      sha256: archive.sha256,
      manifestSha256: archive.manifestSha256,
    }])),
  }],
}

const shasums = archives.map(archive => `${archive.sha256}  ${archive.file}`).join('\n')

await writeFile(join(directory, 'install.sh'), installScript, { mode: 0o644 })
await writeFile(join(directory, 'web-releases.json'), `${JSON.stringify(index, null, 2)}\n`)
await writeFile(join(directory, 'SHASUMS256.txt'), `${shasums}\n`)
console.log(JSON.stringify({ version, files: archives.map(a => ({ file: a.file, size: a.size, sha256: a.sha256 })) }, null, 2))
