import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'

export interface PackageEntry { path: string; size: number; sha256: string; mode?: number }
export interface PackageManifest {
  format: 1
  product: 'hulala'
  stage: 'foundation' | 'workbench'
  version: string
  target: string
  entrypoint: string
  files: PackageEntry[]
  protocol?: number
  dataFormat?: number
  lockSha256?: string
}

export function safePackagePath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && !path.includes('\\')
    && !path.includes(':') && !/[\x00-\x1f]/.test(path) && !isAbsolute(path)
    && path.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

export async function packageFiles(root: string): Promise<PackageEntry[]> {
  const entries: PackageEntry[] = []
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error('Package may not contain symlinks')
      if (entry.isDirectory()) { await walk(file); continue }
      if (!entry.isFile()) throw new Error('Package contains a special file')
      const path = relative(root, file).split(sep).join('/')
      if (path === 'manifest.json') continue
      const bytes = await readFile(file)
      entries.push({ path, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), mode: (await lstat(file)).mode & 0o777 })
    }
  }
  await walk(root)
  return entries.sort((a, b) => a.path.localeCompare(b.path))
}

/** Verify a local staged package. Authenticity of downloaded manifests is a separate release gate. */
export async function verifyPackage(root: string): Promise<PackageManifest> {
  const metadata = join(root, 'manifest.json')
  const metadataInfo = await lstat(metadata)
  if (metadataInfo.isSymbolicLink()) throw new Error('Manifest may not be a symlink')
  if (metadataInfo.size > 16 * 1024 * 1024) throw new Error('Manifest exceeds the size limit')
  const value = JSON.parse(await readFile(metadata, 'utf8')) as Partial<PackageManifest>
  if (value.format !== 1 || value.product !== 'hulala' || !['foundation', 'workbench'].includes(value.stage || '')
    || typeof value.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(value.version)
    || typeof value.target !== 'string' || !/^(darwin|linux|win32)-(arm64|x64)$/.test(value.target)
    || !safePackagePath(value.entrypoint) || !Array.isArray(value.files) || value.files.length > 60000) throw new Error('Invalid package manifest')
  if (value.stage === 'workbench' && value.entrypoint !== 'bin/' + (value.target.startsWith('win32-') ? 'hulala.exe' : 'hulala')) throw new Error('Invalid workbench entrypoint')
  const names = new Set<string>()
  for (const entry of value.files) {
    if (!entry || !safePackagePath(entry.path) || entry.path === 'manifest.json' || names.has(entry.path)
      || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid package file entry')
    names.add(entry.path)
    if (entry.mode !== undefined && (!Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777)) throw new Error('Invalid package mode')
  }
  const runtimeFiles = value.stage === 'workbench' ? [
    'runtime/bin/' + (value.target.startsWith('win32-') ? 'bun.exe' : 'bun'),
    'runtime/runtime/host.js', 'runtime/host/browser.js', 'runtime/host/worker.js', 'runtime/host/remote-entry.js',
    'runtime/remote-manifest.json', 'settings/ui.jsonc', 'settings/system.jsonc',
  ] : []
  if (value.stage === 'workbench' && (value.protocol !== 1 || value.dataFormat !== 1 || !/^[a-f0-9]{64}$/.test(value.lockSha256 || ''))) throw new Error('Unsupported package protocol/data format or missing lock identity')
  for (const path of [value.entrypoint, 'web/index.html', 'web/drawing.html', 'LICENSE', 'THIRD_PARTY_NOTICES.md', ...runtimeFiles]) {
    if (!names.has(path)) throw new Error(`Package is missing ${path}`)
  }
  const canonical = await realpath(root)
  const actual = await packageFiles(canonical)
  if (actual.length !== value.files.length) throw new Error('Unexpected or missing package files')
  const byPath = new Map(actual.map(entry => [entry.path, entry]))
  for (const entry of value.files) {
    const found = byPath.get(entry.path)
    if (!found || found.size !== entry.size || found.sha256 !== entry.sha256) throw new Error(`Integrity mismatch: ${entry.path}`)
    if (process.platform !== 'win32' && entry.mode !== undefined && ((found.mode ?? 0) & 0o111) !== (entry.mode & 0o111)) throw new Error(`Executable permission mismatch: ${entry.path}`)
  }
  return value as PackageManifest
}
