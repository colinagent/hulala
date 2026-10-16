import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { SshHost } from '@hulala/workbench-contracts/ssh'
import { writePrivateJson } from '../config'
import { HttpError } from '../http'
import type { SshHosts } from './hosts'

const keyMap = z.record(z.string(), z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/))
const endpoint = (host: SshHost) => `[${host.hostname.toLowerCase()}]:${host.port}`
export type HostKeyChallenge = { hostId: string; endpoint: string; fingerprint: string; previous?: string; expiresAt: number }

export class SshTrust {
  private keys: Record<string, string> = {}
  private challenges = new Map<string, HostKeyChallenge>()
  private writes: Promise<unknown> = Promise.resolve()
  constructor(private readonly root: string) {}
  async load() {
    try { this.keys = keyMap.parse(JSON.parse(await readFile(join(this.root, 'config/ssh/known-hosts.json'), 'utf8'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  verify(host: SshHost, key: Buffer): boolean {
    const address = endpoint(host)
    const fingerprint = 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
    if (this.keys[address] === fingerprint) return true
    this.challenges.set(host.id, { hostId: host.id, endpoint: address, fingerprint, previous: this.keys[address], expiresAt: Date.now() + 300000 })
    return false
  }
  challenge(id: string): HostKeyChallenge | undefined {
    const challenge = this.challenges.get(id)
    return challenge && challenge.expiresAt > Date.now() ? { ...challenge } : undefined
  }
  accept(host: SshHost, fingerprint: string): Promise<void> {
    const operation = this.writes.then(async () => {
      const challenge = this.challenge(host.id)
      if (!challenge || challenge.endpoint !== endpoint(host) || challenge.fingerprint !== fingerprint) throw new HttpError(409, 'ssh_trust_expired', 'The SSH host confirmation expired. Connect again to inspect its current key.')
      const next = { ...this.keys, [challenge.endpoint]: fingerprint }
      await writePrivateJson(join(this.root, 'config/ssh/known-hosts.json'), next)
      this.keys = next
      this.challenges.delete(host.id)
    })
    this.writes = operation.catch(() => undefined)
    return operation
  }
}

export interface SshConnection {
  readonly client: Client
  readonly host: SshHost
  readonly closed: Promise<void>
  alive(): boolean
  exec(command: string, signal?: AbortSignal): Promise<ClientChannel>
  capture(command: string, limit?: number, input?: string, timeoutMs?: number): Promise<string>
  sftp(): Promise<SFTPWrapper>
  stop(): Promise<void>
}

export async function connectSsh(host: SshHost, hosts: SshHosts, trust: SshTrust, signal?: AbortSignal): Promise<SshConnection> {
  signal?.throwIfAborted()
  if (host.proxyConfigured) throw new HttpError(409, 'ssh_proxy_unsupported', 'This SSH alias uses ProxyJump or ProxyCommand. The direct SSH connection requires a directly reachable host; edit its connection details before continuing.')
  const credentials = await hosts.credentials(host)
  const config: ConnectConfig = { host: host.hostname, port: host.port, username: host.user,
    readyTimeout: 20000, keepaliveInterval: 10000, keepaliveCountMax: 3,
    hostVerifier: (key: Buffer) => trust.verify(host, key),
  }
  if (host.authMethod === 'password') {
    if (!credentials.password) throw new HttpError(409, 'ssh_password_required', 'The SSH password is no longer available. Edit this host to enter it again.')
    config.password = credentials.password
  } else if (host.authMethod === 'keyFile') {
    const path = await hosts.identity(host.identityFile || '')
    if ((await stat(path)).size > 1024 * 1024) throw new HttpError(400, 'ssh_identity_invalid', 'Private key is too large')
    config.privateKey = await readFile(path)
    config.passphrase = credentials.passphrase
  } else {
    config.agent = process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? 'pageant' : undefined)
    if (!config.agent && host.identityFile) config.privateKey = await readFile(await hosts.identity(host.identityFile))
    if (!config.agent && !config.privateKey) throw new HttpError(409, 'ssh_agent_unavailable', 'No SSH agent is available. Start your agent or choose a private key.')
  }
  const client = new Client()
  let ended = false
  const closed = new Promise<void>(resolve => client.once('close', () => { ended = true; resolve() }))
  const abort = () => client.destroy()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    await new Promise<void>((resolve, reject) => {
      client.once('ready', resolve)
      client.once('error', error => {
        const challenge = trust.challenge(host.id)
        reject(challenge ? new HttpError(409, challenge.previous ? 'ssh_host_key_changed' : 'ssh_host_key_unknown',
          challenge.previous ? 'The SSH host key has changed. Verify its fingerprint before reconnecting.' : 'Confirm this SSH host fingerprint before connecting.')
          : new HttpError(502, 'ssh_connection_failed', error.level === 'client-authentication' ? 'SSH authentication failed. Check the selected credential or key.' : 'Could not establish the SSH connection. Check the host, port, and network.'))
      })
      client.once('close', () => reject(new HttpError(502, 'ssh_connection_closed', 'SSH connection closed before it was ready')))
      client.connect(config)
    })
  } catch (error) { client.destroy(); throw error }
  finally { signal?.removeEventListener('abort', abort) }
  // Keep an error handler after initial connection; callers observe closed.
  client.on('error', () => {})
  const exec = (command: string, abortSignal?: AbortSignal) => new Promise<ClientChannel>((resolve, reject) => {
    if (abortSignal?.aborted) { reject(abortSignal.reason); return }
    client.exec(command, (error, stream) => {
      if (error) { reject(new HttpError(502, 'ssh_exec_failed', 'Could not start the remote command')); return }
      const stop = () => { stream.signal('TERM'); stream.close() }
      if (abortSignal?.aborted) { stop(); reject(abortSignal.reason); return }
      abortSignal?.addEventListener('abort', stop, { once: true })
      stream.once('close', () => abortSignal?.removeEventListener('abort', stop))
      resolve(stream)
    })
  })
  return {
    client, host, closed, alive: () => !ended, exec,
    async capture(command, limit = 1048576, input?: string, timeoutMs = 30000) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(new Error('Remote command timed out')), Math.max(1000, Math.min(120000, timeoutMs)))
      try {
        const stream = await exec(command, controller.signal)
        return await new Promise<string>((resolve, reject) => {
          let stdout = '', total = 0
          stream.on('data', (chunk: Buffer) => { total += chunk.length; if (total > limit) { stream.close(); reject(new Error('Remote output limit exceeded')); return }; stdout += chunk.toString() })
          stream.stderr.on('data', (chunk: Buffer) => { total += chunk.length; if (total > limit) { stream.close(); reject(new Error('Remote output limit exceeded')) } })
          stream.once('error', reject)
          stream.once('close', (code: number | undefined) => { if (controller.signal.aborted) reject(controller.signal.reason); else if (code !== 0) reject(new HttpError(502, 'ssh_command_failed', 'The remote command failed')); else resolve(stdout) })
          stream.end(input)
        })
      } finally { clearTimeout(timeout) }
    },
    sftp: () => new Promise((resolve, reject) => client.sftp((error, sftp) => error ? reject(error) : resolve(sftp))),
    async stop() { if (ended) return; client.end(); const timeout = setTimeout(() => client.destroy(), 2000); try { await closed } finally { clearTimeout(timeout) } },
  }
}
