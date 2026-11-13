import { expect, test } from 'bun:test'
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FALLBACK_THEME,
  NVIM_BASE_LUA,
  NVIM_BASE_MARKER,
  editorEnvironment,
  ensureEditorConfig,
  publishEditor,
  resolveEditorHome,
  ripgrepExecutable,
} from '@hulala/editor-home'




function stateRoot(): string {
  return mkdtempSync(join(tmpdir(), 'hulala-editor-home-'))
}

/** A package root shaped like the release: bin/nvim plus the editor's data. */
function packageRoot(root: string, binary = 'neovim-binary'): string {
  const pkg = join(root, 'package')
  mkdirSync(join(pkg, 'bin'), { recursive: true })
  writeFileSync(join(pkg, 'bin', 'nvim'), binary)
  writeFileSync(join(pkg, 'bin', 'ime'), 'input-source-helper')
  mkdirSync(join(pkg, 'runtime', 'editor', 'nvim', 'share', 'nvim', 'runtime'), { recursive: true })
  writeFileSync(join(pkg, 'runtime', 'editor', 'nvim', 'share', 'nvim', 'runtime', 'syntax.vim'), '')
  mkdirSync(join(pkg, 'runtime', 'editor', 'nvim', 'lib', 'nvim', 'parser'), { recursive: true })
  writeFileSync(join(pkg, 'runtime', 'editor', 'nvim', 'lib', 'nvim', 'parser', 'c.so'), '')
  mkdirSync(join(pkg, 'runtime', 'editor', 'nvim-plugins', 'snacks.nvim'), { recursive: true })
  writeFileSync(join(pkg, 'runtime', 'editor', 'nvim-plugins', 'snacks.nvim', 'README.md'), '')
  return pkg
}

/** The ripgrep package a release installs beside the Host. */
function packageRipgrep(pkg: string, binary = 'ripgrep-binary'): string {
  const directory = join(pkg, 'runtime', 'node_modules', '@vscode', `ripgrep-${process.platform}-${process.arch}`, 'bin')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, ripgrepExecutable()), binary, { mode: 0o755 })
  return join(directory, ripgrepExecutable())
}

test('the editor home lives under the Hulala state root', () => {
  const root = stateRoot()
  const home = resolveEditorHome(root)
  expect(home.dataRoot).toBe(root)
  expect(home.binHome).toBe(join(root, 'bin'))
  expect(home.runtime).toBe(join(root, 'runtime', 'editor', 'nvim', 'share', 'nvim', 'runtime'))
  expect(home.parsers).toBe(join(root, 'runtime', 'editor', 'nvim', 'lib', 'nvim'))
  expect(home.configHome).toBe(join(root, 'config', 'editor'))
  expect(home.dataHome).toBe(join(root, 'cache', 'editor'))
  expect(home.stateHome).toBe(join(root, 'cache', 'editor', 'state'))
  expect(home.initPath).toBe(join(root, 'config', 'editor', 'nvim', 'init.lua'))
  expect(home.basePath).toBe(join(root, 'config', 'editor', 'nvim', 'hulala.lua'))
})

test('without a published binary the editor falls back to PATH', () => {
  const root = stateRoot()
  expect(resolveEditorHome(root).command).toBe('nvim')
  publishEditor(resolveEditorHome(root), undefined)
  expect(resolveEditorHome(root).command).toBe('nvim')
})

