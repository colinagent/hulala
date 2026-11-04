# Hulala CLI

`hulala` attaches to the local Hulala Host (starting a detached one when none
answers) and opens the terminal client. The Host is one DeepSeek Harness process
per state root; closing the terminal only detaches, and running turns continue.

```sh
hulala                              # attach to the Host and open the terminal client
hulala --resume <session-id>        # continue a saved Session
hulala host start|stop|status       # manage the shared Host daemon
hulala install|update|rollback|uninstall|doctor [options]
```

The terminal client performs the DSH `/connect?token=...` exchange for a signed
Cookie, then uses the native `/api` Remote calls and `/api/remote.mux` event
streams. It does not start a private Agent Runtime and there is no second REST
surface. `/help` inside the client lists `/sessions`, `/new`, `/model`,
`/cancel`, `/status`, `/editor`, `/terminal` and `/quit`.

The frame has three columns: the Session rail on the left, the conversation in
the middle, and one sidebar column on the right — the built-in terminal on
`Ctrl-T`, Neovim on `Ctrl-F`. The two sidebar columns keep separate processes
and only one is painted at a time. Each column key opens its column and takes
the keyboard, and closes it again when that column is already painted, wherever
the keyboard is. `Ctrl-[` / `Ctrl-]` move focus between the rail, the
conversation and the sidebar without closing anything. `Ctrl-D` puts the
conversation away and
brings it back. It only hides while the rail or a sidebar column is on screen,
so the frame never loses its last column; hiding it gives the sidebar the space
the conversation had. `Ctrl-Q` exits, in the slot pi gives `Ctrl-D`, and still asks a dirty
Neovim before leaving.

## Interrupting a turn

`Esc` aborts the running turn, like pi's `app.interrupt`: the Host cancels the
request and any tool call in flight, the text already streamed stays in the
transcript, and the turn closes with a `Turn cancelled` notice instead of a new
attempt. `Ctrl-C` does the same while a turn runs; on an idle composer it clears
the input first and then quits on the second press. `/cancel` sends the same
request.

An `Esc` press belongs elsewhere in two cases. While the completion menu is open
it only closes the menu, and while a column has focus it belongs to the program
whenever the program has something to cancel — a full-screen terminal program, or
Neovim outside normal mode. Both cases exist because `Esc` and `Ctrl-[` are one
key. With no turn running, `Esc` is the
leftward move into the Session rail, keeping whatever draft the composer holds;
inside the rail it returns to the composer (clearing the filter first). With the
rail put away, a second `Esc` within half a second opens the searchable Session
picker (`/sessions`) instead. `Ctrl-G` shows or puts away the rail, and a hidden
rail comes back with the keyboard on the list; it stays the fallback for
terminals or input methods that swallow `Esc`. It only ever shows or hides —
moving the keyboard between the rail, the conversation and a column is `Ctrl-[`
/ `Ctrl-]`.

## The Session rail

The left column is the Session list, and it is on by default. It shows the
directory the open Session is in, a filter box, `+ 新会话`, the Sessions of that
directory and a folded `all` section for the Host's other directories:

```
┌ ~/note/projects/hulala ┐┌ the conversation ───────────┐┌ Neovim ─────┐
│ > search               ││                              ││             │
│ + 新会话               ││                              ││             │
│ ⠋ 修会话面板  3m      ││                              ││             │
│ ▸ 侧栏焦点方案     1h  ││                              ││             │
│   调试 Host 连接   2d  ││                              ││             │
│ ▸ all                  ││                              ││             │
└────────────────────────┘└──────────────────────────────┘└─────────────┘
```

A running Session carries the same braille spinner the Web sidebar's ongoing
dot stands for, including turns started from another terminal window or aimed at another
Session; the title is the Host's `session-title` projection and the trailing
label is the Web client's relative-time bucket (`now`, `5m`, `3h`, `2d`, `4mo`,
`1y`). The open Session is marked with `▸`; the row under the keyboard uses the
highlight colour and never a filled background. Blank Sessions are hidden
unless they are the open one.

