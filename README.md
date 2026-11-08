<div align="center">
  <img src="assets/brand/hulala-logo-v2.svg" alt="Hulala" width="128" />
  <h1>Hulala</h1>
  <p>DeepSeek Harness for hackers.</p>
  <p>One TUI: Neovim, a real shell, a daemon you never have to babysit.</p>
  <p><a href="README.zh-CN.md">简体中文</a> · <a href="https://hulala.ai/">Website</a></p>
</div>

Hulala puts [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) in
your terminal and leaves the whole client open: the engine is DSH's own Agent
Loop, every panel is a plugin, and the agent can write plugins for the client it
runs inside.

<p align="center">
  <img src="assets/screens/03-files.png" alt="The editor column on the Session directory: the real file tree with a file open beside it" width="900" />
  <br />
  <sub><code>Ctrl-D</code>: Neovim on the Session directory — the bundled file tree, a file opened from it, and buffers kept while the column is hidden.</sub>
</p>

`Ctrl-D` opens the editor on the Session directory, so it is also the file tree:
the bundled explorer (`apps/cli/vendor/snacks.nvim`) replaces netrw, and picking
a file opens it beside the tree in the same column.

<p align="center">
  <img src="assets/screens/01-conversation.png" alt="The Hulala terminal client: Session rail, the conversation with tool rows, and the composer" width="900" />
  <br />
  <sub>The frame: the Session rail, the conversation with its tool rows, the pending inbox and the composer.</sub>
</p>

## What you get

- **Three columns, one window** — the Session rail on the left, the conversation
  in the middle, and one sidebar on the right: the built-in terminal on `Ctrl+T`,
  Neovim on `Ctrl-D`, and `Cmd-E` for Neovim alone.
- **Neovim and ripgrep included** — nothing to install. Every bundled binary is
  a real file in `$HULALA_HOME/bin`, and `bin/` is appended to the children's
  `PATH`, so your own tools still win.
- **A real shell in the Session directory** — a full pty in the right column; jobs
  and buffers survive when the column is hidden.
- **No tmux, no runner script** — the Host is already a daemon. Every window is
  a client that attaches to it; `Ctrl-Q` detaches and the turn keeps running.
- **The Harness surfaces, not a copy** — streaming output, approvals, questions,
  model selection, cancellation, `/connect`, `/api` and `/api/remote.mux`.
- **A plugin is one `.mjs` file** — `hulala plugin new|check|list|disable`, no
  build step and no `node_modules`.
- **Creator mode** — the agent gains a read-only view of the client's own Cordis
  surface and the tools to inspect it, so it can write a plugin for the client it
  runs inside.

One Host daemon owns one state root and runs the Harness engine; there is no
second REST layer and no second Agent Runtime.

## No tmux, no runner script

`hulala` is not a program you launch per window and lose when the window closes.
One Host daemon owns the state root; every terminal window is a client that
attaches to that process, and any number of them can be open at once.

```sh
hulala host start        # the one Host for this state root, detached
hulala                   # attach a window — do this in as many terminals as you like
hulala host status       # what the daemon is doing
hulala host stop         # the only thing that stops it
```

Clients discover the daemon through `endpoint.json` in the state root, so a
second window never starts a private rival while a healthy Host answers. Closing
a window (`Ctrl-Q`) detaches: the model call, the tool calls and the Session keep
going, and the next window resumes where the work actually is. `tmux`, `nohup`
and a bare `&` exist to fake exactly this; here it is what the program does by
default, and `hulala host stop` is the explicit way to end it.

<p align="center">
  <img src="assets/screens/02-terminal.png" alt="The built-in terminal column: a shell in the Session directory" width="900" />
  <br />
  <sub><code>Ctrl-T</code>: the built-in terminal — your shell in the Session directory, with its own scrollback.</sub>
</p>


## Keyboard

The frame is drivable without a mouse:

