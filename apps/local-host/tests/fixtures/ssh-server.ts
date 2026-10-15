import { Server, utils, type Connection, type ServerChannel } from 'ssh2'
import { connect } from 'node:net'
import { once } from 'node:events'
import { open, mkdir, lstat, realpath, readdir, readFile, chmod, type FileHandle } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute, sep } from 'node:path'
import type { SecretStore } from '../../src/ssh/hosts'

export class FixtureSecrets implements SecretStore {
  private values = new Map<string, string>()
  async get(name: string) { return this.values.get(name) || null }
  async set(name: string, value: string) { this.values.set(name, value) }
  async delete(name: string) { this.values.delete(name) }
}

/** Real SSH transport, filesystem-backed SFTP and loopback forwarding. Only
 * synthetic credentials and an explicitly injected temporary home are used. */
export async function sshFixture(root: string) {
  const home = await realpath(root)
  const clients = new Set<Connection>()
  const streams = new Set<ServerChannel>()
  const commandChildren = new Set<ReturnType<typeof Bun.spawn>>()
  let uploadedBytes = 0
  const failures: Array<{ command: string; code: number; stderr: string }> = []
  const scoped = (value: string) => {
    const path = resolve(home, value)
    const delta = relative(home, path)
    if (delta === '..' || delta.startsWith('..' + sep) || isAbsolute(delta)) throw new Error('Fixture path escaped temporary home')
    return path
  }
  const server = new Server({ hostKeys: [utils.generateKeyPairSync('ed25519').private] }, client => {
    clients.add(client); client.on('error', () => {}); client.once('close', () => clients.delete(client))
    client.on('authentication', context => context.method === 'password' && context.username === 'fixture' && context.password === 'fixture-password' ? context.accept() : context.reject())
    client.on('ready', () => {
      client.on('tcpip', (accept, reject, info) => {
        if (info.destIP !== '127.0.0.1') { reject(); return }
        const socket = connect(info.destPort, info.destIP)
        socket.once('error', () => reject())
        socket.once('connect', () => {
          const stream = accept(); streams.add(stream)
          stream.on('error', () => socket.destroy()); stream.once('close', () => { streams.delete(stream); socket.destroy() })
          socket.on('error', () => stream.close()); socket.pipe(stream).pipe(socket)
        })
      })
      client.on('session', accept => {
        const session = accept()
        session.on('exec', (accept, _reject, info) => {
          const channel = accept()
          let stderr = ''
          const child = Bun.spawn(['/bin/sh', '-c', info.command], { cwd: home, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
            env: { PATH: '/usr/bin:/bin', HOME: home, HULALA_HOME: join(home, '.config/hulala'), HULALA_WORKSPACE_ROOT: join(home, 'hulala-workspace'), PI_CODING_AGENT_DIR: join(home, 'pi') },
          })
          commandChildren.add(child)
          channel.on('error', () => child.kill())
          channel.on('data', (bytes: Buffer) => { if (!child.killed) child.stdin.write(bytes) })
          channel.once('end', () => { void child.stdin.end() })
          const copy = async (source: ReadableStream<Uint8Array>, destination: NodeJS.WritableStream) => {
            for await (const chunk of source) { if (!destination.write(chunk)) await once(destination, 'drain') }
          }
          const copyError = async () => { for await (const bytes of child.stderr) { stderr += new TextDecoder().decode(bytes); if (!channel.stderr.write(bytes)) await once(channel.stderr, 'drain') } }
          void Promise.all([copy(child.stdout, channel), copyError(), child.exited]).then(([, , code]) => {
            if (code) failures.push({ command: info.command, code, stderr: stderr.slice(0, 2000) })
            channel.exit(code); channel.end(); commandChildren.delete(child)
          }).catch(() => { child.kill(); channel.close(); commandChildren.delete(child) })
          channel.once('close', () => { if (child.exitCode === null) child.kill() })
        })
        session.on('sftp', accept => {
          const sftp = accept(), handles = new Map<number, FileHandle>(), directories = new Map<number, string | null>()
          let next = 1
          const run = (id: number, action: () => Promise<void>) => { void action().catch(error => sftp.status(id, (error as NodeJS.ErrnoException).code === 'ENOENT' ? 2 : 4)) }
          const attrs = async (path: string) => {
            const value = await lstat(scoped(path))
            return { mode: value.mode, uid: value.uid, gid: value.gid, size: value.size, atime: Math.floor(value.atimeMs / 1000), mtime: Math.floor(value.mtimeMs / 1000) }
          }
          sftp.on('REALPATH', (id, path) => run(id, async () => { const canonical = await realpath(scoped(path)); sftp.name(id, [{ filename: canonical, longname: canonical, attrs: await attrs(canonical) }]) }))
          sftp.on('LSTAT', (id, path) => run(id, async () => { sftp.attrs(id, await attrs(path)) }))
          sftp.on('STAT', (id, path) => run(id, async () => { sftp.attrs(id, await attrs(path)) }))
          sftp.on('MKDIR', (id, path, metadata) => run(id, async () => { await mkdir(scoped(path), { mode: metadata.mode || 0o700 }); sftp.status(id, 0) }))
          sftp.on('OPENDIR', (id, path) => run(id, async () => { const canonical = scoped(path); if (!(await lstat(canonical)).isDirectory()) throw new Error('Not a fixture directory'); const key = next++, bytes = Buffer.alloc(4); bytes.writeUInt32BE(key); directories.set(key, canonical); sftp.handle(id, bytes) }))
          sftp.on('READDIR', (id, bytes) => run(id, async () => { const key = bytes.readUInt32BE(0), path = directories.get(key); if (!path) { sftp.status(id, 1); return }; directories.set(key, null); const entries = await readdir(path); if (!entries.length) { sftp.status(id, 1); return }; sftp.name(id, await Promise.all(entries.map(async filename => ({ filename, longname: filename, attrs: await attrs(join(path, filename)) })))) }))
          sftp.on('OPEN', (id, path, flags, metadata) => run(id, async () => {
            const handle = await open(scoped(path), flags & 8 ? 'w' : 'r', metadata.mode || 0o600)
            const key = next++, bytes = Buffer.alloc(4); bytes.writeUInt32BE(key); handles.set(key, handle); sftp.handle(id, bytes)
          }))
          sftp.on('WRITE', (id, bytes, offset, data) => run(id, async () => {
            const file = handles.get(bytes.readUInt32BE(0)); if (!file) throw new Error('Unknown fixture handle')
            await file.write(data, 0, data.length, offset); uploadedBytes += data.length; sftp.status(id, 0)
          }))
          sftp.on('FSTAT', (id, bytes) => run(id, async () => { const file = handles.get(bytes.readUInt32BE(0)); if (!file) throw new Error('Unknown handle'); const value = await file.stat(); sftp.attrs(id, { mode: value.mode, size: value.size, uid: value.uid, gid: value.gid, atime: Math.floor(value.atimeMs / 1000), mtime: Math.floor(value.mtimeMs / 1000) }) }))
          sftp.on('FSETSTAT', (id, bytes, metadata) => run(id, async () => { const file = handles.get(bytes.readUInt32BE(0)); if (!file || metadata.mode === undefined) throw new Error('Invalid fixture chmod'); await file.chmod(metadata.mode); sftp.status(id, 0) }))
          sftp.on('SETSTAT', (id, path, metadata) => run(id, async () => { if (metadata.mode === undefined) throw new Error('Invalid fixture chmod'); await chmod(scoped(path), metadata.mode); sftp.status(id, 0) }))
          sftp.on('CLOSE', (id, bytes) => run(id, async () => { const key = bytes.readUInt32BE(0); await handles.get(key)?.close(); handles.delete(key); directories.delete(key); sftp.status(id, 0) }))
          sftp.once('close', () => { for (const file of handles.values()) void file.close().catch(() => undefined) })
        })
      })
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture address')
  return {
    port: address.port, home, uploadedBytes: () => uploadedBytes, failures,
    disconnect: () => { for (const client of clients) client.end() },
    async stop() {
      for (const child of commandChildren) child.kill()
      for (const stream of streams) stream.destroy()
      for (const client of clients) client.end()
      // Remote Hosts intentionally outlive the SSH startup command. Reap only
      // this fixture's recorded daemons before deleting its temporary files.
      const directory = join(home, '.config/hulala/server/remote-hosts')
      const pids: number[] = []
      for (const entry of await readdir(directory).catch(() => [])) {
        try { const value = JSON.parse(await readFile(join(directory, entry, 'connection.json'), 'utf8')) as { pid: number }; if (value.pid > 0) { pids.push(value.pid); process.kill(value.pid, 'SIGTERM') } } catch {}
      }
      for (let i = 0; i < 100; i++) { if (pids.every(pid => { try { process.kill(pid, 0); return false } catch { return true } })) break; await Bun.sleep(50) }
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}
