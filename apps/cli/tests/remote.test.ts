/**
 * Reaching a Host on another machine.
 *
 * The parts here are the ones a remote Host cannot tell us about itself: which
 * aliases exist, what a probe means, which side is behind on protocol, and how a
 * forward is opened. All of it is pure or injected, so no test needs sshd.
 */
import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  hostsFromConfig,
  installRemote,
  liveSshRunner,
  listRemoteHosts,
  openTunnel,
  probeHost,
  quote,
  startRemoteHost,
  stopRemoteHost,
  tunnelArgs,
  verdictOf,
  type SshRunner,
  type TunnelSpawner,
} from '../src/remote/ssh.js'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'

const config = `
# machines
Host devbox
  HostName devbox.example
  User colin

Host gpu  build-*
  ProxyJump devbox

Host * !gpu
  ServerAliveInterval 30

Host work gpu
`

test('concrete aliases are read in order, patterns and exclusions are not', () => {
  expect(hostsFromConfig(config)).toEqual(['devbox', 'gpu', 'work'])
})

test('a missing config lists no machines instead of throwing', () => {
  expect(listRemoteHosts(join(mkdtempSync(join(tmpdir(), 'hulala-nossh-')), 'absent'))).toEqual([])
})

test('a config with aliases is read from ~/.ssh/config', () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-ssh-'))
  mkdirSync(join(home, '.ssh'))
  writeFileSync(join(home, '.ssh', 'config'), config)
  expect(listRemoteHosts(home)).toEqual(['devbox', 'gpu', 'work'])
})

/** A runner that answers each alias with a canned response and records the command. */
function runner(response: { code?: number | null; stdout?: string; stderr?: string }): {
  run: SshRunner
  commands: string[]
} {
  const commands: string[] = []
  return {
    commands,
    run: async (_alias, command) => {
      commands.push(command)
      return { code: response.code ?? 0, stdout: response.stdout ?? '', stderr: response.stderr ?? '' }
    },
  }
}

test('a machine without the command is uninstalled, not unreachable', async () => {
  const { run, commands } = runner({ stdout: '{"state":"uninstalled"}' })
  expect(await probeHost('devbox', run)).toEqual({ state: 'uninstalled' })
  // The probe asks a login shell, so a version-managed install is still found.
  expect(commands[0]).toContain('host status')
})

test('a running Host reports its version, protocol and origin', async () => {
  const { run } = runner({ stdout: '{"state":"running","version":"0.3.6","protocol":2,"httpUrl":"http://127.0.0.1:5000","pid":42}\n' })
  expect(await probeHost('devbox', run)).toEqual({
    state: 'running',
    version: '0.3.6',
    protocol: 2,
    httpUrl: 'http://127.0.0.1:5000',
  })
})

test('a stopped Host keeps what the record said', async () => {
  const { run } = runner({ stdout: '{"state":"stopped"}' })
  expect(await probeHost('devbox', run)).toEqual({ state: 'stopped', version: 'unknown', protocol: 0 })
})

test('a login banner before the JSON does not hide the answer', async () => {
  const { run } = runner({ stdout: 'Welcome to devbox\n{"state":"running","version":"0.3.6","protocol":2}\n' })
  expect(await probeHost('devbox', run)).toMatchObject({ state: 'running', version: '0.3.6' })
})

test('a failed connection is unreachable, with the reason', async () => {
  const { run } = runner({ code: 255, stderr: 'Permission denied (publickey).' })
  expect(await probeHost('devbox', run)).toEqual({ state: 'unreachable', reason: 'Permission denied (publickey).' })
})

test('unreadable output is unreachable, not "uninstalled"', async () => {
  const { run } = runner({ stdout: 'command not found' })
  expect(await probeHost('devbox', run)).toMatchObject({ state: 'unreachable' })
})

test('the verdict names the one action worth offering', () => {
  const client = { version: '0.3.6', protocol: 2 }
  expect(verdictOf({ state: 'uninstalled' }, client)).toBe('install')
  expect(verdictOf({ state: 'stopped', version: '0.3.6', protocol: 2 }, client)).toBe('start')
  expect(verdictOf({ state: 'running', version: '0.3.6', protocol: 2, httpUrl: '' }, client)).toBe('attach')
  expect(verdictOf({ state: 'running', version: '0.3.5', protocol: 2, httpUrl: '' }, client)).toBe('update')
  expect(verdictOf({ state: 'running', version: '0.4.0', protocol: 3, httpUrl: '' }, client)).toBe('client-update')
  expect(verdictOf({ state: 'running', version: '0.3.6', protocol: 1, httpUrl: '' }, client)).toBe('update')
  expect(verdictOf({ state: 'unreachable', reason: 'no route' }, client)).toBe('unreachable')
})