| Keys | Does |
|---|---|
| `Ctrl-T` | open the built-in terminal in the right column; press again to close it |
| `Ctrl-D` | open Neovim in the same column; press again to close it (it asks before dropping unwritten buffers) |
| `Cmd-E` | Neovim only: put the Session rail and the conversation away and leave the editor column alone; press again to restore the layout from before |
| `Shift-Cmd-S` | show or hide the Session rail |
| `Shift-Cmd-C` | put the conversation away while a column is open |
| `Shift-Cmd-P` | the command palette: every command, what it does, and its shortcut, from any column and with the conversation put away |
| `Ctrl-[` / `Ctrl-]` | move the keyboard between the Session rail, the conversation and the painted column |
| `Ctrl-Q` | detach: the window closes and the Host keeps running the turn |
| `Esc` | stop the running turn; with nothing running, move into the rail |
| `Ctrl-C` | stop the running turn; on an idle composer clear the draft, then quit |
| `Enter` | send; while a turn runs, `Alt-Enter` queues the message as the next turn |
| `Alt-Up` | take queued messages back into the composer |
| `Ctrl-O` | expand the tool row under the pointer |
| `Shift-Tab` | cycle the thinking level of the current model; `/thinking` opens the level picker |
| `Ctrl-S` | write the editor buffer now (it otherwise autosaves) |
| `Cmd-Ctrl-[` / `Cmd-Ctrl-]` | move the divider beside the focused column: the column on its right grows or shrinks |
| `Ctrl-Shift-[` / `Ctrl-Shift-]` | the same move; `Ctrl-Shift-←` / `Ctrl-Shift-→` is the spelling every terminal reports |
| drag the divider | the same move with the pointer, on either side of the frame |
| `Shift-PgUp` / `Shift-PgDn` | page the terminal column's own history |
| `↑` `↓` `j` `k` `Ctrl-P` `Ctrl-N` | move in a list; `Tab` completes, `Enter` opens |
| `/` | a command: `/help`, `/sessions`, `/new`, `/model`, `/thinking`, `/editor`, `/terminal`, `/nvim`, `/rail`, `/chat`, `/keys`, `/cancel`, `/quit` |

The Command chords (`Cmd-E`, `Shift-Cmd-S`, `Shift-Cmd-C`, `Shift-Cmd-P`) are
delivered only by a terminal that speaks the Kitty keyboard protocol — Ghostty,
kitty, WezTerm and iTerm2 do, Terminal.app does not. Every one of them has a
slash-command equal, so the layout is reachable from any terminal:
`/nvim`, `/rail`, `/chat`, `/commands`. Ctrl-`F` is not taken by anything: it
stays forward-char in the composer and a shell, and page-down in Neovim.

### Custom keybindings

Every chord above can be rebound in `$HULALA_HOME/config/keybindings.json`:

```json
{
  "panel.editor": ["ctrl+f"],
  "panel.rail": ["ctrl+g"],
  "panel.commands": ["shift+super+p", "f1"]
}
```

A value is a list of key spellings (the same names the tables use: `ctrl`, `alt`,
`shift`, `super`, plus a letter, `escape`, `enter`, `tab`, `space`, `pageup`,
`left`, `f1`…); the label form works too, so `Shift-Cmd-S` and `super+shift+s` are
the same chord. An empty list disables the action, and an action the file does not
mention keeps its default. pi-tui's own composer bindings (`tui.editor.*`) are
accepted in the same file. A typo, an unknown action or one key bound to two
actions is reported in the client and never silently swallowed, and at least one
way to quit always stays bound.

`/keys` prints the bindings in force and re-reads the file; the startup hints and
`/help` always print the keys that are actually bound, never the defaults.

`/help` prints the same list inside the client, which is the version to trust if
a key is swallowed by your terminal or input method.

The footer is one band across the bottom: a rotating usage hint on the left, the
context and token readings in the middle, and the model with its thinking level
on the right, and the working directory at the top of the Session rail.

## Clients

**Terminal** — `hulala` attaches to the local Host (starting a detached one when
none answers) and opens the terminal client:

```sh
hulala                              # terminal client
hulala --resume <session-id>        # continue a saved Session
hulala update                       # install the latest release
hulala update --check               # report without installing
```

Inside the terminal, `/help` lists the client commands: Sessions, prompts,
streaming output, approvals, questions, model selection and cancellation.

**Website** — `apps/website` is the public download site; it does not embed an
Agent Runtime.

## Everything is a plugin

One window is one Cordis `Context`, and nothing above the kernel is fixed. The
kernel (`apps/cli/src/tui/kernel.ts`) owns only the `Context` and its disposal;
every feature is a plugin under `apps/cli/src/tui/plugins/`:

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
write a plugin for your own terminal client. This is the claim above taken
literally: the thing you are talking to can extend the thing you are typing in.

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

Then, in any terminal:

```sh
hulala                  # attach to the Host on this machine
hulala update           # install the latest release
hulala update --check   # report without installing
hulala rollback         # go back to the previous release
hulala host stop        # stop the daemon (the only thing that does)
```

