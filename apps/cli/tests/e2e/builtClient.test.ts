import { afterAll, beforeAll, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

built('the bundle starts beside no dependency tree at all', () => {
  // The release archive carries code only: `hulala install` runs `npm ci` after
  // it has started. A library resolved at module load therefore killed every
  // command in a freshly unpacked archive (0.3.16 shipped exactly that), and no
  // test that ran the bundle from the checkout could see it. This is the
  // archive's shape: `bin/hulala` beside a package root that has no
  // `node_modules`.
  const root = mkdtempSync(join(tmpdir(), 'hulala-bare-bundle-'))
  try {
    const entry = join(root, 'bin', 'hulala.mjs')
    mkdirSync(join(root, 'bin'), { recursive: true })
    copyFileSync(BUNDLE, entry)
    const version = (JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'apps', 'cli', 'package.json'), 'utf8')) as { version: string }).version
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'hulala', version, type: 'module' }))
    const run = spawnSync(node ?? 'node', [entry, '--version'], { encoding: 'utf8', timeout: 30_000 })
    expect(run.stderr).not.toContain('ws not found')
    expect(run.status).toBe(0)
    // The bundle may predate a version bump in the manifest; the point is that
    // it answers at all with nothing beside it.
    expect(run.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 45_000)

builtEditor('the built bundle runs a real Neovim and returns to the composer', async () => {
  const client = await startReadyClient({ home, entry: BUNDLE, ...(node === null ? {} : { runtime: node }), cols: 120, rows: 36 })
  try {
    client.write('\u0007')
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
