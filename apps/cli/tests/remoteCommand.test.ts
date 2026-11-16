/**
 * `hulala remote <machine>` and `hulala ssh <machine>`.
 *
 * One command, one machine: the same probe `/remote` runs, the same installer,
 * and then the same client entry an in-window switch restarts into. Everything
 * here is injected, so no test needs an sshd, a release server or a terminal.
 */
import { expect, test } from 'bun:test'
import { connectRemote, type RemoteConnectDeps, type RemoteProbe } from '../src/remote/command.ts'
import type { RemoteHostState } from '../src/remote/ssh.js'
import { VERSION } from '../src/constants.js'
import { HOST_DAEMON_PROTOCOL } from '@hulala/host-client/node'

const running: RemoteHostState = {
  state: 'running',
  version: VERSION,
  protocol: HOST_DAEMON_PROTOCOL,
  httpUrl: 'http://127.0.0.1:4100',
}

/** One invocation, with every outside face recorded. */
function harness(probe: RemoteProbe, options: { installOk?: boolean; stopOk?: boolean } = {}): {
  deps: RemoteConnectDeps
  fail: string[]
  installed: string[]
  stopped: string[]
  client: string[]
} {
  const fail: string[] = []
  const installed: string[] = []
  const stopped: string[] = []
  const client: string[] = []
  return {
    fail,
    installed,
    stopped,
    client,
    deps: {
      runner: async () => ({ code: 0, stdout: '', stderr: '' }),
      probe: async () => probe,
      install: async alias => {
        installed.push(alias)
        return { ok: options.installOk ?? true, output: 'installed\n' }
      },
      stop: async alias => {
        stopped.push(alias)
        return options.stopOk ?? true
      },
      out: () => undefined,
      fail: line => { fail.push(line) },
      runClient: async alias => {
        client.push(alias)
        return 0
      },
    },
  }
}

test('a machine that answers opens the client on it, and changes nothing there', async () => {
  const test = harness({ probe: running, verdict: 'attach' })
  expect(await connectRemote('dev', test.deps)).toBe(0)
  expect(test.client).toEqual(['dev'])
  expect(test.installed).toEqual([])
  expect(test.stopped).toEqual([])
  expect(test.fail).toEqual([])
})

test('a machine without Hulala is installed, stopped, and then attached', async () => {
  // `dev` named on the command line is the confirmation, so nothing asks again.
  const test = harness({ probe: { state: 'uninstalled' }, verdict: 'install' })
  expect(await connectRemote('dev', test.deps)).toBe(0)
  expect(test.installed).toEqual(['dev'])
  // Installing replaces files, not the process: the old daemon must go or the
  // attach would meet the release that is already running.
  expect(test.stopped).toEqual(['dev'])
  expect(test.client).toEqual(['dev'])
})

test('an older Host is upgraded the same way instead of being refused', async () => {
  const test = harness({
    probe: { state: 'running', version: '0.0.1', protocol: HOST_DAEMON_PROTOCOL, httpUrl: 'http://127.0.0.1:4100' },
    verdict: 'update',
  })
  expect(await connectRemote('dev', test.deps)).toBe(0)
  expect(test.installed).toEqual(['dev'])
  expect(test.stopped).toEqual(['dev'])
  expect(test.client).toEqual(['dev'])
})

test('a failed install never attaches and shows the installer’s reason', async () => {
  const test = harness({ probe: { state: 'uninstalled' }, verdict: 'install' }, { installOk: false })
  expect(await connectRemote('dev', test.deps)).toBe(1)
  expect(test.client).toEqual([])
  expect(test.fail[0]).toContain('install failed')
})

test('an old Host that will not stop is not attached over', async () => {
  const test = harness({ probe: { state: 'stopped', version: '0.0.1', protocol: HOST_DAEMON_PROTOCOL }, verdict: 'update' }, { stopOk: false })
  expect(await connectRemote('dev', test.deps)).toBe(1)
  expect(test.installed).toEqual(['dev'])
  expect(test.client).toEqual([])
  expect(test.fail[0]).toContain('did not stop')
})

test('an unreachable machine reports why, and nothing is installed or started', async () => {
  const test = harness({ probe: { state: 'unreachable', reason: 'ssh exited 255' }, verdict: 'unreachable' })
  expect(await connectRemote('dev', test.deps)).toBe(1)
  expect(test.fail[0]).toContain('ssh exited 255')
  expect(test.installed).toEqual([])
  expect(test.client).toEqual([])
})

test('a newer Host sends the user to update this installation, not the far side', async () => {
  const test = harness({
    probe: { state: 'running', version: '99.0.0', protocol: HOST_DAEMON_PROTOCOL + 1, httpUrl: 'http://127.0.0.1:4100' },
    verdict: 'client-update',
  })
  expect(await connectRemote('dev', test.deps)).toBe(1)
  expect(test.fail[0]).toContain('update this installation first')
  expect(test.installed).toEqual([])
  expect(test.client).toEqual([])
})

test('a Host that will not stay up is reported instead of attached', async () => {
  const test = harness({ probe: { state: 'stopped', version: VERSION, protocol: HOST_DAEMON_PROTOCOL }, verdict: 'start' })
  expect(await connectRemote('dev', test.deps)).toBe(1)
  expect(test.fail[0]).toContain('did not stay up')
  expect(test.client).toEqual([])
})
