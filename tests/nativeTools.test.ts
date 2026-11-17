/**
 * The two native files a release cannot inline.
 *
 * `bin/ime` is compiled here; the clipboard helper is a prebuild borrowed from
 * the installed TUI package. The second one is easy to lose silently: the bundle
 * still starts, text copy still works through `pbcopy`, and only an image paste
 * says "no reader". These tests pin the layout the library actually probes, so a
 * packaging change fails here instead of in a user's `Ctrl-V`.
 *
 * The helper is only read from `node_modules/@earendil-works/pi-tui`, so a fake
 * repository root keeps the test off the real dependency tree.
 */
import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundleClipboardHelper } from '../scripts/release/nativeTools'

interface Staged {
  /** Temporary checkout root; removed by the caller. */
  readonly root: string
  readonly repositoryRoot: string
  readonly staging: string
  readonly helper: string
}

/** Stage one helper under a repository root shaped like a checkout. */
async function stage(options: { target: string; file: string; body?: string; install?: boolean }): Promise<Staged> {
  const root = await mkdtemp(join(tmpdir(), 'hulala-native-'))
  const platform = options.target.startsWith('darwin-') ? 'darwin' : 'linux'
  const repositoryRoot = join(root, 'repository')
  const staging = join(root, 'package')
  const helper = join(repositoryRoot, 'node_modules', '@earendil-works', 'pi-tui', 'native', platform, 'prebuilds', options.target, options.file)
  await mkdir(join(helper, '..'), { recursive: true })
  await mkdir(staging, { recursive: true })
  if (options.install ?? true) await writeFile(helper, options.body ?? 'napi')
  return { root, repositoryRoot, staging, helper }
}

test('macOS ships the clipboard helper where the bundle looks for it', async () => {
  const staged = await stage({ target: 'darwin-arm64', file: 'darwin-platform.node' })
  try {
    await bundleClipboardHelper({ staging: staged.staging, target: 'darwin-arm64', repositoryRoot: staged.repositoryRoot })
    // First candidate of the library's own search: `<bundle>/../native/...`.
    const shipped = join(staged.staging, 'native', 'darwin', 'prebuilds', 'darwin-arm64', 'darwin-platform.node')
    expect(existsSync(shipped)).toBe(true)
    expect(await readFile(shipped, 'utf8')).toBe('napi')
  } finally { await rm(staged.root, { recursive: true, force: true }) }
})

test('Linux ships its X11 reader under the same tree', async () => {
  const staged = await stage({ target: 'linux-x64', file: 'linux-platform-x11.node' })
  try {
    await bundleClipboardHelper({ staging: staged.staging, target: 'linux-x64', repositoryRoot: staged.repositoryRoot })
    expect(existsSync(join(staged.staging, 'native', 'linux', 'prebuilds', 'linux-x64', 'linux-platform-x11.node'))).toBe(true)
  } finally { await rm(staged.root, { recursive: true, force: true }) }
})

test('a missing prebuild fails the package instead of shipping a silent gap', async () => {
  const staged = await stage({ target: 'darwin-arm64', file: 'darwin-platform.node', install: false })
  try {
    await expect(bundleClipboardHelper({ staging: staged.staging, target: 'darwin-arm64', repositoryRoot: staged.repositoryRoot }))
      .rejects.toThrow('clipboard helper is missing')
  } finally { await rm(staged.root, { recursive: true, force: true }) }
})