Supported: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`. Windows is
not implemented. Neovim is bundled; Node.js is not. `install.sh` uses a Node.js
24.9+ that the machine already has, and otherwise offers to install one: with
Homebrew, `apt-get` or `apk` when that package manager can supply 24.9+, and
with a SHA-256 verified standalone archive under `$HULALA_HOME/runtime/node`
otherwise. A piped install with no terminal never guesses: it stops and prints
the requirement. When the installer runs in a terminal it ends by offering to start the client
(`Start Hulala now? [Y/n]`), so the first run works even before the shell has
picked up a newly registered `PATH`; `HULALA_NO_START=1` skips the question for
scripted installs. The download side is built for networks that need help: the
installer picks up a macOS (`scutil`) or GNOME (`gsettings`) system proxy and
exports it for its own downloads, falls back to the npmmirror, TUNA or Tencent
Node.js mirrors when `nodejs.org` is unreachable, and honours `HTTPS_PROXY`,
`HULALA_NODE_BASE` and `HULALA_NODE_LINE`.

Everything Hulala writes lives under `$HULALA_HOME` (default `~/.hulala`):
`config/`, `desktop/`, `server/`, `runtime/`, `logs/`, `cache/`, `transfers/`
and `bin/`. The installer's only link outside that directory is the `hulala`
command in a directory you already have on `PATH`; no shell profile is edited
unless you pass `--add-to-path`. When the installer supplied Node, it lives in
`runtime/node/` and the `hulala` command starts it from there, so the command
also works in a shell that never learns about that directory.

The release package layout (neither the runtime nor the dependency tree is part
of it):

```text
hulala-<version>-<target>/
  bin/hulala                 Node CLI and terminal client
  bin/nvim                   bundled Neovim (runtime tree under runtime/editor/)
  bin/ime                    macOS input-source helper (darwin targets only)
  server/hulala-host.mjs     Host wrapper
  runtime/host.mjs           compiled Host
  runtime/package.json       dependency list this release resolves
  runtime/package-lock.json  the lock `npm ci` uses on your machine
  runtime/editor/            Neovim runtime, tree-sitter parsers, snacks.nvim
  manifest.json
```

The archive is about 10 MB because it carries no `node_modules`: `hulala install`
installs the dependency tree from the release's npm lock with `npm ci` (through the
machine's proxy, with `registry.npmmirror.com` as the retry). The LibreOffice
engine behind DSH's `dsh-office-to-pdf` is not installed at all: it is 140 MB
unpacked, and the terminal client has no document conversion. Packaging prunes it
and boots the packaged Host to prove the rest still starts.

Every bundled binary is a real file, never a symlink: the installer copies them
into `$HULALA_HOME/bin`, and the client republishes them there (with the editor's
runtime data under `$HULALA_HOME/runtime/editor/`) on the first editor open after
an upgrade. `rg` is published the same way from the `@vscode/ripgrep` package the
Harness installs for its own `grep` tool, so the editor's pickers and anything the
model runs through `bash` never need ripgrep on the machine; that directory is
appended to those child processes' `PATH`, so an installed `rg` still wins.

The terminal and the editor columns share one sidebar: only the painted one is
shown, and neither process is closed when the other is. A hidden column keeps its
process, so shell jobs and Neovim buffers survive. See [Keyboard](#keyboard) for
the keys and `apps/cli/README.md` for the full contract.

On macOS every panel switches the input source to English
(`com.apple.keylayout.ABC`) while it owns the keyboard — the Session rail and its
filter box, the editor column, the shell column — because a panel reads keys as
program input. The composer is never switched: it keeps exactly the source the
user left there, including a manual switch to Chinese. The helper that does the
switching is `bin/ime`, shipped by the release package and built from
`apps/cli/native/ime.c` on the first start of a source checkout.

## Run from source

Use Bun 1.4.2 and Node.js 24+. The Host runs on Node because DeepSeek Harness
boots through Node's internal module loader.

```sh
git clone https://github.com/colinagent/hulala.git
cd hulala
bun install --frozen-lockfile
bun run start
```

`bun run start` is the development entry: it stops the Host for this
`HULALA_HOME`, rebuilds `apps/server` from the working tree, and starts the
terminal client, so the Host always runs the current checkout. There is no
version comparison — the source and the installed release share the package
version. Because it replaces the shared daemon, other clients attached to that
Host disconnect; use `bun run start:attach` when you only want to attach.

Useful commands:

```sh
bun run check           # check:patches → typecheck → test → build
bun run check:patches   # prove every patchedDependencies entry is applied
bun run typecheck
bun run test
bun run start:attach   # attach to the running Host without rebuilding it
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
