/**
 * The editor's own home under the Hulala state root.
 *
 * The editor is bundled with Hulala rather than taken from `PATH`: one Neovim
 * build per release platform, one config, one theme, no dependence on the user
 * having installed anything. Everything it writes stays under `~/.hulala`, and
 * every binary is a real file, never a symlink:
 *
 * - `<data>/bin/nvim` — the bundled Neovim binary, next to the other
 *   executables Hulala owns;
 * - `<data>/bin/rg` — the ripgrep binary the editor's pickers call, taken from
 *   the `@vscode/ripgrep` package the Harness already installs, so `rg` never
 *   depends on the user's package manager;
 * - `<data>/bin/ime` — the macOS input-source helper the TUI calls when the
 *   editor column takes focus (source: `apps/cli/native/ime.c`);
 * - `<data>/runtime/editor/nvim/share/nvim/runtime` — its runtime tree, handed
 *   to the process as `$VIMRUNTIME` (off-tree binaries cannot find it alone);
 * - `<data>/runtime/editor/nvim/lib/nvim` — the bundled tree-sitter parsers,
 *   prepended to `runtimepath`;
 * - `<data>/runtime/editor/nvim-plugins/snacks.nvim/` — the bundled file tree
 *   and picker plugin (MIT, see its `VENDOR.md`);
 * - `<data>/config/editor/plugins/` — every plugin directory here is prepended
 *   to `runtimepath`, so a user plugin (a reader, a motion pack) is a folder
 *   drop away. Hulala never writes into it;
 * - `<data>/config/editor/nvim/init.lua` — Hulala's config, created on first
 *   use so it stays editable, and read as `$XDG_CONFIG_HOME/nvim/init.lua`;
 * - `<data>/cache/editor/` — `XDG_DATA_HOME` / `XDG_STATE_HOME`: undo, shada,
 *   swap and plugin state never touch the user's own Neovim directories.
 *
 * {@link publishEditor} copies those files out of a release package the first
 * time the editor opens after an upgrade, so the editor keeps working when a
 * version is rolled back or pruned. A missing package falls back to `nvim` on
 * `PATH` and the repo's vendored plugin, which is what makes `bun run dev`
 * work without a packaged release.
 *
 * @module hulala-cli/tui/editor/editorHome
 */
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NVIM_INIT_LUA } from './nvimConfig.js'
import { appendPathEntry, bundledRipgrep, ripgrepExecutable } from '../../ripgrep.js'
import type { EditorTheme } from './editorTheme.js'

/** Marker recording which package's editor files were published. */
const PUBLISHED_MARKER = '.editor-package.json'

/** Resolved locations and command for the bundled editor. */
export interface EditorHome {
  /** Neovim executable: `<data>/bin/nvim`, else `nvim` from `PATH`. */
  readonly command: string
  /** macOS input-source helper, or undefined when the package did not ship it. */
  readonly ime: string | undefined
  /** Directory of Hulala's own executables; `<data>/bin`. */
  readonly binHome: string
  /** `$VIMRUNTIME` for the published binary. */
  readonly runtime: string
  /** Bundled tree-sitter parsers, prepended to `runtimepath`. */
  readonly parsers: string
  /** Bundled snacks.nvim directory, or `''` when it is missing. */
  readonly plugin: string
  /** Directory of plugins the user drops in; never written by Hulala. */
  readonly pluginDir: string
  /** Directory of plugins shipped with the package, published beside the editor. */
  readonly pluginRoot: string
  /** `$XDG_CONFIG_HOME`; contains `nvim/init.lua`. */
  readonly configHome: string
  /** `$XDG_DATA_HOME`; undo, shada and plugin state. */
  readonly dataHome: string
  /** `$XDG_STATE_HOME`. */
  readonly stateHome: string
  /** Absolute path of the config file, written on first use. */
  readonly initPath: string
  /** `<data>`: the state root the editor is published under. */
  readonly dataRoot: string
}

