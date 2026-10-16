import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Server, utils, type Connection } from 'ssh2'
import { SshHosts, type SecretStore } from '../src/ssh/hosts'
import { connectSsh, SshTrust, type SshConnection } from '../src/ssh/connection'
import { ProtectedPaths, selectedSshIdentityPaths } from '../src/protectedPaths'

class MemorySecrets implements SecretStore {
  values = new Map<string, string>()
  locked = false
  async get(name: string) { if (this.locked) throw new Error('locked'); return this.values.get(name) || null }
  async set(name: string, value: string) { if (this.locked) throw new Error('locked'); this.values.set(name, value) }
  async delete(name: string) { this.values.delete(name) }
}
const input = { alias: 'Synthetic SSH', hostname: '127.0.0.1', user: 'test-user', port: 22, authMethod: 'password' as const, password: 'test-only-secret', rememberSecret: true }

test('SSH config aliases use native precedence and retain a stable identity across reloads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-ssh-config-'))
  try {
    await mkdir(join(root, '.ssh/fragments'), { recursive: true })
    await writeFile(join(root, '.ssh/config'), `Include "${join(root, '.ssh/fragments/*')}"\nHost *\n  User fallback\n`)
    await writeFile(join(root, '.ssh/fragments/qa'), 'Host fixture\n  HostName 127.0.0.1\n  User synthetic\n  Port 2222\nHost *.wildcard\n  Port 2223\n')
    const hosts = new SshHosts(root, new MemorySecrets(), root)
    await hosts.refreshConfig()
    expect(hosts.list()).toHaveLength(1)
    expect(hosts.list()[0]).toMatchObject({ alias: 'fixture', user: 'synthetic', port: 2222, source: 'config' })
    const id = hosts.list()[0]!.id
    await hosts.refreshConfig()
    expect(hosts.get(id).alias).toBe('fixture')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('SSH metadata contains only secret references and a locked system store never falls back to plaintext', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-ssh-secrets-'))
  try {
    const secrets = new MemorySecrets(), hosts = new SshHosts(root, secrets, root)
    await hosts.load()
    const host = await hosts.save(input)
    expect(host.hasPassword).toBeTrue()
    expect(JSON.stringify(host)).not.toContain(input.password)
    expect(await readFile(hosts.filename, 'utf8')).not.toContain(input.password)
    expect((await hosts.credentials(host)).password).toBe(input.password)
    secrets.locked = true
    await expect(hosts.save({ ...input, alias: 'Locked' })).rejects.toMatchObject({ code: 'ssh_secret_unavailable' })
    expect(hosts.list()).toHaveLength(1)
    const sessionOnly = await hosts.save({ ...input, alias: 'Session only', rememberSecret: false })
    expect((await hosts.credentials(sessionOnly)).password).toBe(input.password)
    const restarted = new SshHosts(root, secrets, root)
    await restarted.load()
    expect(restarted.list().find(value => value.id === sessionOnly.id)?.hasPassword).toBeFalse()
    expect(await readFile(hosts.filename, 'utf8')).not.toContain(input.password)
    secrets.locked = false
    await expect(hosts.save({ ...input, id: host.id, hostname: 'changed.example.invalid', password: undefined })).rejects.toMatchObject({ code: 'ssh_password_required' })
    await hosts.remove(host.id)
    expect(secrets.values.size).toBe(0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('selected SSH private keys are protected from Workspace reads even outside the SSH directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-ssh-identity-'))
  try {
    const key = join(root, 'project-key'), key2 = join(root, 'another-key')
    await writeFile(key, 'synthetic key fixture'); await writeFile(key2, 'another synthetic key fixture')
    const hosts = new SshHosts(join(root, 'state'), new MemorySecrets(), root)
    await hosts.load()
    await hosts.save({ ...input, authMethod: 'keyFile', identityFile: key, password: undefined })
    const guard = new ProtectedPaths([], () => selectedSshIdentityPaths(join(root, 'state/config')))
    await expect(guard.assert(key)).rejects.toMatchObject({ code: 'credential_path_protected' })
    await Promise.all([hosts.refreshConfig(), hosts.save({ ...input, authMethod: 'keyFile', identityFile: key2, password: undefined })])
    await expect(guard.assert(key2)).rejects.toMatchObject({ code: 'credential_path_protected' })
    await expect(guard.assert(root, true)).rejects.toMatchObject({ code: 'credential_path_protected' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('SSH rejects unknown and changed host keys before authentication and accepts only the current challenge', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-ssh-transport-'))
  const clients = new Set<Connection>()
  let authenticated = 0
  const serve = async (port = 0) => {
    const server = new Server({ hostKeys: [utils.generateKeyPairSync('ed25519').private] }, client => {
      clients.add(client)
      client.on('error', () => {})
      client.once('close', () => clients.delete(client))
      client.on('authentication', context => {
        authenticated++
        if (context.method === 'password' && context.username === input.user && context.password === input.password) context.accept()
        else context.reject()
      })
      client.on('ready', () => client.on('session', accept => {
        const session = accept()
        session.on('exec', (accept, _reject, info) => { const stream = accept(); stream.write('remote:' + info.command); stream.exit(0); stream.end() })
      }))
    })
    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve))
    return server
  }
  let server = await serve(), connection: SshConnection | undefined
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing SSH address')
    const hosts = new SshHosts(root, new MemorySecrets(), root), trust = new SshTrust(root)
    await hosts.load(); await trust.load()
    const host = await hosts.save({ ...input, port: address.port })
    await expect(connectSsh(host, hosts, trust)).rejects.toMatchObject({ code: 'ssh_host_key_unknown' })
    expect(authenticated).toBe(0)
    const first = trust.challenge(host.id)!
    expect(first.fingerprint).toStartWith('SHA256:')
    await expect(trust.accept(host, 'SHA256:' + 'A'.repeat(43))).rejects.toMatchObject({ code: 'ssh_trust_expired' })
    await trust.accept(host, first.fingerprint)
    connection = await connectSsh(host, hosts, trust)
    expect(await connection.capture('synthetic-command')).toBe('remote:synthetic-command')
    await connection.stop(); connection = undefined
    for (const client of clients) client.end()
    await new Promise<void>(resolve => server.close(() => resolve()))
    server = await serve(address.port)
    const before = authenticated
    await expect(connectSsh(host, hosts, trust)).rejects.toMatchObject({ code: 'ssh_host_key_changed' })
    expect(authenticated).toBe(before)
    expect(trust.challenge(host.id)?.previous).toBe(first.fingerprint)
  } finally {
    await connection?.stop()
    for (const client of clients) client.end()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
}, 20000)
