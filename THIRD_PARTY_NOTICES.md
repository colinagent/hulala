# Third-party notices

This repository vendors third-party source. Each copied package keeps its
upstream `LICENSE`. The project owner has not yet chosen a license for Loop
itself.

## DeepSeek Harness

- Project: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- Snapshot: commit `47f943859b`
- Location: `vendor/dsh/`
- License: MIT

## Cordis stack

Vendored from the same DeepSeek Harness checkout (`vendor/` there), originally
authored by Shigma and rescoped by DeepSeek to `@deepseek-ai/*`. Loop rescopes
them again to `@loopwithai/*`.

- Location: `vendor/cordis/`
- Packages: cosmokit, schemastery, cordis, loader, include, group, timer, hmr, logger-console
- License: MIT

See `vendor/README.md` for the package table and update procedure.
