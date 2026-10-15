import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { join } from 'node:path'
import { pack } from 'tar-stream'
import type { PackageManifest } from './package-manifest'

/** Serialize the verified inventory as regular files with no build-user IDs,
 * owner names, hardlinks or filesystem timestamps. */
export async function writeReleaseArchive(directory: string, destination: string, manifest: PackageManifest): Promise<void> {
  const archive = pack(), writing = pipeline(archive, createGzip({ level: 6 }), createWriteStream(destination, { flags: 'wx' }))
  const prefix = `hulala-${manifest.version}-${manifest.target}`
  const files = [...manifest.files.map(file => ({ path: file.path, size: file.size, mode: file.mode ?? 0o644 })),
    { path: 'manifest.json', size: (await Bun.file(join(directory, 'manifest.json')).arrayBuffer()).byteLength, mode: 0o644 }]
  try {
    for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
      const entry = archive.entry({ name: prefix + '/' + file.path, size: file.size, mode: file.mode, type: 'file', mtime: new Date(0), uid: 0, gid: 0, uname: '', gname: '' })
      await pipeline(createReadStream(join(directory, file.path)), entry)
    }
    archive.finalize(); await writing
  } catch (error) { archive.destroy(error instanceof Error ? error : new Error('Archive creation failed')); await writing.catch(() => undefined); throw error }
}
