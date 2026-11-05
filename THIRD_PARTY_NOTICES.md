# Third-party notices

Hulala first-party code is licensed under GPL-3.0-only; see the root `LICENSE`
file. Third-party packages retain their own licenses.

## DeepSeek Harness

- Project: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- Packages: `@deepseek-ai/dsh`, Agent/session/API/Web packages, Cordis and
  Schemastery
- Version: `0.2.2-rc.1`
- License: MIT
- Local patch: `patches/@deepseek-ai%2Fdsh-subprocess-local@0.2.2-rc.1.patch`
  preserves the native subprocess runner's argument delimiter under Bun.

## Cordis stack

Cordis, loader, include, group, timer, hmr and related packages are distributed
with DeepSeek Harness and retain their MIT licenses. Hulala pins the line DSH
`0.2.2-rc.1` resolves against: Cordis `4.1.0`, plugin include, loader, group and
hmr `1.1.0`, timer `1.2.0`, Schemastery `3.19.0`.

## Undici

- Project: [nodejs/undici](https://github.com/nodejs/undici)
- Package: `undici` 8.9.0
- Use: HTTP client/dispatcher used by DeepSeek Harness packages
- License: MIT

## SSH2

- Project: [mscdex/ssh2](https://github.com/mscdex/ssh2)
- Package: `ssh2` 1.17.0
- Use: Desktop SSH authentication, verified host keys and SFTP
- License: MIT

## Removed surfaces

Desktop and the browser workbench are no longer built or shipped from this
repository, so the components they used (React, CodeMirror, Excalidraw, PDF.js,
epub.js, KaTeX, the Seti icon set and their transitive dependencies) are not part
of any distribution. Their notices lived here while those clients shipped.

The CLI installer uses [tar-stream](https://github.com/mafintosh/tar-stream),
MIT, copyright Mathias Buus. Native distribution packages include its license and
those of its declared CLI dependencies under `licenses/cli/`, with a versioned
inventory. It parses archive records; Hulala applies its own path, entry-type,
size and package-integrity checks before accepting an installation.

## Neovim

- Project: [neovim/neovim](https://github.com/neovim/neovim)
- Version: bundled per release, pinned in `scripts/release/editorBundle.ts`
- Use: the editor column of the terminal client
- License: Apache-2.0 with the Vim license for the runtime files; both are
  shipped unmodified as `bin/nvim` and under `runtime/editor/nvim/`

## snacks.nvim

- Project: [folke/snacks.nvim](https://github.com/folke/snacks.nvim)
- Commit: `882c996cf28183f4d63640de0b4c02ec886d01f2`
- Use: the editor's file tree and fuzzy pickers
- License: MIT; vendored unmodified under `apps/cli/vendor/snacks.nvim/`

## reader.nvim

- Project: [Sang-it/reader.nvim](https://github.com/Sang-it/reader.nvim)
- Commit: `1603abdf0b3d2082f8d39c6fe2cbde11cc419fa2`
- Use: the editor's EPUB reader (`:Reader book.epub`)
- License: MIT; vendored under `apps/cli/vendor/reader.nvim/`