test('the forward is loopback-only and fails loudly', () => {
  const args = tunnelArgs('devbox', 4321, 5000, '/tmp/hulala.sock')
  expect(args).toContain('127.0.0.1:4321:127.0.0.1:5000')
  expect(args).toContain('ExitOnForwardFailure=yes')
  expect(args).toContain('BatchMode=yes')
  expect(args).toContain('ControlPath=/tmp/hulala.sock')
  expect(args.at(-1)).toBe('devbox')
  expect(args).toContain('-N')
})

test('a tunnel resolves once the local port answers, and killing it closes the port', async () => {
  // A forwarder that really listens on the forwarded port: the readiness wait is
  // what this pins, not the ssh process itself.
  let listening: ReturnType<typeof createServer> | undefined
  const spawner: TunnelSpawner = args => {
    const forward = args[args.indexOf('-L') + 1] ?? ''
    const port = Number(forward.split(':')[1])
    const server = createServer()
    server.listen(port, '127.0.0.1')
    listening = server
    return {
      kill: () => server.close(),
      onExit: () => undefined,
    }
  }
  // A free port: reserve one, release it, then let the forward take it.
  const reservation = createServer()
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const address = reservation.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  await new Promise<void>(resolve => reservation.close(() => resolve()))

  const tunnel = await openTunnel({ alias: 'devbox', localPort: address.port, remotePort: 5000, readyTimeoutMs: 2_000 }, spawner)
  expect(tunnel.port).toBe(address.port)
  tunnel.close()
  tunnel.close()
  listening?.close()
})

test('a forward that never comes up is an error, not a hang', async () => {
  const spawner: TunnelSpawner = () => ({ kill: () => undefined, onExit: () => undefined })
  const dead = createServer()
  await new Promise<void>(resolve => dead.listen(0, '127.0.0.1', resolve))
  const address = dead.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  await new Promise<void>(resolve => dead.close(() => resolve()))

  await expect(openTunnel({ alias: 'devbox', localPort: address.port, remotePort: 5000, readyTimeoutMs: 300 }, spawner))
    .rejects.toThrow('could not forward')
})

test('installing runs the website script with consent and without starting a UI', async () => {
  const { run, commands } = runner({})
  const result = await installRemote('devbox', run)
  expect(result.ok).toBe(true)
  expect(commands[0]).toContain('hulala.ai/install.sh')
  expect(commands[0]).toContain('HULALA_NO_START=1')
  expect(commands[0]).toContain('--yes')
})

test('starting the Host is one login-shell command', async () => {
  const { run, commands } = runner({})
  expect(await startRemoteHost('devbox', run)).toBe(true)
  expect(commands[0]).toContain('host start')
})

test('one-shot quotes survive an apostrophe in the command', () => {
  expect(quote(`echo 'hi'`)).toBe(`'echo '\\''hi'\\'''`)
})

test('an update stops the running daemon so the new release serves', async () => {
  // Installing replaces files, not the process: a daemon from the old release
  // keeps answering until it is stopped, and the next attach starts the new one.
  const { run, commands } = runner({})
  expect(await stopRemoteHost('devbox', run)).toBe(true)
  expect(commands[0]).toContain('host stop')
})

test('upgrading a machine is install, stop, then attach', async () => {
  const commands: string[] = []
  const run: SshRunner = async (_alias, command) => {
    commands.push(command)
    return { code: 0, stdout: '', stderr: '' }
  }
  expect((await installRemote('devbox', run)).ok).toBe(true)
  expect(await stopRemoteHost('devbox', run)).toBe(true)
  expect(commands.map(command => command.includes('install.sh') ? 'install' : command.includes('host stop') ? 'stop' : 'other'))
    .toEqual(['install', 'stop'])
})

test('a command that never answers is killed instead of waited on', async () => {
  // `/remote` says "checking…" while a probe is in flight: without a budget a
  // stalled ssh would hold the window there until the client is killed.
  const dir = await mkdtemp(join(tmpdir(), 'hulala-ssh-'))
  const fake = join(dir, 'ssh')
  await writeFile(fake, '#!/bin/sh\nsleep 30\n', { mode: 0o755 })
  const started = Date.now()
  const result = await liveSshRunner(fake)('example.invalid', 'host status', { timeoutMs: 120 })
  expect(result.code).toBeNull()
  expect(result.stderr).toContain('no answer')
  expect(Date.now() - started).toBeLessThan(3_000)
  await rm(dir, { recursive: true, force: true })
})
