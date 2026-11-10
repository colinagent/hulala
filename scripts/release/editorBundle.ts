/**
 * Bundle the editor into the TUI package.
 *
 * The terminal editor is part of Hulala: one Neovim build per release platform
 * plus the vendored plugins (`snacks.nvim`, `reader.nvim`, `render-markdown.nvim`).
 * The binary ships as `bin/nvim`,
 * like every other executable, while its runtime tree, parsers and the plugin
 * stay under `runtime/editor/`. The client publishes both into the state root
 * (`apps/cli/src/tui/editor/editorHome.ts`), so a user never needs Neovim or a
 * Neovim config installed and never runs one out of the install directory.
 *
 * Neovim publishes no checksum file with its release assets. The download is
 * hashed into `runtime/editor/nvim/SHA256` so an archive can be traced back to
 * the exact bytes it shipped, and `HULALA_NEOVIM_SHA256` may pin an expected
 * digest per target when a release is promoted.
 *
 * @module hulala/release/editor-bundle
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, cp, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Pinned Neovim release; bump deliberately, it ships to every user. */
export const NEOVIM_VERSION = process.env.HULALA_NEOVIM_VERSION ?? 'v0.11.4'

interface NeovimAsset {
  readonly asset: string
  /** Top-level directory inside the release tarball. */
  readonly directory: string
}

const ASSETS: Record<string, NeovimAsset> = {
  'darwin-arm64': { asset: 'nvim-macos-arm64.tar.gz', directory: 'nvim-macos-arm64' },
  'darwin-x64': { asset: 'nvim-macos-x86_64.tar.gz', directory: 'nvim-macos-x86_64' },
  'linux-x64': { asset: 'nvim-linux-x86_64.tar.gz', directory: 'nvim-linux-x86_64' },
  'linux-arm64': { asset: 'nvim-linux-arm64.tar.gz', directory: 'nvim-linux-arm64' },
}

async function run(command: string[], cwd: string, env: Record<string, string | undefined> = {}): Promise<void> {
  const child = Bun.spawn(command, { cwd, stdout: 'inherit', stderr: 'inherit', env: { ...process.env, ...env } })
  if (await child.exited !== 0) throw new Error(`command failed: ${command.join(' ')}`)
}

async function sha256(path: string): Promise<string> {
  const hasher = createHash('sha256')
  hasher.update(new Uint8Array(await Bun.file(path).arrayBuffer()))
  return hasher.digest('hex')
}

/**
 * Download once per version into `dist/cache/neovim`, then reuse.
 *
 * Uses `curl` rather than `fetch`: release builds run behind whatever proxy the
 * host configures, and curl honours the standard proxy variable set on every
 * macOS and Linux runner (Bun's fetch does not).
 */
async function download(asset: string, cacheDirectory: string): Promise<string> {
  const directory = join(cacheDirectory, NEOVIM_VERSION)
  const destination = join(directory, asset)
  if (await Bun.file(destination).exists()) return destination
  await mkdir(directory, { recursive: true })
  const url = `https://github.com/neovim/neovim/releases/download/${NEOVIM_VERSION}/${asset}`
  const partial = `${destination}.partial`
  await rm(partial, { force: true })
  const curl = Bun.spawn(
    ['curl', '--fail', '--location', '--retry', '3', '--silent', '--show-error', '--output', partial, url],
    { stdout: 'inherit', stderr: 'inherit' },
  )
  if (await curl.exited !== 0) throw new Error(`failed to download ${url}`)
  await rename(partial, destination)
  return destination
}

export interface BundleEditorOptions {
  readonly staging: string
  readonly target: string
  readonly repositoryRoot: string
}

/**
 * Copy the editor into the staged package.
 * @param options - staging directory, target triple and repository root.
 */
export async function bundleEditor(options: BundleEditorOptions): Promise<void> {
  const spec = ASSETS[options.target]
  if (spec === undefined) throw new Error(`no bundled editor for target ${options.target}`)
  const editorRoot = join(options.staging, 'runtime', 'editor')

  // Every vendored plugin ships inside the archive: the file tree and pickers
  // (`snacks.nvim`), the EPUB reader (`reader.nvim`) and the in-buffer Markdown
  // renderer (`render-markdown.nvim`). The client publishes this directory into
  // the state root, so a user never downloads a plugin.
  for (const plugin of ['snacks.nvim', 'reader.nvim', 'render-markdown.nvim']) {
    await cp(
      join(options.repositoryRoot, 'apps', 'cli', 'vendor', plugin),
      join(editorRoot, 'nvim-plugins', plugin),
      { recursive: true },
    )
  }

  const archive = await download(spec.asset, join(options.repositoryRoot, 'dist', 'cache', 'neovim'))
  const expected = process.env.HULALA_NEOVIM_SHA256
  const digest = await sha256(archive)
  if (expected !== undefined && expected !== '' && expected !== digest) {
    throw new Error(`Neovim digest mismatch for ${options.target}: ${digest} != ${expected}`)
  }

  const extractRoot = await mkdtemp(join(tmpdir(), 'hulala-neovim-'))
  try {
    await run(['tar', '-xzf', archive, '-C', extractRoot], extractRoot)
    const extracted = join(extractRoot, spec.directory)
    // The binary is a package `bin/` file, the same place the client publishes
    // it under `<data>/bin/nvim`. Its runtime tree and parsers sit beside the
    // other editor data because a binary outside Neovim's own tree cannot find
    // them on its own (`$VIMRUNTIME` and `runtimepath` are set by the client).
    const binary = join(options.staging, 'bin', 'nvim')
    await mkdir(dirname(binary), { recursive: true })
    await cp(join(extracted, 'bin', 'nvim'), binary)
    await chmod(binary, 0o755)
    const nvimData = join(editorRoot, 'nvim')
    await mkdir(nvimData, { recursive: true })
    for (const part of ['share/nvim/runtime', 'lib/nvim']) {
      const source = join(extracted, part)
      if (!existsSync(source)) continue
      await cp(source, join(nvimData, part), { recursive: true })
    }
    await writeFile(
      join(nvimData, 'SHA256'),
      `${digest}  ${spec.asset}\nupstream: https://github.com/neovim/neovim/releases/tag/${NEOVIM_VERSION}\n`,
      { mode: 0o600 },
    )
    // Fail the build instead of the user: this layout is only correct if the
    // moved binary still starts with the published runtime and parsers.
    await run([binary, '--headless', '-u', 'NONE', '--noplugin', '-c', 'qa!'], options.staging, {
      VIMRUNTIME: join(nvimData, 'share', 'nvim', 'runtime'),
      HULALA_NVIM_PARSERS: join(nvimData, 'lib', 'nvim'),
    })
  } finally {
    await rm(extractRoot, { recursive: true, force: true })
  }
}