test('publishing copies the binary and its data into the state root as real files', () => {
  const root = stateRoot()
  const pkg = packageRoot(root)
  const home = resolveEditorHome(root)
  publishEditor(home, pkg)

  const published = resolveEditorHome(root)
  expect(published.command).toBe(join(root, 'bin', 'nvim'))
  expect(readFileSync(published.command, 'utf8')).toBe('neovim-binary')
  expect(statSync(published.command).mode & 0o777).toBe(0o755)
  expect(lstatSync(published.command).isSymbolicLink()).toBe(false)
  expect(readFileSync(join(published.runtime, 'syntax.vim'), 'utf8')).toBe('')
  expect(readFileSync(join(published.parsers, 'parser', 'c.so'), 'utf8')).toBe('')
  expect(published.plugin).toBe(join(root, 'runtime', 'editor', 'nvim-plugins', 'snacks.nvim'))
  // Plugins the user drops in live outside the package, under the config root.
  expect(published.pluginDir).toBe(join(root, 'config', 'editor', 'plugins'))
  expect(published.ime).toBe(join(root, 'bin', 'ime'))
  expect(readFileSync(published.ime!, 'utf8')).toBe('input-source-helper')
  expect(statSync(published.ime!).mode & 0o777).toBe(0o755)
})

test('publishing also copies the shipped ripgrep the pickers run', () => {
  const root = stateRoot()
  const pkg = packageRoot(root)
  packageRipgrep(pkg)
  publishEditor(resolveEditorHome(root), pkg)

  const published = join(root, 'bin', ripgrepExecutable())
  expect(readFileSync(published, 'utf8')).toBe('ripgrep-binary')
  expect(statSync(published).mode & 0o777).toBe(0o755)
  expect(lstatSync(published).isSymbolicLink()).toBe(false)

  // A package that ships a new ripgrep republishes the copy in `bin/`.
  packageRipgrep(pkg, 'newer-ripgrep')
  publishEditor(resolveEditorHome(root), pkg)
  expect(readFileSync(published, 'utf8')).toBe('newer-ripgrep')
})

test('a package that only changes a plugin still republishes it', () => {
  const root = stateRoot()
  const pkg = packageRoot(root, 'same-binary')
  publishEditor(resolveEditorHome(root), pkg)
  const publishedPlugin = join(root, 'runtime', 'editor', 'nvim-plugins', 'snacks.nvim', 'README.md')
  expect(readFileSync(publishedPlugin, 'utf8')).toBe('')

  // Same nvim binary, new plugin content and a second plugin: the plugin tree is
  // part of the published digest, so this must reach the state root.
  writeFileSync(join(pkg, 'runtime', 'editor', 'nvim-plugins', 'snacks.nvim', 'README.md'), 'newer')
  mkdirSync(join(pkg, 'runtime', 'editor', 'nvim-plugins', 'reader.nvim', 'lua'), { recursive: true })
  writeFileSync(join(pkg, 'runtime', 'editor', 'nvim-plugins', 'reader.nvim', 'lua', 'reader.lua'), '')
  publishEditor(resolveEditorHome(root), pkg)

  expect(readFileSync(publishedPlugin, 'utf8')).toBe('newer')
  expect(existsSync(join(root, 'runtime', 'editor', 'nvim-plugins', 'reader.nvim', 'lua', 'reader.lua'))).toBe(true)
})

test('an unchanged package is not republished, an upgraded one is', () => {
  const root = stateRoot()
  const home = resolveEditorHome(root)
  publishEditor(home, packageRoot(root, 'first'))
  expect(readFileSync(join(root, 'bin', 'nvim'), 'utf8')).toBe('first')

  writeFileSync(join(root, 'bin', 'nvim'), 'user replacement')
  publishEditor(resolveEditorHome(root), packageRoot(root, 'first'))
  expect(readFileSync(join(root, 'bin', 'nvim'), 'utf8')).toBe('user replacement')

  publishEditor(resolveEditorHome(root), packageRoot(join(root, 'next'), 'second'))
  expect(readFileSync(join(root, 'bin', 'nvim'), 'utf8')).toBe('second')
})

