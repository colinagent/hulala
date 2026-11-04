# Third-party notices

Hulala includes and integrates the following third-party software. Each
dependency retains its upstream license.

## DeepSeek Harness

- Project: https://github.com/deepseek-ai/deepseek-harness
- Packages: `@deepseek-ai/dsh`, Agent/session/API/Web packages, Cordis and Schemastery
- Harness version: `0.2.1-rc.2`
- License: MIT

## Cordis stack

- Project source: the Cordis packages distributed with DeepSeek Harness
- Packages: Cordis, loader, include, group, timer and related packages
- License: MIT

## Undici

- Project: https://github.com/nodejs/undici
- Package: `undici` 8.9.0
- License: MIT

The npm package also contains a generated `dist/THIRD_PARTY_NOTICES.md` copied
from the source repository at build time.

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

## libghostty-vt (Ghostty)

- Project: [ghostty-org/ghostty](https://github.com/ghostty-org/ghostty)
- Commit: `c7f68a7f48c6a5b357689eb8c2328bc2dab5d8ed`
- Use: the terminal engine behind the terminal and editor columns of the TUI
- Build: `zig build -Demit-lib-vt -Dtarget=wasm32-freestanding -Doptimize=ReleaseFast`,
  optimised with `wasm-opt -O3`
- License: MIT; the compiled module is vendored as `apps/cli/vendor/ghostty-vt.wasm`
  (digest in `ghostty-vt.SHA256`) and shipped as `runtime/ghostty-vt.wasm`
