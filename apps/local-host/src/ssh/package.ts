import { readFile, lstat, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, posix, relative, isAbsolute, sep } from 'node:path'
import { z } from 'zod'

const fileSchema = z.object({ path: z.string().min(1).max(32768).refine(path => !path.includes('\\') && !path.includes(':') && !/[\x00-\x1f]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..')),
  size: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/), mode: z.number().int().min(0).max(0o777).optional() })
export const remoteManifestSchema = z.object({ format: z.literal(1), product: z.literal('hulala-remote-host'), version: z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/),
  target: z.enum(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64']), files: z.array(fileSchema).min(1).max(50000) }).strict()
export type RemoteManifest = z.infer<typeof remoteManifestSchema>

export async function verifyRemotePackage(root: string, expectedHash?: string): Promise<{ manifest: RemoteManifest; hash: string }> {
  const bytes = await readFile(join(root, 'remote-manifest.json'))
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (expectedHash && hash !== expectedHash) throw new Error('Remote manifest integrity mismatch')
  const manifest = remoteManifestSchema.parse(JSON.parse(bytes.toString()))
  const names = new Set<string>()
  for (const file of manifest.files) {
    if (names.has(file.path) || file.path === 'remote-manifest.json') throw new Error('Duplicate or invalid remote package file')
    names.add(file.path)
  }
  for (const required of ['host/worker.js', 'host/remote-entry.js', 'runtime/host.js', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'bin/' + (manifest.target.startsWith('win32-') ? 'bun.exe' : 'bun')]) {
    if (!names.has(required)) throw new Error('Remote package is incomplete')
  }
  const actual = new Set<string>()
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name), name = relative(root, path).split(sep).join('/')
      if (entry.isSymbolicLink()) throw new Error('Remote package contains a symlink')
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) actual.add(name)
      else throw new Error('Remote package contains a special file')
    }
  }
  await walk(root)
  actual.delete('remote-manifest.json')
  if (actual.size !== names.size || [...actual].some(name => !names.has(name))) throw new Error('Remote package contains unexpected files')
  for (const file of manifest.files) {
    const path = join(root, file.path)
    const metadata = await lstat(path)
    if (isAbsolute(relative(root, path)) || metadata.size !== file.size) throw new Error('Remote package file size mismatch')
    if (process.platform !== 'win32' && file.mode !== undefined && (metadata.mode & 0o111) !== (file.mode & 0o111)) throw new Error('Remote package executable mode mismatch')
    const data = await readFile(path)
    if (createHash('sha256').update(data).digest('hex') !== file.sha256) throw new Error('Remote package integrity mismatch: ' + file.path)
  }
  return { manifest, hash }
}

export function remoteCommand(platform: string, ...args: string[]): string {
  if (args.some(value => value.includes('\0') || /[\r\n]/.test(value))) throw new Error('Invalid remote command argument')
  if (platform !== 'win32') return args.map(value => "'" + value.replaceAll("'", "'\\''") + "'").join(' ')
  const script = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); & ' + args.map(value => "'" + value.replace(/^\/([A-Za-z]:)/, '$1').replaceAll("'", "''") + "'").join(' ') + '; exit $LASTEXITCODE'
  return 'powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ' + Buffer.from(script, 'utf16le').toString('base64')
}
export const remoteJoin = posix.join
