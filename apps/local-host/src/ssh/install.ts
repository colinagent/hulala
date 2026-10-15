import type { SFTPWrapper, Stats } from 'ssh2'
import { join } from 'node:path'
import type { SshConnection } from './connection'
import { remoteCommand, remoteJoin, verifyRemotePackage } from './package'
import { HttpError } from '../http'
import { mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises'
import { selectRelease } from '@hulala/distribution/channels'
import { downloadArchive, fileSha256, unpackRelease } from '@hulala/distribution/archive'
import { verifyPackage } from '@hulala/distribution/manifest'
import type { ReleaseTarget } from '@hulala/distribution/targets'

const missing = (error: unknown) => (error as { code?: number })?.code === 2
const sftpStat = (sftp: SFTPWrapper, path: string) => new Promise<Stats | null>((resolve, reject) => sftp.lstat(path, (error, metadata) => error ? missing(error) ? resolve(null) : reject(error) : resolve(metadata)))

/** Transfers only locally verified public package files through the verified
 * SSH connection. User data is outside this versioned installation directory. */
export class SshPackages {
  private readonly downloads = new Map<string, Promise<string>>()
  constructor(private readonly directory: string, private readonly ownRuntime?: string, private readonly download?: { root: string; version: string }) {}
  private acquire(target: ReleaseTarget): Promise<string> {
    const current = this.downloads.get(target)
    if (current) return current
    const pending = (async () => {
      const { root, version } = this.download!
      const { asset, release } = await selectRelease({ version }, target)
      const cache = join(root, 'runtime/remote-packages'), destination = join(cache, version + '-' + target + '-' + asset.manifestSha256.slice(0, 24))
      const check = async (path: string) => {
        const manifest = await verifyPackage(path)
        if (manifest.version !== version || manifest.target !== target || manifest.dataFormat !== release.dataFormat || await fileSha256(join(path, 'manifest.json')) !== asset.manifestSha256) throw new Error('Remote platform package does not match its release index')
        await verifyRemotePackage(join(path, 'runtime'))
      }
      if (await stat(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error })) { await check(destination); return join(destination, 'runtime') }
      await mkdir(cache, { recursive: true, mode: 0o700 })
      const temporary = await mkdtemp(join(cache, '.download-'))
      try {
        const archive = join(temporary, 'package.tar.gz')
        await downloadArchive(asset.url, archive, asset.sha256)
        const extracted = await unpackRelease(archive, temporary, asset.sha256)
        await check(extracted.directory)
        try { await rename(extracted.directory, destination) }
        catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code || '')) throw error; await check(destination) }
        return join(destination, 'runtime')
      } finally { await rm(temporary, { recursive: true, force: true }) }
    })()
    this.downloads.set(target, pending)
    void pending.catch(() => { if (this.downloads.get(target) === pending) this.downloads.delete(target) })
    return pending
  }
  async ensure(connection: SshConnection) {
    let platform: 'darwin' | 'linux' | 'win32', arch: 'arm64' | 'x64'
    try {
      const [os, cpu] = (await connection.capture('uname -s && uname -m', 1024)).trim().split(/\s+/)
      if (os !== 'Darwin' && os !== 'Linux') throw new HttpError(409, 'ssh_platform_unsupported', 'Remote operating system is not supported')
      platform = os === 'Darwin' ? 'darwin' : 'linux'
      if (!['aarch64', 'arm64', 'x86_64', 'amd64'].includes(cpu!)) throw new HttpError(409, 'ssh_platform_unsupported', 'Remote CPU architecture is not supported')
      arch = cpu === 'aarch64' || cpu === 'arm64' ? 'arm64' : 'x64'
    } catch (error) {
      if (error instanceof HttpError && error.code === 'ssh_platform_unsupported') throw error
      const cpu = (await connection.capture('cmd.exe /d /c echo %PROCESSOR_ARCHITECTURE%', 1024)).trim()
      if (cpu !== 'AMD64') throw new HttpError(409, 'ssh_platform_unsupported', 'Remote platform is not supported')
      platform = 'win32'; arch = 'x64'
    }
    const target = `${platform}-${arch}`
    let local = join(this.directory, target)
    let available = await Bun.file(join(local, 'remote-manifest.json')).exists()
    if (!available && this.ownRuntime && target === `${process.platform}-${process.arch}`) {
      local = this.ownRuntime; available = await Bun.file(join(local, 'remote-manifest.json')).exists()
    }
    if (!available && this.download) {
      try { local = await this.acquire(target as ReleaseTarget); available = true }
      catch { throw new HttpError(409, 'ssh_package_missing', `The verified remote Host package for ${target} ${this.download.version} is unavailable. Use a published browser release, or set HULALA_REMOTE_PACKAGES to locally built platform packages.`) }
    }
    if (!available) throw new HttpError(409, 'ssh_package_missing', `The public remote Host package for ${target} is not installed locally. Install that platform package before connecting.`)
    const { manifest, hash } = await verifyRemotePackage(local)
    if (manifest.target !== target) throw new Error('Remote package target mismatch')
    const sftp = await connection.sftp()
    try {
      const home = await new Promise<string>((resolve, reject) => sftp.realpath('.', (error, value) => error ? reject(error) : resolve(value)))
      const directory = remoteJoin(home, '.config/hulala/runtime/browser-host', manifest.version + '-' + hash.slice(0, 20))
      const execute = (action: string) => remoteCommand(platform, remoteJoin(directory, 'bin', platform === 'win32' ? 'bun.exe' : 'bun'), remoteJoin(directory, 'host/remote-entry.js'), action, ...(action === 'verify' ? [hash] : []))
      if (await sftpStat(sftp, remoteJoin(directory, 'remote-manifest.json'))) {
        await connection.capture(execute('verify'), 4096)
        return { directory, home, platform, arch, version: manifest.version, startCommand: execute('start'), stopCommand: execute('stop') }
      }
      const created = new Set<string>()
      const mkdir = async (path: string): Promise<void> => {
        if (created.has(path) || path === '/' || path === '.') return
        const existing = await sftpStat(sftp, path)
        if (existing) { if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('Remote installation parent is not a regular directory'); created.add(path); return }
        const parent = path.slice(0, path.lastIndexOf('/')) || '/'
        await mkdir(parent)
        await new Promise<void>((resolve, reject) => sftp.mkdir(path, { mode: 0o700 }, error => error ? reject(error) : resolve()))
        created.add(path)
      }
      await mkdir(directory)
      // Prepare directories before concurrent transfer, avoiding mkdir races.
      for (const file of manifest.files) {
        const parent = file.path.slice(0, file.path.lastIndexOf('/'))
        if (file.path.includes('/')) await mkdir(remoteJoin(directory, parent))
      }
      const queue = [...manifest.files]
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (queue.length) {
          const file = queue.shift()!
          const destination = remoteJoin(directory, file.path)
          if ((await sftpStat(sftp, destination))?.isSymbolicLink()) throw new Error('Remote package destination is a symlink')
          await new Promise<void>((resolve, reject) => sftp.fastPut(join(local, file.path), destination, { mode: (file.mode ?? 0o644) & 0o755, concurrency: 8 }, error => error ? reject(error) : resolve()))
          // fastPut treats unsupported chmod as best-effort. Executable mode is
          // required for the bundled Bun and native subprocess helpers.
          await new Promise<void>((resolve, reject) => sftp.chmod(destination, (file.mode ?? 0o644) & 0o755, error => error ? reject(error) : resolve()))
        }
      }))
      await new Promise<void>((resolve, reject) => sftp.fastPut(join(local, 'remote-manifest.json'), remoteJoin(directory, 'remote-manifest.json'), { mode: 0o600 }, error => error ? reject(error) : resolve()))
      await connection.capture(execute('verify'), 4096)
      return { directory, home, platform, arch, version: manifest.version, startCommand: execute('start'), stopCommand: execute('stop') }
    } finally { sftp.end() }
  }
}
