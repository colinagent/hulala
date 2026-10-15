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
- Version: `0.1.5-rc.2` for Harness packages
- License: MIT
- Local patch: `patches/@deepseek-ai%2Fdsh-subprocess-local@0.1.5-rc.2.patch`
  preserves the native subprocess runner's argument delimiter under Bun.

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
- License: commercial package terms; see the package's bundled `README.md`

## Undici

- Project: [nodejs/undici](https://github.com/nodejs/undici)
- Package: `undici` 8.9.0
- Use: process-wide HTTP dispatcher and HTTP/HTTPS proxy support
- License: MIT

## SSH2

- Project: [mscdex/ssh2](https://github.com/mscdex/ssh2)
- Package: `ssh2` 1.17.0
- Use: local SSH authentication, verified host keys, SFTP and loopback forwarding
- License: MIT

## Harness SDK inbox

- Source: DeepSeek Harness `dsh-v0.1.5-rc.2`, `packages/core/agent-loop/src/inbox.ts`
- Location: `packages/agent-loop-pi/src/inbox.ts`
- License: MIT; the full upstream notice is retained in the file.
- Reused for native SDK agents because the published package exposes the Inbox contract but not its durable implementation.

## Browser workbench

The browser workbench uses the following third-party components. Exact resolved
versions are pinned in `bun.lock`; the packages retain their own license texts.

| Components | License |
| --- | --- |
| React, React DOM, CodeMirror, Lezer, Excalidraw, React Flow, Dagre | MIT |
| beautiful-mermaid, i18next, react-i18next, react-markdown, remark-gfm | MIT |
| KaTeX, Prism, jsonc-parser, unicode-animations, Zustand, fflate | MIT |
| PDF.js (`pdfjs-dist`), docx-preview | Apache-2.0 |
| epub.js | BSD-2-Clause |
| YAML | ISC |
| JetBrains Mono font (distributed through Fontsource) | SIL Open Font License 1.1 |
| Excalidraw's bundled fonts | Their accompanying font licenses, copied into the web build |

The Seti icon mapping and font under
`apps/workbench/src/renderer/assets/file-icons/seti/` derive from
[Seti UI](https://github.com/jesseweed/seti-ui), pinned by the mapping to commit
`2d6c5e68b4ded73c92dac291845ee44e1182d511`, and the VS Code Seti theme.
They are MIT licensed. The upstream license and VS Code theme notices are kept
alongside the assets. Do not remove these notices from distributions.

The browser installer uses [tar-stream](https://github.com/mafintosh/tar-stream),
MIT, copyright Mathias Buus. Native distribution packages include its license and
those of its declared CLI dependencies under `licenses/cli/`, with a versioned
inventory. It parses archive records; Hulala applies its own path, entry-type,
size and package-integrity checks before accepting an installation.

The optional Claude integration uses `@anthropic-ai/claude-agent-sdk`, which is
provided under Anthropic's commercial terms, not Apache-2.0. Its package README
and component notices remain in the Runtime distribution. Hulala's license does
not relicense that SDK. See the [official SDK license and terms](https://code.claude.com/docs/en/agent-sdk/overview#license-and-terms)
and [Anthropic Commercial Terms](https://www.anthropic.com/legal/commercial-terms).