test('the user config is written once and never overwrites edits', () => {
  const root = stateRoot()
  const home = resolveEditorHome(root)
  ensureEditorConfig(home)
  const written = readFileSync(home.initPath, 'utf8')
  // It loads Hulala's own settings and says where they live; that is all.
  expect(written).toContain('HULALA_NVIM_CONFIG')
  expect(written).toContain('hulala.lua')
  expect(statSync(home.initPath).mode & 0o777).toBe(0o600)
  writeFileSync(home.initPath, '-- edited\n')
  ensureEditorConfig(home)
  expect(readFileSync(home.initPath, 'utf8')).toBe('-- edited\n')
})

test('Hulala\'s own editor settings are rewritten when they change', () => {
  const root = stateRoot()
  const home = resolveEditorHome(root)
  ensureEditorConfig(home)
  // An installation whose settings were written by an older client: the file is
  // not the user's, so the current settings replace it, or no editor fix would
  // ever reach an existing installation.
  writeFileSync(home.basePath, '-- older settings\n')
  ensureEditorConfig(home)
  const written = readFileSync(home.basePath, 'utf8')
  expect(written).toBe(NVIM_BASE_LUA)
  expect(written).toContain(NVIM_BASE_MARKER)
  expect(statSync(home.basePath).mode & 0o777).toBe(0o600)
  // Writing it again is a no-op rather than a new mtime on every editor start.
  const before = statSync(home.basePath).mtimeMs
  ensureEditorConfig(home)
  expect(statSync(home.basePath).mtimeMs).toBe(before)
})

test('the shipped settings render Markdown from the bundled plugin', () => {
  const root = stateRoot()
  const home = resolveEditorHome(root)
  ensureEditorConfig(home)
  const written = readFileSync(home.basePath, 'utf8')
  // Rendered in the buffer, from the plugin that ships with the editor.
  expect(written).toContain('render-markdown')
  expect(written).toContain('file_types = { "markdown" }')
  // A heading band stops where the words stop, and every level is told apart by
  // hue alone: the palette's brightest colours, sorted, with no dimming mixed
  // into the text.
  expect(written).toContain('width = "block"')
  // Level 1 is the palette's red warmed towards its yellow; yellow itself is
  // level 2, then green, cyan, blue and magenta. The ink is the palette colour.
  expect(written).toContain('blend(theme_value("error", fg), yellow, 0.5)')
  expect(written).toContain('local BAND_TINT = { 0.12, 0.10, 0.08, 0.06, 0.05, 0.04 }')
  expect(written).toContain('local spec = { fg = hue, bold = level <= 4 }')
  expect(written).not.toContain('chroma(')
  expect(written).toContain('foregrounds = heading_inks')
  expect(written).toContain('backgrounds = heading_bands')
  // Markdown is highlighted by Vim's syntax files in the editor, so the level
  // groups are the legacy markdown ones; treesitter captures are set as well.
  expect(written).toContain('"markdownH" .. level')
  expect(written).toContain('"@markup.heading." .. level')
  // The document stays rendered in normal mode: upstream reveals the raw source
  // under the cursor, which flips a whole table row back to its pipes mid-read.
  expect(written).toContain('anti_conceal = { disabled_modes = { "n" } }')
  // The editor never fetches a plugin: the release package carries this one.
  const vendor = join(import.meta.dir, '..', '..', 'vendor', 'render-markdown.nvim')
  expect(existsSync(join(vendor, 'lua', 'render-markdown', 'init.lua'))).toBe(true)
  expect(existsSync(join(vendor, 'VENDOR.md'))).toBe(true)
})