| Key | Behaviour |
|---|---|
| `Ctrl-G` | show or put away the rail; a hidden rail comes back with the keyboard on the list |
| `Esc` / `Ctrl-[` | from the composer: move into the rail (a draft stays where it was); inside the rail: back to the composer |
| `Ctrl-]` | from the rail: back to the composer; from the composer: into the painted column |
| `↑`/`↓`, `j`/`k`, `Ctrl-P`/`Ctrl-N` | move the cursor |
| `Enter` | open the Session (on the `all` row: fold or unfold it) |
| `n` | create a Session in the open Session's directory and switch to it |
| `/` | focus the filter box; `Esc` clears it |
| `←` / `→` | fold / unfold the `all` section |
| `r` | re-read the list (the Host's events keep it current in between) |

The current directory shows one page of at most 30 Sessions, and never more than
the rail can show at once, so `More` always follows the last painted row instead
of a fixed line. The `↓ More · N` row sits inside the scroll, above the global
`all` row, and reveals the rest when taken (it becomes `↑ Less` to fold back). Nothing
is fetched lazily: the Host list already arrives whole over `session/list` and is
kept current by the `api-session/*` events, so paging is a view limit, exactly
like the Web sidebar's watermark. A running Session, or the open one, that sits
past the page pulls it out far enough to stay visible (up to 50 rows), and a
filter shows every match instead of a page.

The rail is a reading aid, so it stays narrow: `clamp(18, 15%, 24)` columns.
Three columns need 86 columns of terminal (conversation 34, sidebar column 32);
below that, opening a sidebar column hides the rail for as long as that column
is open and brings it back when the sidebar closes, so an 80-column terminal
still gets a usable terminal or editor. `/sessions` stays as the searchable
picker and still searches Session content.

## Steering and queueing

A message typed while a turn runs is not a second turn. `Enter` sends it as
steering — the Agent Loop claims it at its next step boundary, so the turn keeps
its clock and its tool state and simply reads what you added. `Alt-Enter` sends
it as a queued message instead, which runs as its own turn after the current one
finishes; on an idle Session both keys open the turn.

Both lists are the Host's durable `inbox` projection, so the pending rows sit
above the composer with what each one will do, and a second client attached to
the same Session sees the same rows. `Alt-Up` is pi's `app.message.dequeue`: it
removes every pending occurrence from the Host and puts the text back in the
composer, steering first, so a draft can be rewritten and sent again. A row that
carries an image or file another client queued is left in the queue and reported,
because the terminal cannot put it back into the composer.

The client is bundled into `dist/cli.js`. The npm launcher verifies and activates
the platform package; the installed program contains the Host and terminal
runtime. User configuration, native credentials and Workspaces survive
uninstall.

`HULALA_HOME` selects an isolated state root. The Host publishes `endpoint.json`
under `$HULALA_HOME/server/host`, and every client discovers the same daemon
through `@hulala/host-client/node`.

## Updates

The terminal client checks the release index in the background — at most once
every six hours, cached under `$HULALA_HOME/cache/update-check.json` — and shows
a one-time transcript notice plus a status-bar hint when a newer release exists.
Set `HULALA_SKIP_UPDATE_CHECK=1` (or `HULALA_OFFLINE=1`) to turn the check off;
`NO_UPDATE_NOTIFIER=1` is honored as well.

`hulala update` always checks the index and installs the result:

- a standalone install downloads the verified archive and activates its
  immutable version directory;
- a global npm, bun or pnpm install runs the matching package-manager command
  with the release pinned and lifecycle scripts disabled;
- an `npx` run prints the `npx hulala@latest` invocation because nothing is
  installed to replace.

Releases are stable-only. Use `hulala update --check` to report without changing
anything and `--version <x>` to install one explicit release. A running Host
keeps the version it loaded; `hulala host stop` and start it again to load the
update. User configuration, credentials and Workspaces are retained. An update
keeps the active version, the previous one `hulala rollback` returns to, and a
version another terminal is still running, then removes the version directories
nothing can reach any more.

The official `install.sh` hands the extracted package to its own
`hulala install`, so a download install and a manual `hulala install` share one
versioned layout (`versions/<id>`, `active.json`, `installation.json`) that
`hulala update` replaces in place. Everything it writes lives under
`$HULALA_HOME`; the command is `$HULALA_HOME/bin/hulala`, and `install` adds that
directory to the profile an interactive terminal reads — `$ZDOTDIR/.zshrc` (else
`~/.zshrc`), `~/.bashrc` or `~/.bash_profile` for bash, `~/.config/fish/config.fish`
for fish, `~/.profile` otherwise — inside a marked block (`--no-add-to-path` skips
it, `hulala uninstall` removes it) so `hulala` runs in the next terminal without
a manual `export PATH`.

## Release package

Build the standalone release package on its target platform:

```sh
bun run scripts/release/packageRelease.ts --version 0.1.6
```

Layout:

```text
bin/hulala                 Node ESM CLI and terminal client
bin/nvim                   bundled Neovim binary
bin/ime                    macOS input-source helper (darwin targets only)
server/hulala-host.mjs     Host wrapper
runtime/host.mjs           compiled Host
runtime/node_modules/      DeepSeek Harness engine and native deps
runtime/editor/nvim/       Neovim runtime tree and tree-sitter parsers
runtime/editor/nvim-plugins/snacks.nvim/   vendored file tree and pickers
manifest.json
```

## Updating

`hulala update` fetches the release archive into `~/.hulala/cache/releases/`
and installs it. The transfer **resumes**: an interrupted download keeps its
`.part` file and continues with a `Range` request, and the timeout is a stall
window (90 s without a byte) rather than a limit on the whole transfer, so a
slow but moving download finishes. Its last line names the new version.

Downloads can also happen ahead of time:

| Command | Effect |
|---|---|
| `hulala update --download-only` | fetch this release into the cache and stop |
| `hulala update --background` | the same, in a detached process; run `hulala update` later to install it |

When the package is already downloaded, the terminal client says so on its first
screen — `Update 0.1.16 is downloaded: /update installs it and restarts` — and
`/update` installs it and hands the terminal to the new version with the current
Session resumed, so the switch does not lose the conversation. Cached packages
for other versions are deleted after a successful install; a newer cached
release wins over the one the index advertises, and an unreachable index falls
back to whatever is already downloaded.

## The built-in terminal

`Ctrl-T` shows the user's own shell in a pty, started in the Session's
directory. It is deliberately their environment — their `PATH`, rc files,
aliases and git credentials — unlike the editor column, which runs Hulala's
bundled Neovim with isolated `XDG_*` homes.

| Key | Behaviour |
|---|---|
| `Ctrl-T` | open and focus the terminal; press it again to hide the column wherever the keyboard is (the shell keeps running) |
| `Ctrl-F` | switch the sidebar to Neovim; the shell keeps running in the background |
| `Ctrl-[` / `Ctrl-]` | move focus between the terminal and the composer without hiding it |
| `Shift-PgUp` / `Shift-PgDn` | page the terminal's own history (plain `PageUp`/`PageDown` where the terminal cannot report the modifier) |
| `/terminal` | same as `Ctrl-T` |

The column keeps 1000 lines of history, because a shell is read as much as it is
typed into: the outer terminal's scrollback is unavailable in the alternate
screen. Any other key returns to the live screen first and then reaches the
shell. A full-screen program (`less`, `top`, `fzf`) owns the alternate screen,
so it keeps `Esc` and its paging keys to itself; on the normal screen `Ctrl-[`
returns to the composer. Hiding the terminal with `Ctrl-T` or `Ctrl-D` leaves
the shell and its jobs alive, and `Ctrl-]` reopens the last column while it is
still running. The key is a visibility toggle for its own column: it hides the
terminal even when the composer has the keyboard, and `Ctrl-]` is what moves
focus back into it without hiding anything.

## The editor column beside the transcript

`Ctrl-F` shows Neovim in the same sidebar; `Ctrl-T` is the other content:

| Key | Behaviour |
|---|---|
| `Ctrl-F` | open the editor column and focus it; press it again to close it wherever the keyboard is |
| `Ctrl-T` | switch the sidebar back to the built-in terminal |
| `Ctrl-[` / `Ctrl-]` | move focus between the column and the composer without closing it |
| `Ctrl+S` | save the current file (works in insert and visual mode too) |
| `/editor` | same as `Ctrl-F` |

Closing asks Neovim to leave first: it exits when everything can be written, and
when a buffer cannot be written the client asks — `[s] 保存全部` / `[d] 放弃改动`
/ `[Esc] 取消` — instead of killing the process. As with `Ctrl-T`, the key
closes the column wherever the keyboard is; `Ctrl-]` moves focus into it without
closing anything. Files are saved automatically a
second after you stop typing, and immediately when the buffer is left or the
client quits, so the disk the agent reads stays current. `Ctrl-W` is still
Neovim's window prefix; `Ctrl-T` and `Ctrl-F` belong to the two column keys, so
Neovim's `<C-t>` and `<C-f>` are the one pair the sidebar takes. `:q` inside
Neovim closes the column on its own.

The focused cell is drawn as a filled block; the composer keeps its cursor on
screen as a ghost of itself while a column has the keyboard (the cursor colour
blended 80% into the background; a hollow glyph when colour is off).

### Your own Neovim plugins

Every directory under `~/.hulala/config/editor/plugins/` joins the editor's
`runtimepath`, so adding a plugin is dropping its folder there — no config edit,
no plugin manager, and the client never rewrites that directory. Bundled plugins
(`snacks.nvim`, the file tree and pickers) are published beside the editor under
`~/.hulala/runtime/editor/nvim-plugins/`; a plugin you add with the same name wins.

Two plugins ship inside the archive: `snacks.nvim` (file tree, pickers) and
`reader.nvim` (the EPUB reader, `:Reader book.epub`). Nothing is downloaded at
runtime — the release carries them, and an upgrade republishes the whole plugin
directory. Reading EPUB shells out to the `unzip` command; the installer tries to
add it and prints the package command when it cannot.

`Ctrl-[` is the same byte as `Esc`, so the keyboard does not simply take it: the
column keeps the key while Neovim has something to cancel. Neovim reports its
mode (`HULALA_NVIM_MODE_FILE`, written by a `ModeChanged` autocommand) and keeps
`Ctrl-[` in insert, visual, command-line and operator-pending mode. In normal
mode, when there is nothing to cancel, `Ctrl-[` moves focus back to the
composer.

## The bundled editor

`Ctrl-F` (or `/editor`) opens the Neovim column described above and moves focus
into it; `Ctrl-[` leaves it to the conversation without closing it, and `Ctrl-F`
again closes it after asking about unwritten buffers. The editor ships with the
client — the archive's `bin/nvim`, its runtime
tree and the vendored `snacks.nvim` file tree — so nothing depends on a Neovim
installation or the user's own config:

| Path | Contents |
|---|---|
| `$HULALA_HOME/bin/hulala` | the `hulala` command itself; a small script that starts the active version |
| `$HULALA_HOME/bin/nvim` | the bundled binary, a real file published from the package |
| `$HULALA_HOME/bin/ime` | macOS input-source helper (macOS only) |
| `$HULALA_HOME/runtime/editor/nvim/` | `$VIMRUNTIME` tree and tree-sitter parsers |
| `$HULALA_HOME/runtime/editor/nvim-plugins/snacks.nvim/` | vendored plugin |
| `$HULALA_HOME/config/editor/nvim/init.lua` | Hulala's config, written once and then left alone |
| `$HULALA_HOME/cache/editor/` | `XDG_DATA_HOME`/`XDG_STATE_HOME`: undo, shada, plugin state |

Publication happens on the first open after an upgrade, keyed to the package
digest, so rollback and pruning of old versions never break the editor. A
package without a bundled Neovim falls back to `nvim` on `PATH`, which is what
keeps `bun run dev` working. On macOS the client switches the input source to
`com.apple.keylayout.ABC` while the editor column has focus and restores the
previous source when focus returns to the composer or moves to the terminal.

The package requires Node.js 22.13+ on the target machine. The installer
offers the extracted package to its own `hulala install`, which validates
`bin/hulala --version` and manages immutable versions; it never stops a running
Host. Use `hulala host stop` explicitly before starting a new Host version.
`install.sh` also copies the package's binaries into `$HULALA_HOME/bin`, and
`hulala install` writes `$HULALA_HOME/bin/hulala` as the command: a script that
names its own installation root, reads `active.json` and starts the active
version. Nothing outside `$HULALA_HOME` describes where the program lives, so
`hulala update` and `hulala rollback` switch what it starts by rewriting that one
file, and deleting `$HULALA_HOME` removes everything Hulala installed. Versions
are additive: an upgrade adds a version directory and never rewrites or deletes
configuration, credentials or Workspaces.

`$HULALA_HOME/bin` holds Hulala's own executables — the command, the bundled
`nvim`, the macOS helpers — and is never added to `PATH`, so the bundled editor
cannot shadow the user's own. The command is published the way a Python console
script is: a single symlink to `$HULALA_HOME/bin/hulala` in a directory the user
already has on `PATH` (a `~/.local/bin`-style directory, or a Homebrew `bin`),
so installing does not edit a shell profile. `--bin <directory>` chooses that
directory explicitly and `--add-to-path` writes a marked block into the profile
an interactive terminal reads, for the case where no such directory exists;
`hulala uninstall` removes the link and that block again.
