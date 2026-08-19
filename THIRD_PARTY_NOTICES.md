# Third-party notices

This repository vendors third-party source. Each copied package keeps its
upstream `LICENSE`. Hulala itself is licensed under Apache-2.0; see the
root `LICENSE` file.

## DeepSeek Harness

- Project: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- Snapshot: commit `47f943859b`
- Location: `vendor/dsh/`
- License: MIT

## Cordis stack

Vendored from the same DeepSeek Harness checkout (`vendor/` there), originally
authored by Shigma and rescoped by DeepSeek to `@deepseek-ai/*`. Loop rescopes
them again to `@hulala/*`.

- Location: `vendor/cordis/`
- Packages: cosmokit, schemastery, cordis, loader, include, group, timer, hmr, logger-console
- License: MIT

See `vendor/README.md` for the package table and update procedure.

## DeepSeek Harness packages

- Packages: `@deepseek-ai/dsh`, Agent/session/Web packages, Cordis and
  Schemastery
- Version: `0.1.0-rc.6` for Harness packages
- License: MIT

## Pi Coding Agent

- Project: [earendil-works/pi](https://github.com/earendil-works/pi)
- Package: `@earendil-works/pi-coding-agent` 0.84.1
- License: MIT

## OpenAI Codex

- Project: [openai/codex](https://github.com/openai/codex)
- Integration: the locally installed `codex app-server` JSONL protocol
- License: Apache-2.0

## Claude Agent SDK

- Package: `@anthropic-ai/claude-agent-sdk` 0.3.232
- License: commercial package terms; see the package's bundled `LICENSE.md`

## Undici

- Project: [nodejs/undici](https://github.com/nodejs/undici)
- Package: `undici` 8.9.0
- Use: process-wide HTTP dispatcher and HTTP/HTTPS proxy support
- License: MIT
