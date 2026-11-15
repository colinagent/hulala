import { afterAll, beforeAll, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  disposeHome,
  E2E_AVAILABLE,
  makeHome,
  REPOSITORY_ROOT,
  startReadyClient,
} from './clientPty.ts'

/**
 * The artifact users run, not the source entry.
 *
 * A source run resolves every dependency from the checkout. The release runs one
 * bundled file from `bin/hulala`, whose only runtime library tree is
 * `runtime/node_modules`. That difference already broke the client once: a
 * bundled `ws` kept the mux up until a second stream (a terminal column) needed
 * it, then dropped the connection. No source-level test could see it.
 *
 * The case is skipped until the bundle exists; the release build must run
 * `bun run --cwd apps/cli build:client` and then this file.
 */

const BUNDLE = join(REPOSITORY_ROOT, 'apps', 'cli', 'dist', 'hulala.mjs')
const node = Bun.which('node')
const nvim = Bun.which('nvim')
const available = E2E_AVAILABLE && existsSync(BUNDLE)
const built = available ? test : test.skip
const builtEditor = available && nvim !== null ? test : test.skip
if (!available) {
  console.warn('e2e: apps/cli/dist/hulala.mjs is missing; run `bun run --cwd apps/cli build:client` to enable the built-artifact suite')
}

let home = ''
beforeAll(() => { home = makeHome('built-e2e') })
afterAll(async () => { if (home !== '') await disposeHome(home) })

built('the built bundle keeps the Host connection when a terminal column opens', async () => {
  const client = await startReadyClient({ home, entry: BUNDLE, ...(node === null ? {} : { runtime: node }), cols: 120, rows: 36 })
  try {
    client.write('\u0014')
    await new Promise(resolve => setTimeout(resolve, 1_200))
    client.write("printf 'built 中文 ok\\n'\r")
    await client.waitFor(screen => screen.includes('built 中文 ok'), 'CJK output from the built client', 15_000)
    // The warning is what a bundled `ws` produced: the mux died exactly when a
    // second stream attached, and the terminal column never received a byte.
    expect(client.output()).not.toContain('[connection] connection lost')
    expect(await client.quit()).toBe(0)
  } finally {
    await client.dispose()
  }
}, 45_000)

builtEditor('the built bundle runs a real Neovim and returns to the composer', async () => {
  const client = await startReadyClient({ home, entry: BUNDLE, ...(node === null ? {} : { runtime: node }), cols: 120, rows: 36 })
  try {
    client.write('\u0004')
    await client.waitFor(screen => screen.includes('[Scratch]') || screen.includes('NVIM'), 'the editor column', 25_000)
    client.write('i你好')
    await client.waitFor(screen => screen.includes('你好'), 'wide characters in the built editor', 10_000)
    client.write('\u001b')
    await new Promise(resolve => setTimeout(resolve, 300))
    client.write(':q!\r')
    await client.waitFor(screen => screen.includes('❯'), 'the composer after the editor', 15_000)
    expect(await client.quit()).toBe(0)
  } finally {
    await client.dispose()
  }
}, 60_000)