test('the Markdown samples cover every construct the renderer draws', () => {
  // The pages a human opens in the editor column to check rendering by eye,
  // one per language: the website screenshots the page in its own language.
  for (const name of ['markdown-sample.zh-CN.md', 'markdown-sample.en.md']) {
    const sample = readFileSync(join(import.meta.dir, '..', 'fixtures', 'editor', name), 'utf8')
    expect(sample).toMatch(/^##### /m) // heading levels 1 through 5
    expect(sample).toMatch(/^ {2}- /m) // nested unordered lists
    expect(sample).toMatch(/^ {2,}1\. /m) // nested ordered lists
    expect(sample).toMatch(/^- \[ \] /m) // task list states
    expect(sample).toMatch(/^- \[x\] /m)
    expect(sample).toMatch(/^\|:-/m) // a table with an alignment row
    expect(sample).toMatch(/^```mermaid$/m) // fenced code with and without a language
    expect(sample).toMatch(/^```lua$/m)
    expect(sample).toMatch(/^> /m) // a quote
  }
})

test('each Markdown sample is written in one language and the same sections', () => {
  const read = (name: string): string =>
    readFileSync(join(import.meta.dir, '..', 'fixtures', 'editor', name), 'utf8')
  const chinese = read('markdown-sample.zh-CN.md')
  const english = read('markdown-sample.en.md')
  expect(chinese).toMatch(/[\u4e00-\u9fff]/)
  // No Chinese in the English page: its screenshots stand on their own.
  expect(english).not.toMatch(/[\u4e00-\u9fff]/)
  const sections = (page: string): string[] => [...page.matchAll(/^## (\d+)\./gm)].map(match => match[1] ?? '')
  expect(sections(english)).toEqual(sections(chinese))
})

test('the shipped settings show dotfiles in the file tree', () => {
  const root = stateRoot()
  const home = resolveEditorHome(root)
  ensureEditorConfig(home)
  // The explorer's own `hidden` switch: dotfiles are ordinary project files.
  expect(readFileSync(home.basePath, 'utf8')).toMatch(/explorer = \{[^}]*hidden = true/)
})

test('the editor environment isolates XDG homes and points at the published data', () => {
  const root = stateRoot()
  const home = resolveEditorHome(root)
  const pkg = packageRoot(root)
  publishEditor(home, pkg)
  const published = resolveEditorHome(root)
  const env = editorEnvironment(published, FALLBACK_THEME)
  expect(env.XDG_CONFIG_HOME).toBe(published.configHome)
  expect(env.XDG_DATA_HOME).toBe(published.dataHome)
  expect(env.XDG_STATE_HOME).toBe(published.stateHome)
  expect(env.VIMRUNTIME).toBe(published.runtime)
  expect(env.HULALA_NVIM_PARSERS).toBe(published.parsers)
  expect(env.HULALA_NVIM_SNACKS).toBe(published.plugin)
  expect(env.HULALA_NVIM_CONFIG).toBe(published.basePath)
  expect(env.HULALA_NVIM_PLUGIN_DIR).toBe(published.pluginDir)
  expect(env.HULALA_NVIM_BUNDLED_PLUGINS).toBe(published.pluginRoot)
  // The editor draws Mermaid by running this same build as a child process, so
  // there is no second engine to ship and no per-platform binary.
  const mermaid = JSON.parse(env.HULALA_NVIM_MERMAID ?? '{}') as { argv?: string[] }
  expect(mermaid.argv?.at(-1)).toBe('--mermaid-render')
  expect(mermaid.argv?.length).toBe(3)
  expect(published.pluginRoot).toBe(join(root, 'runtime', 'editor', 'nvim-plugins'))
  // Created on first use, so dropping a plugin in needs no other setup.
  expect(existsSync(published.pluginDir)).toBe(true)
  expect(JSON.parse(env.HULALA_NVIM_THEME ?? '{}')).toMatchObject({
    background: FALLBACK_THEME.background,
    foreground: FALLBACK_THEME.foreground,
  })
  // No ripgrep was passed, so the child keeps the inherited PATH untouched.
  expect(env.PATH).toBeUndefined()
})

test('the editor PATH appends the ripgrep directory after the user entries', () => {
  const root = stateRoot()
  const home = resolveEditorHome(root)
  const env = editorEnvironment(home, FALLBACK_THEME, home.binHome)
  expect(env.PATH).toBe(`${process.env.PATH ?? ''}:${home.binHome}`)
  expect(env.PATH?.endsWith(home.binHome)).toBe(true)
})
