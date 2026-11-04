<div align="center">
  <img src="assets/brand/hulala-logo-v2.svg" alt="Hulala" width="128" />
  <h1>Hulala</h1>
  <p>A local-first DeepSeek Harness workbench for the terminal.</p>
  <p><a href="README.zh-CN.md">简体中文</a> · <a href="https://hulala.ai/">Website</a></p>
</div>

Hulala is built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

One Host daemon owns one state root and runs the Harness engine. Every terminal
window is a client that attaches to that process — open as many as you like, and
closing one detaches instead of stopping anything. A running turn continues after
the window that started it is gone.

The Host exposes DSH's native `/connect` authentication, `/api` Remote calls and
`/api/remote.mux` event streams. There is no second REST layer and no second
Agent Runtime.

## Clients

**Terminal** — `hulala` attaches to the local Host (starting a detached one when
none answers) and opens the terminal client:

```sh
hulala                              # terminal client
hulala --resume <session-id>        # continue a saved Session
hulala host start|stop|status       # manage the shared Host daemon
hulala update                       # install the latest release
hulala update --check               # report without installing
```

Inside the terminal, `/help` lists the client commands: Sessions, prompts,
streaming output, approvals, questions, model selection and cancellation.

**Website** — `apps/website` is the public download site; it does not embed an
Agent Runtime.

## The terminal client is a plugin host

One window is one Cordis `Context`. The kernel
(`apps/cli/src/tui/kernel.ts`) owns only the `Context` and its disposal; every
feature is a plugin under `apps/cli/src/tui/plugins/`:

```text
kernel            Context creation, plugin loading, disposal
lifecycle         the closing flag
viewModel         Host events folded into transcript items
terminal          the terminal device, its screen, the keybinding table
render            the frame loop and its sync steps
layout            the frame: seven seats, column geometry, focus
editor            the bundled editor: publication, environment, marker files
panes             the right column: a program in a pty
composer          the input line and the dock slot a picker borrows
overlays          approvals, questions, selectors, the keyboard hold
session           the open Session, its directory, model and follow stream
rail              the Session list column
view              the transcript and the dock rows
commands          slash commands and prompt delivery
input             the single input pipeline
update            the release notice and the swap
user              the loader for plugins you install
```

Seats are a closed set — `main`, `dock.pending`, `dock.cwd`, `dock.input`,
`dock.status`, `rail`, `pane` — and a seat declares **content, never geometry**.
Widths, minimums and the narrow-terminal rules stay the frame's business.

Because the client is assembled from plugins, a feature can be replaced without
touching its neighbours, and a failure is contained: one plugin that cannot
activate, or whose `render` throws, costs its own rows and nothing else.

### Your own plugins

A plugin is one plain `.mjs` file in a directory. It imports nothing — the whole
API arrives as the argument to `activate` — so it needs no build step and no
`node_modules`.

```sh
hulala plugin new hello      # writes ~/.hulala/config/plugins/hello/
hulala plugin check hello    # validates it and renders every seat it registers
hulala plugin list           # what is installed, and what is switched off
hulala plugin disable hello  # stop loading it, without deleting it
```

```js
/** @param {import('@hulala/plugin-sdk').PluginApi} tui */
export function activate(tui) {
  tui.command('hello', 'Say hello', () => { tui.notice('hello') })
  return tui.seat('dock.status', { id: 'hello' }, {
    render: width => [`hello from ${width} columns`],
  })
}
```

The contract lives in `packages/tui-plugin` and **only ever grows**: a field may
be added, a field never changes meaning inside an API version. A plugin that
targets an API this client does not implement is refused by name at load time,
with both numbers in the message.

There is no sandbox. A plugin is ordinary ESM with the client's own privileges.
Install one only from a source you would run directly.

## Creator mode

Off by default. When you turn it on, the Host gains a read-only view of its own
Cordis surface and the agent gains the tools to inspect it — so the agent can
write a plugin for your own terminal client.

```sh
hulala creator on     # then: hulala host stop, so the Host restarts with it
hulala creator status
hulala creator off    # removes the capability from the composition again
```

The switch is `<state root>/config/creator.json`. Turning it off strips the rows
from an existing profile; the capability disappears rather than idling.

## Install

```sh
curl -fsSL https://hulala.ai/install.sh | sh
```

Supported: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`. Windows is
not implemented. Node.js 22.13+ is required on the machine; Neovim is not,
because one is bundled.

The release package is a self-contained Node install:

```text
hulala-<version>-<target>/
  bin/hulala                 Node CLI and terminal client
  bin/nvim                   bundled Neovim (runtime tree under runtime/editor/)
  bin/ime                    macOS input-source helper (darwin targets only)
  server/hulala-host.mjs     Host wrapper
  runtime/host.mjs           compiled Host
  runtime/node_modules/      DeepSeek Harness engine
  runtime/editor/            Neovim runtime, tree-sitter parsers, snacks.nvim
  manifest.json
```

Every bundled binary is a real file, never a symlink: the installer copies them
into `$HULALA_HOME/bin`, and the client republishes them there (with the editor's
runtime data under `$HULALA_HOME/runtime/editor/`) on the first editor open after
an upgrade. `rg` is published the same way from the `@vscode/ripgrep` package the
Harness installs for its own `grep` tool, so the editor's pickers and anything the
model runs through `bash` never need ripgrep on the machine; that directory is
appended to those child processes' `PATH`, so an installed `rg` still wins.

`Ctrl+T` opens the built-in terminal — the user's shell in the Session directory —
and `Ctrl+F` opens the editor column; on macOS the input source switches to
English while the editor has focus and back when focus returns to the composer.
`Ctrl-[` returns to the composer without closing the column, and the column keeps
its process when hidden, so shell jobs and Neovim buffers survive. See
`apps/cli/README.md`.

## Run from source

Use Bun 1.4.2 and Node.js 24+. The Host runs on Node because DeepSeek Harness
boots through Node's internal module loader.

```sh
git clone https://github.com/colinagent/hulala.git
cd hulala
bun install --frozen-lockfile
bun run build
bun run start
```

Useful commands:

```sh
bun run check           # check:patches → typecheck → test → build
bun run check:patches   # prove every patchedDependencies entry is applied
bun run typecheck
bun run test
bun run host:build
bun run website:build
```

`check:patches` runs first on purpose. A `patchedDependencies` entry is keyed by
exact package version; when that key stops matching, bun ignores the patch in
silence and the build carries the unpatched upstream artifact. The check asserts
the installed version matches the key and that every line the patch adds is
present in the installed file.

## Layout

```text
apps/cli        terminal client, plugin host, program lifecycle
apps/server     Hulala Host daemon shell (DSH webServer + connection)
apps/website    public website and download metadata
packages/runtime     DSH composition (one native Agent Loop)
packages/host-client discovery, detached startup, shared client contract
packages/desktop-contracts  the Host/client wire contract and state-root paths
packages/tui-plugin  the contract a terminal-client plugin is written against
packages/distribution  install, update and rollback
```

## License

Hulala first-party code is licensed under GPL-3.0-only. Third-party components
retain their own licenses; see `THIRD_PARTY_NOTICES.md`.
