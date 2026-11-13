/**
 * The editor Hulala ships, resolved on the machine that runs it.
 *
 * The editor is a Host-side program: Neovim, its runtime, the vendored plugins
 * and the settings file all live where the file system does. This package owns
 * that resolution and the generated Lua, so the client that publishes the
 * release files and the Host that starts Neovim read the same home.
 *
 * @module @hulala/editor-home
 */
export * from './editorHome.js'
export * from './editorTheme.js'
export * from './nvimConfig.js'
export * from './ripgrep.js'