/** Walk up from a module location looking for the repo's vendored plugin. */
function findVendoredPlugin(start: string): string | undefined {
  let directory = start
  for (let step = 0; step < 6; step += 1) {
    const candidate = join(directory, 'vendor', 'snacks.nvim')
    if (existsSync(candidate)) return candidate
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return undefined
}

/**
 * Root of a packaged client: the directory holding `bin/` and `runtime/`.
 *
 * `HULALA_PACKAGE_ROOT` wins because the launcher exports it; otherwise walk up
 * from this module, which is `<package>/bin/hulala` in a packaged bundle and
 * never contains a sibling `bin/nvim` in a source checkout.
 * @returns the package root, or undefined outside a packaged release.
 */
export function editorPackageRoot(): string | undefined {
  const configured = process.env.HULALA_PACKAGE_ROOT?.trim()
  if (configured !== undefined && configured !== '') return configured
  const here = moduleDirectory()
  for (const candidate of [join(here, '..'), join(here, '..', '..'), join(here, '..', '..', '..')]) {
    if (existsSync(join(candidate, 'bin', 'nvim'))) return candidate
  }
  return undefined
}

/**
 * Resolve the editor home for a Hulala state root.
 * @param dataRoot - `~/.hulala` (or `$HULALA_HOME`).
 * @returns the resolved paths and executable.
 */
export function resolveEditorHome(dataRoot: string): EditorHome {
  const editorData = join(dataRoot, 'runtime', 'editor')
  const plugin = [join(editorData, 'nvim-plugins', 'snacks.nvim'), findVendoredPlugin(moduleDirectory())]
    .find(candidate => candidate !== undefined && existsSync(candidate)) ?? ''
  const configHome = join(dataRoot, 'config', 'editor')
  const binHome = join(dataRoot, 'bin')
  const binary = join(binHome, 'nvim')
  const ime = join(binHome, 'ime')
  return {
    command: existsSync(binary) ? binary : 'nvim',
    ime: existsSync(ime) ? ime : undefined,
    binHome,
    runtime: join(editorData, 'nvim', 'share', 'nvim', 'runtime'),
    parsers: join(editorData, 'nvim', 'lib', 'nvim'),
    plugin,
    pluginDir: join(configHome, 'plugins'),
    pluginRoot: join(editorData, 'nvim-plugins'),
    configHome,
    dataHome: join(dataRoot, 'cache', 'editor'),
    stateHome: join(dataRoot, 'cache', 'editor', 'state'),
    initPath: join(configHome, 'nvim', 'init.lua'),
    dataRoot,
  }
}

/** SHA-256 of a file, used to notice a package upgrade. */
function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Digest of a plugin tree: every file path and its content, sorted.
 *
 * The binaries alone are not enough — a release that only adds or bumps a
 * plugin leaves them unchanged, and `publishEditor` would then skip the copy and
 * leave the old plugins on disk forever.
 * @param directory - the package's `nvim-plugins` directory.
 * @returns a hex digest; a missing directory hashes to the empty string marker.
 */
function pluginsDigest(directory: string): string {
  if (!existsSync(directory)) return 'none'
  const hasher = createHash('sha256')
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name)
      const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(path, name)
      else if (entry.isFile()) hasher.update(`${name}\0`).update(readFileSync(path))
    }
  }
  walk(directory, '')
  return hasher.digest('hex')
}

/** Which package digest was published last, or undefined on first use. */
function publishedDigest(home: EditorHome): string | undefined {
  try {
    const value = JSON.parse(readFileSync(join(home.binHome, PUBLISHED_MARKER), 'utf8')) as { sha256?: unknown }
    return typeof value.sha256 === 'string' ? value.sha256 : undefined
  } catch {
    return undefined
  }
}

/** Copy one packaged executable into `bin/`, keeping it a real file. */
function installBinary(source: string, destination: string): void {
  const temporary = `${destination}.${process.pid}.tmp`
  copyFileSync(source, temporary)
  chmodSync(temporary, 0o755)
  renameSync(temporary, destination)
}

/**
 * Copy the packaged editor into the state root.
 *
 * The binary goes to `<data>/bin/nvim` as a real file; Neovim's runtime tree,
 * parsers and plugin are copied beside it so the editor never reads out of an
 * install directory that rollback or pruning can delete. The ripgrep binary the
 * pickers call is published the same way (see {@link bundledRipgrep}), because
 * `rg` must not depend on the user having installed ripgrep. Runs once per
 * package: upgrades republish, an unchanged package does nothing.
 *
 * @param home - resolved editor home.
 * @param packageRoot - package to copy from; defaults to {@link editorPackageRoot}.
 */
