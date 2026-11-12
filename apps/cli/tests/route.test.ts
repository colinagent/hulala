import assert from 'node:assert/strict'
import test from 'node:test'

import { routeCommand } from '../src/route.ts'

test('bare hulala opens the terminal client', () => {
  assert.deepEqual(routeCommand([]), { kind: 'tui', args: [] })
  assert.deepEqual(routeCommand(['--resume', 'session-1']), { kind: 'tui', args: ['--resume', 'session-1'] })
  assert.deepEqual(routeCommand(['tui', '--resume', 'session-1']), { kind: 'tui', args: ['--resume', 'session-1'] })
})

test('host commands manage the shared daemon', () => {
  assert.deepEqual(routeCommand(['host']), { kind: 'host', args: [] })
  assert.deepEqual(routeCommand(['host', 'stop']), { kind: 'host', args: ['stop'] })
})

test('lifecycle commands are unchanged', () => {
  assert.deepEqual(routeCommand(['install']), { kind: 'distribution', command: 'install', args: [] })
  assert.deepEqual(routeCommand(['update', '--check']), {
    kind: 'distribution',
    command: 'update',
    args: ['--check'],
  })
})

test('install bot stays a lifecycle command with its own argument', () => {
  assert.deepEqual(routeCommand(['install', 'bot']), { kind: 'distribution', command: 'install', args: ['bot'] })
})

test('version and help win over other words', () => {
  assert.deepEqual(routeCommand(['--version']), { kind: 'version' })
  assert.deepEqual(routeCommand(['-V']), { kind: 'version' })
  assert.deepEqual(routeCommand(['host', '--version']), { kind: 'version' })
  assert.deepEqual(routeCommand(['--help']), { kind: 'help' })
  assert.deepEqual(routeCommand(['host', '-h']), { kind: 'help' })
})

test('lifecycle commands keep their own --version option', () => {
  assert.deepEqual(routeCommand(['update', '--version', '0.2.0']), {
    kind: 'distribution',
    command: 'update',
    args: ['--version', '0.2.0'],
  })
})
