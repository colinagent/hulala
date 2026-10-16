import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { saveSshHostSchema, sshHostSchema, type SaveSshHost, type SshHost } from '@hulala/workbench-contracts/ssh'
import { writePrivateJson } from '../config'
import { HttpError } from '../http'
import { readSshConfig } from './config'

export interface SecretStore { get(name: string): Promise<string | null>; set(name: string, value: string): Promise<void>; delete(name: string): Promise<unknown> }
export function systemSecrets(root: string): SecretStore {
  const service = 'ai.hulala.ssh.' + createHash('sha256').update(root).digest('hex').slice(0, 24)
  return {
    get: name => Bun.secrets.get({ service, name }),
    set: (name, value) => Bun.secrets.set({ service, name, value }),
    delete: name => Bun.secrets.delete({ service, name }),
  }
}
type Credentials = { password?: string; passphrase?: string }
const secretSchema = z.object({ password: z.string().optional(), passphrase: z.string().optional() }).strict()
const configSchema = z.object({ version: z.literal(1), hosts: z.array(sshHostSchema) })

/** Host metadata is non-secret. Passwords and passphrases use the OS store, or
 * an explicitly selected process-only store; there is no plaintext fallback. */
export class SshHosts {
  private hosts: SshHost[] = []
  private imported: SshHost[] = []
  private readonly ephemeral = new Map<string, Credentials>()
  private writes: Promise<unknown> = Promise.resolve()
  private protectionWrites: Promise<unknown> = Promise.resolve()
  readonly filename: string
  constructor(readonly root: string, private readonly secrets: SecretStore = systemSecrets(root), readonly home = homedir()) {
    this.filename = join(root, 'config/ssh/hosts.json')
  }
  async load() {
    try { this.hosts = configSchema.parse(JSON.parse(await readFile(this.filename, 'utf8'))).hosts }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    await this.protectIdentities(this.hosts)
  }
  async refreshConfig() { this.imported = await readSshConfig(join(this.home, '.ssh/config'), this.home); await this.protectIdentities(this.hosts) }
  private async protectIdentities(hosts: SshHost[]) {
    const current = [...hosts, ...this.imported].flatMap(host => host.identityFile ? [host.identityFile.startsWith('~/') ? join(this.home, host.identityFile.slice(2)) : host.identityFile] : [])
    const operation = this.protectionWrites.then(async () => {
      const path = join(this.root, 'config/ssh/selected-identities.json')
      const previous = await readFile(path, 'utf8').then(value => z.array(z.string()).parse(JSON.parse(value))).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error })
      await writePrivateJson(path, [...new Set([...previous, ...current])].filter(path => isAbsolute(path)))
    })
    this.protectionWrites = operation.catch(() => undefined)
    await operation
  }
  list(): SshHost[] { return [...this.hosts, ...this.imported.filter(item => !this.hosts.some(host => host.id === item.id))].map(host => this.public(host)) }
  get(id: string): SshHost {
    const host = [...this.hosts, ...this.imported].find(host => host.id === id)
    if (!host) throw new HttpError(404, 'ssh_host_not_found', 'SSH host not found')
    return { ...host }
  }
  async resolve(id: string): Promise<SshHost> {
    if (![...this.hosts, ...this.imported].some(host => host.id === id)) await this.refreshConfig()
    return this.get(id)
  }
  private public(host: SshHost): SshHost {
    const available = host.credentialStorage !== 'session' || this.ephemeral.has(host.credentialID || '')
    return { ...host, hasPassword: available && !!host.hasPassword, hasPassphrase: available && !!host.hasPassphrase }
  }
  async credentials(host: SshHost): Promise<Credentials> {
    if (!host.credentialID) return {}
    if (host.credentialStorage === 'session') return this.ephemeral.get(host.credentialID) || {}
    try { const value = await this.secrets.get(host.credentialID); return value ? secretSchema.parse(JSON.parse(value)) : {} }
    catch { throw new HttpError(503, 'ssh_secret_unavailable', 'The system credential store is unavailable. Unlock it, or save a credential for this service session only.') }
  }
  async identity(path: string): Promise<string> {
    const expanded = path.startsWith('~/') ? join(this.home, path.slice(2)) : path
    if (!isAbsolute(expanded) || expanded.includes('\0')) throw new HttpError(400, 'ssh_identity_invalid', 'Choose an absolute private key path on the local Host')
    const canonical = await realpath(expanded)
    const metadata = await stat(canonical)
    if (!metadata.isFile() || metadata.size > 1024 * 1024) throw new HttpError(400, 'ssh_identity_invalid', 'Choose a private key file smaller than 1 MiB')
    return canonical
  }
  save(input: SaveSshHost): Promise<SshHost> {
    const value = saveSshHostSchema.parse(input)
    const operation = this.writes.then(async () => {
      const old = value.id ? this.get(value.id) : undefined
      const id = old?.id || crypto.randomUUID()
      const identityFile = value.authMethod === 'keyFile' ? await this.identity(value.identityFile || '') : undefined
      const unchangedAuth = old && old.authMethod === value.authMethod && old.user === value.user && old.hostname === value.hostname && old.port === value.port
      const previous = unchangedAuth ? await this.credentials(old) : {}
      const credentials: Credentials = value.authMethod === 'password' ? { password: value.password || previous.password }
        : value.authMethod === 'keyFile' ? { passphrase: value.passphrase || previous.passphrase } : {}
      if (value.authMethod === 'password' && !credentials.password) throw new HttpError(400, 'ssh_password_required', 'Enter the SSH password')
      const hasSecret = !!(credentials.password || credentials.passphrase)
      // Write under a new opaque identity, then publish metadata. A failed file
      // write cannot replace credentials still referenced by the saved record.
      const credentialID = hasSecret ? crypto.randomUUID() : undefined
      const credentialStorage = value.rememberSecret ? 'system' : 'session'
      if (credentialID) {
        if (value.rememberSecret) try { await this.secrets.set(credentialID, JSON.stringify(credentials)) }
        catch { throw new HttpError(503, 'ssh_secret_unavailable', 'Could not save in the system credential store. Unlock it or uncheck Remember secret to use it only until Hulala stops.') }
        else this.ephemeral.set(credentialID, credentials)
      }
      const host: SshHost = { id, alias: value.alias, hostname: value.hostname, user: value.user, port: value.port,
        authMethod: value.authMethod, source: 'manual', ...(identityFile ? { identityFile } : {}),
        ...(credentialID ? { credentialID, credentialStorage, hasPassword: !!credentials.password, hasPassphrase: !!credentials.passphrase } : {}) }
      const next = [...this.hosts.filter(item => item.id !== id), host]
      try { await this.protectIdentities(next); await writePrivateJson(this.filename, { version: 1, hosts: next }) }
      catch (error) { if (credentialID) await this.clearCredential(host); throw error }
      this.hosts = next
      if (old) await this.clearCredential(old)
      return this.public(host)
    })
    this.writes = operation.catch(() => undefined)
    return operation
  }
  remove(id: string): Promise<void> {
    const operation = this.writes.then(async () => {
      const host = this.get(id), next = this.hosts.filter(host => host.id !== id)
      await this.clearCredential(host)
      await writePrivateJson(this.filename, { version: 1, hosts: next })
      this.hosts = next
    })
    this.writes = operation.catch(() => undefined)
    return operation
  }
  private async clearCredential(host: SshHost) {
    if (!host.credentialID) return
    if (host.credentialStorage === 'session') this.ephemeral.delete(host.credentialID)
    else await this.secrets.delete(host.credentialID)
  }
  stop() { this.ephemeral.clear() }
}
