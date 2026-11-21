import { describe, expect, test } from 'bun:test'
import {
  machineLabel,
  parseSshConfigUser,
  remoteIdentity,
} from '../src/machine.js'

describe('the machine label', () => {
  test('writes user@host when both halves are known', () => {
    expect(machineLabel({ user: 'root', host: 'dev' })).toBe('root@dev')
    expect(machineLabel({ user: 'colin', host: 'pi' })).toBe('colin@pi')
  })

  test('falls back to the host, and to no machine at all', () => {
    // A Host that named itself but not its account still labels the window.
    expect(machineLabel({ user: undefined, host: 'dev' })).toBe('dev')
    // A local window names no machine: its directory alone says where it works.
    expect(machineLabel(undefined)).toBeUndefined()
  })
})

describe('a remote machine', () => {
  test('keeps the alias the user picked, not the address ssh resolves', () => {
    // The account comes from the ssh configuration; the machine stays the alias.
    expect(remoteIdentity('dev').host).toBe('dev')
  })
})

describe('the account of an ssh destination', () => {
  test('is the `user` line of the resolved configuration', () => {
    // Verbatim shape of `ssh -G dev`: one `key value` pair per line, with the
    // client's own defaults filled in below the configuration's own answer.
    expect(parseSshConfigUser('hostname 100.64.0.30\nuser root\nport 22\nuser colin\n')).toBe('colin')
    expect(parseSshConfigUser('hostname dev\nport 22\n')).toBeUndefined()
    expect(parseSshConfigUser('user\n')).toBeUndefined()
    expect(parseSshConfigUser('')).toBeUndefined()
  })
})