export function publishEditor(home: EditorHome, packageRoot: string | undefined = editorPackageRoot()): void {
  if (packageRoot === undefined) return
  const nvim = join(packageRoot, 'bin', 'nvim')
  if (!existsSync(nvim)) return
  // Helpers the package ships beside the editor binary (`ime` on macOS) plus the
  // ripgrep binary the pickers and the Host shell resolve through `PATH`.
  const ripgrep = bundledRipgrep({ packageRoot })
  const binaries = [
    { name: 'nvim', source: nvim },
    ...['ime'].map(name => ({ name, source: join(packageRoot, 'bin', name) })).filter(entry => existsSync(entry.source)),
    ...(ripgrep === undefined ? [] : [{ name: ripgrepExecutable(), source: ripgrep }]),
  ]
  const wanted = createHash('sha256')
    .update(binaries.map(entry => digest(entry.source)).join(':'))
    .update(pluginsDigest(join(packageRoot, 'runtime', 'editor', 'nvim-plugins')))
    .digest('hex')
  const published = publishedDigest(home) === wanted
    && existsSync(home.runtime)
    && binaries.every(entry => existsSync(join(home.binHome, entry.name)))
  if (published) return

  mkdirSync(home.binHome, { recursive: true })
  for (const entry of binaries) installBinary(entry.source, join(home.binHome, entry.name))

  const editorData = join(home.dataRoot, 'runtime', 'editor')
  for (const part of [['share', 'nvim', 'runtime'], ['lib', 'nvim']]) {
    const source = join(packageRoot, 'runtime', 'editor', 'nvim', ...part)
    if (!existsSync(source)) continue
    const destination = join(editorData, 'nvim', ...part)
    // Replace, never merge: an older Neovim's files must not survive a downgrade.
    rmSync(destination, { recursive: true, force: true })
    cpSync(source, destination, { recursive: true })
  }
  const vendored = join(packageRoot, 'runtime', 'editor', 'nvim-plugins')
  if (existsSync(vendored)) {
    rmSync(join(editorData, 'nvim-plugins'), { recursive: true, force: true })
    cpSync(vendored, join(editorData, 'nvim-plugins'), { recursive: true })
  }
  writeFileSync(join(home.binHome, PUBLISHED_MARKER), `${JSON.stringify({ sha256: wanted, source: packageRoot })}\n`, { mode: 0o600 })
}

function moduleDirectory(): string {
  try {
    return dirname(fileURLToPath(import.meta.url))
  } catch {
    return process.cwd()
  }
}

/**
 * Create the config file when it does not exist yet, so upgrades never
 * overwrite edits the user made to it.
 * @param home - resolved editor home.
 */
export function ensureEditorConfig(home: EditorHome): void {
  if (existsSync(home.initPath)) return
  mkdirSync(dirname(home.initPath), { recursive: true })
  writeFileSync(home.initPath, NVIM_INIT_LUA, { mode: 0o600 })
}

/**
 * Environment for one editor process: isolated XDG homes plus the theme,
 * runtime tree, parsers and plugin location the generated config reads.
 * @param home - resolved editor home.
 * @param theme - colours derived from the terminal.
 * @param ripgrepPath - directory holding the ripgrep binary, from {@link ripgrepPathEntry}.
 * @returns environment variables to add to the child process.
 */
export function editorEnvironment(home: EditorHome, theme: EditorTheme, ripgrepPath?: string): Record<string, string> {
  mkdirSync(home.dataHome, { recursive: true })
  mkdirSync(home.stateHome, { recursive: true })
  mkdirSync(home.pluginDir, { recursive: true })
  const environment: Record<string, string> = {
    XDG_CONFIG_HOME: home.configHome,
    XDG_DATA_HOME: home.dataHome,
    XDG_STATE_HOME: home.stateHome,
    HULALA_NVIM_THEME: JSON.stringify(theme),
    HULALA_NVIM_SNACKS: home.plugin,
    HULALA_NVIM_PLUGIN_DIR: home.pluginDir,
    HULALA_NVIM_BUNDLED_PLUGINS: home.pluginRoot,
  }
  // The pickers run plain `rg`, so the shipped binary must be reachable through
  // `PATH`; appended, never prepended, so the user's own tools still win.
  const path = appendPathEntry(process.env.PATH, ripgrepPath, process.platform)
  if (ripgrepPath !== undefined && path !== undefined) environment.PATH = path
  // A binary outside Neovim's own tree cannot find its runtime by itself.
  if (existsSync(home.runtime)) environment.VIMRUNTIME = home.runtime
  if (existsSync(home.parsers)) environment.HULALA_NVIM_PARSERS = home.parsers
  return environment
}
