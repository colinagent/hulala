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
`/permission`, `/thinking`, `/reasoning`, `/cancel`, `/status`, `/editor`,
`/terminal`, `/language` and `/quit`.
`Shift-Tab` cycles the thinking level in place, and the footer names the level in
effect next to the model; a choice made there (or in `/model`) is also the default
DeepSeek Harness saves for new Sessions. `/permission` lists the presets the Host
offers: `Enter` switches this Session, `Ctrl-S` also stores the choice as the
default for new Sessions, and the list ticks the current preset and badges the
default. The footer names the current preset next to the level.

The list above is the client's own commands. The Host's command catalog sits
alongside it: every command the Session's agent registers appears in the `/`
menu and the palette, is dispatched to the Host with its arguments, and reports
back as a step row in the conversation. `/compact` is one of them — it condenses
older history on demand, and its row says how many history items and roughly how
many tokens it shadowed, with the summary one fold away. The Chinese spellings
the Harness accepts work too: `/压缩` reaches `/compact`. A word the client
already owns (`/permission`) runs the client's version.

The interface language is English or Chinese. A first launch with no saved
choice asks once; `/language` (or `/language en` / `/language zh-CN`) changes it
at any time and remembers the answer. `HULALA_LANG=en|zh-CN` overrides the saved
choice for one run without writing it. The language applies to the client's own
copy only: Session titles, prompts, assistant output and tool results stay in
the language they arrived in.

The frame has three columns: the Session rail on the left, the conversation in
the middle, and one sidebar column on the right — the built-in terminal on
`Ctrl-T`, Neovim on `Ctrl-D`. The two sidebar columns keep separate processes
and only one is painted at a time. Each column key opens its column and takes
the keyboard, and closes it again when that column is already painted, wherever
the keyboard is. `Cmd-E` is the exception: it puts the rail and the conversation
away and leaves Neovim alone — "just the editor" — and the next press restores
the layout from before. `Ctrl-[` / `Ctrl-]` move focus between the rail, the
conversation and the sidebar without closing anything. `Shift-Cmd-S` and
`Shift-Cmd-C` show or put away the rail and the conversation. The conversation
only hides while the rail or a sidebar column is on screen, so the frame never
loses its last column; hiding it gives the sidebar the space the conversation
had. `Ctrl-Q` exits, in the slot pi gives `Ctrl-D`, and still asks a dirty
Neovim before leaving.

The terminal window title names the product, the directory the open Session works
in and, once the Host has named the Session, that title —
`Hulala - hulala-dev - fix the rail fold` — so a tab stays identifiable among shells
and other windows. A remote workspace shows the path the Host reports, so the
tab names the directory the turn is actually running in.

The Command chords need a terminal that speaks the Kitty keyboard protocol
(Ghostty, kitty, WezTerm, iTerm2; Terminal.app does not), so each one has a
slash-command equal: `/nvim`, `/rail`, `/chat` and `/commands`. Nothing takes
`Ctrl-F` any more: it stays forward-char in the composer and a shell, and
page-down in Neovim.

## Completing commands

A `/` at the start of the composer opens the command menu above the input box.
The menu shows up to five rows at a time and slides with the selection, so every
match stays reachable; while more matches remain it ends with a `(n/total)`
counter.
`Up`/`Down` (or `Ctrl-P`/`Ctrl-N`) move one row and wrap at both ends,
`PageUp`/`PageDown` move a whole window, the wheel moves one row per notch, and
`Tab` accepts the highlighted command. `Enter` on a slash command accepts it and
submits, so `/quit` + `Enter` still leaves in one gesture. While the menu is up,
`PageUp`/`PageDown` page the menu instead of the conversation; `Esc` closes the
menu and leaves the draft alone.

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
picker (`/sessions`) instead. `Shift-Cmd-S` shows or puts away the rail, and a
hidden rail comes back with the keyboard on the list; it stays the fallback for
terminals or input methods that swallow `Esc`, and `/rail` is the same toggle
where a Command chord cannot arrive. It only ever shows or hides — moving the
keyboard between the rail, the conversation and a column is `Ctrl-[` / `Ctrl-]`.

## Reading the conversation

A step row is not a title with everything hidden. Each row shows a preview of
what it did, folded to a line budget that a short body never reaches:

- a command row prints the command it ran under the title
  (`❯ bun test tests`) and keeps the **start** of its output — six body rows in
  total, with a count of the rest. A command with no description already reads as
  the title, so it is not printed twice;
- a search or generic row keeps the **start** of its result (six lines, with a
  count of the rest) — the first line says what the output is;
- a `read` row keeps its header, now carrying the window it asked for
  (`a.ts (10-14)`), and shows the file when opened;
- a `write`, `edit` or `apply_patch` row draws the **change itself**: one path
  header per file, `-`/`+` lines with three lines of context, `⋯` between hunks,
  and a `+N -M` count in the title. Nine rows are shown; the file's own hunks
  come from the tool result, so what you see is what landed on disk;
- a thought shows `✳ Think` and the **last** four lines it has reached, with a
  count of the rest. A short thought shows every line, and the block does not
  grow or move when the thought settles.

Clicking a row's `▸` opens one row; `Ctrl-O` opens every tool row and every
thought at once, and clicking again closes one. `/reasoning` cycles thoughts
between the folded tail, the full text, and hidden. A thought answers a click
anywhere on it; a tool row answers on its header line only, so the body text —
a diff, a file's contents — stays available for selection.

## Selecting and copying text

The client owns the mouse: clicking a step row's `▸` folds it, and a column
running a program is that program's terminal. So a drag across the conversation
is the client's own selection — the text is drawn in reverse video, and letting
go copies it (copy-on-select) — while the terminal's native selection needs its
bypass key, `Shift` on most terminals (`Option` in Terminal.app and iTerm2 by
default). A drag that starts on a step row's first line is a selection too; the
row only folds on a completed click.

Where the copy lands depends on where you sit. On your own machine the client
writes the system clipboard (`pbcopy` on macOS, `wl-copy` or `xclip`/`xsel` on
Linux). Over SSH or mosh the client writes `OSC 52` instead, which reaches the
clipboard of the machine your terminal runs on — never the remote box. A
terminal that refuses `OSC 52` will leave the paste empty, so allow clipboard
access there: iTerm2's *Applications in terminal may access clipboard*,
Ghostty/kitty/WezTerm by default, or `set -g set-clipboard on` in tmux. Set
`HULALA_CLIPBOARD=terminal` when a remote session hides the SSH markers (a
multiplexer attach, an IDE daemon). The client writes the sequence and cannot
verify it; when a local copy fails for real it says why instead of reporting a
false `Copied!`.

## The command palette

`Shift-Cmd-P` (or `/commands`) opens the palette: a searchable list of every
command, one row each, with what the command does and its shortcut on the right.
Enter runs the highlighted command without going back to the composer, and a
command that cannot run without an argument (`/rename`) instead brings the
composer forward pre-filled. The palette is a modal, not part of the composer, so
it opens from the rail, from Neovim, from the terminal column and from a frame
whose conversation is put away — which is the point: it is how a forgotten
shortcut (or a terminal that cannot deliver one) still gets the work done. The
composer's `/` menu prints the same rows with the same shortcuts.

## Custom keybindings

Every chord the client intercepts is an action in
`$HULALA_HOME/config/keybindings.json`:

```json
{
  "panel.editor": ["ctrl+f"],
  "panel.rail": ["ctrl+g"],
  "panel.commands": ["f1"]
}
```

A value is a list of key spellings — modifiers `ctrl`, `alt`, `shift`, `super`
plus a letter, or `escape`, `enter`, `tab`, `space`, `pageup`, `left`, `f1` and
so on. The label form the hints print is a spelling too (`Shift-Cmd-S`,
`Cmd-E`), which is what makes `/keys` copy-pasteable. An empty list disables the
action; an action the file does not mention keeps its default. The ids are the ones `/keys` prints next to their
descriptions, and `tui.editor.*` ids from pi-tui's own table are accepted in the
same file for the composer's editing gestures.

A bad key name, an unknown action, one key bound to two actions and a file that
disables every way out are reported in the client (`/keys` and a first-frame
notice) and the rejected line falls back to its default: a broken file never
leaves a window with no way to quit. `/keys` prints the bindings in force and
re-reads the file; the startup hints and `/help` print the effective keys, never
the defaults.

## The Session rail

The left column is the Session list, and it is on by default. It shows the
directory the open Session is in, a filter box, `+ 新会话`, the Sessions of that
directory and a folded `all` section for the Host's other directories:

```
┌ ~/note/projects/hulala ┐┌ the conversation ───────────┐┌ Neovim ─────┐
│ > search               ││                              ││             │
│ + new session          ││                              ││             │
│ ⠋ 修会话面板  3m      ││                              ││             │
│   侧栏焦点方案    1h  ││                              ││             │
│   调试 Host 连接   2d  ││                              ││             │
│ ▸ all                  ││                              ││             │
└────────────────────────┘└──────────────────────────────┘└─────────────┘
```

A running Session carries the same braille spinner the Web sidebar's ongoing
dot stands for, including turns started from another terminal window or aimed at another
Session; the title is the Host's `session-title` projection and the trailing
label is the Web client's relative-time bucket (`now`, `5m`, `3h`, `2d`, `4mo`,
`1y`). The open Session's title is painted in the brand colour — a text
highlight, never a marker glyph, a filled row or a background change; the row
under the keyboard uses the accent colour, never a filled background. Blank Sessions are hidden
unless they are the open one.

| Key | Behaviour |
|---|---|
| `Shift-Cmd-S` (or `/rail`) | show or put away the rail; a hidden rail comes back with the keyboard on the list |
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
runtime/editor/nvim-plugins/   vendored plugins (snacks.nvim, reader.nvim,
                               render-markdown.nvim)
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
| `Ctrl-D` | switch the sidebar to Neovim; the shell keeps running in the background |
| `Ctrl-[` / `Ctrl-]` | move focus between the terminal and the composer without hiding it |
| `Shift-PgUp` / `Shift-PgDn` | page the terminal's own history (plain `PageUp`/`PageDown` where the terminal cannot report the modifier) |
| `/terminal` | same as `Ctrl-T` |

The column keeps 1000 lines of history, because a shell is read as much as it is
typed into: the outer terminal's scrollback is unavailable in the alternate
screen. Any other key returns to the live screen first and then reaches the
shell. A full-screen program (`less`, `top`, `fzf`) owns the alternate screen,
so it keeps `Esc` and its paging keys to itself; on the normal screen `Ctrl-[`
returns to the composer. Hiding the terminal with `Ctrl-T` or `Shift-Cmd-C`
leaves the shell and its jobs alive, and `Ctrl-]` reopens the last column while
it is still running. The key is a visibility toggle for its own column: it hides the
terminal even when the composer has the keyboard, and `Ctrl-]` is what moves
focus back into it without hiding anything.

## The editor column beside the transcript

`Ctrl-D` shows Neovim in the same sidebar; `Ctrl-T` is the other content:

| Key | Behaviour |
|---|---|
| `Ctrl-D` | open the editor column and focus it; press it again to close it wherever the keyboard is |
| `Ctrl-T` | switch the sidebar back to the built-in terminal |
| `Cmd-E` (or `/nvim`) | leave only the editor column: the rail and the conversation go away; press again to restore the layout from before |
| `Ctrl-[` / `Ctrl-]` | move focus between the column and the composer without closing it |
| `Ctrl+S` | save the current file (works in insert and visual mode too) |
| `/editor` | same as `Ctrl-D` |

The file tree is a column of its own inside the editor: drag its boundary with
the mouse, or step it from the tree's own list with `g[` / `g]` or plain `←` /
`→`. The key names the direction the rule moves, so `g[` and `←` take it left
(the tree narrows) and `g]` / `→` take it right — the same reading as the column
divider chord. Those are unmodified keys on purpose: a bare bracket or arrow is
the only spelling every layer between the keyboard and Neovim forwards unchanged,
while a modified arrow is taken by the window manager (`Control-←` switches
spaces on macOS) or encoded differently by each terminal.

With Neovim alone (`Cmd-E`) every spelling of the column divider chord moves this
boundary as well — `Ctrl-Cmd-[` / `Ctrl-Cmd-]`, `Ctrl-Shift-[` / `Ctrl-Shift-]`
and `Ctrl-Shift-←` / `Ctrl-Shift-→`: one column means no frame boundary left to
move, so the chord goes to the one rule still on screen. Side by side, the same
chords keep resizing the editor column, and the tree's own keys above move the
tree.

That boundary is the one rule on screen the program draws rather than the frame,
so the client subscribes to it: Neovim reports the column it sits in, and the
pointer turns into a resize cursor over it and the rule takes the accent colour
the other dividers take on hover — and both are held for the whole gesture while
it is dragged, exactly as the frame's own dividers hold theirs, even though the
rule moves out from under the pointer. Dragging it is Neovim's own: the pointer
reports go to the program, which moves the boundary and remembers the width.

The chord is answered by the client and written into the editor's pty, never read
from the terminal, so nothing can take it first: `Control-←/→` belongs to macOS
for switching spaces, and what a terminal sends for `Option-←/→` differs per
setting — one of them arrives as a bare Escape, which closes the tree instead of
moving it. The width the tree is left at is remembered, and it never takes more
than the buffer needs: it stops at 40 columns on the narrow side. Neovim receives
the pointer in this column, so clicking, double-clicking a file and dragging out a
selection all work there as they do in a terminal.

Closing asks Neovim to leave first: it exits when everything can be written, and
when a buffer cannot be written the client asks — `[s] 保存全部` / `[d] 放弃改动`
/ `[Esc] 取消` — instead of killing the process. As with `Ctrl-T`, the key
closes the column wherever the keyboard is; `Ctrl-]` moves focus into it without
closing anything. Files are saved automatically a
second after you stop typing, and immediately when the buffer is left or the
client quits, so the disk the agent reads stays current. `Ctrl-W` is still
Neovim's window prefix; `Ctrl-T` and `Ctrl-D` belong to the two column keys, so
Neovim's `<C-t>` and `<C-d>` are the pair the sidebar takes — `Ctrl-F` is its
own again. `:q` inside Neovim closes the column on its own.

The focused cell is drawn as a filled block; the composer keeps its cursor on
screen as a ghost of itself while a column has the keyboard (the cursor colour
blended 80% into the background; a hollow glyph when colour is off).

### Your own Neovim plugins

Every directory under `~/.hulala/config/editor/plugins/` joins the editor's
`runtimepath`, so adding a plugin is dropping its folder there — no config edit,
no plugin manager, and the client never rewrites that directory. Bundled plugins
(`snacks.nvim`, the file tree and pickers) are published beside the editor under
`~/.hulala/runtime/editor/nvim-plugins/`; a plugin you add with the same name wins.

Three plugins ship inside the archive: `snacks.nvim` (file tree, pickers),
`reader.nvim` (the EPUB reader, `:Reader book.epub`) and `render-markdown.nvim`
(Markdown rendered in the buffer: headings, code panels, tables, checkboxes).
Nothing is downloaded at runtime — the release carries them, and an upgrade
republishes the whole plugin directory. Reading EPUB shells out to the `unzip`
command; the installer tries to add it and prints the package command when it
cannot.

Markdown is drawn in place, and the line under the cursor keeps its raw source so
editing is unaffected. Mermaid blocks get a diagram under their fence, drawn by
the same engine the conversation uses; `Space u m` toggles both. Anything the
renderer cannot draw — an unknown diagram type, a syntax error, art wider than the
column — stays source.

`Ctrl-[` is the same byte as `Esc`, so the keyboard does not simply take it: the
column keeps the key while Neovim has something to cancel. Neovim reports its
mode (`HULALA_NVIM_MODE_FILE`, written by a `ModeChanged` autocommand) and keeps
`Ctrl-[` in insert, visual, command-line and operator-pending mode. In normal
mode, when there is nothing to cancel, `Ctrl-[` moves focus back to the
composer.

## The bundled editor

`Ctrl-D` (or `/editor`) opens the Neovim column described above and moves focus
into it; `Ctrl-[` leaves it to the conversation without closing it, and `Ctrl-D`
again closes it after asking about unwritten buffers. The editor ships with the
client — the archive's `bin/nvim`, its runtime
tree and the vendored `snacks.nvim` file tree — so nothing depends on a Neovim
installation or the user's own config:

| Path | Contents |
|---|---|
| `$HULALA_HOME/bin/hulala` | the `hulala` command itself; a small script that starts the active version |
| `$HULALA_HOME/bin/nvim` | the bundled binary, a real file published from the package |
| `$HULALA_HOME/bin/ime` | macOS input-source helper (macOS only; built from the checkout when running from source) |
| `$HULALA_HOME/runtime/editor/nvim/` | `$VIMRUNTIME` tree and tree-sitter parsers |
| `$HULALA_HOME/runtime/editor/nvim-plugins/snacks.nvim/` | vendored plugin |
| `$HULALA_HOME/config/editor/nvim/init.lua` | Hulala's config, written once and then left alone |
| `$HULALA_HOME/cache/editor/` | `XDG_DATA_HOME`/`XDG_STATE_HOME`: undo, shada, plugin state |

Publication happens on the first open after an upgrade, keyed to the package
digest, so rollback and pruning of old versions never break the editor. A
package without a bundled Neovim falls back to `nvim` on `PATH`, which is what
keeps `bun run dev` working. On macOS the input source follows what the focused
surface does with the keys. A surface that reads them as commands switches to an
English layout while it owns the keyboard: the Session rail (its filter box
included), the editor column in normal mode, the shell column, the selectors and
the confirmations. A surface that reads them as text keeps the user's own source:
the composer, a question's free-text answer, and Neovim in insert mode, which the
client learns from `ModeChanged`. Coming back to a text surface gives the source
back, but only when the client moved it and it is still the one the client set: a
source the user picked by hand inside a panel always wins, and a user whose own
default is already English is never switched at all. A machine with no English
layout enabled gets one notice instead of a silently broken switch.
The switch runs through `$HULALA_HOME/bin/ime`. A release package ships it; a
source checkout has no package to publish it from, so the client entry (`hulala`,
and therefore `bun run start` and `bun run start:attach`) compiles
`apps/cli/native/ime.c` into `$HULALA_HOME/bin` once, and again only when the C
file changes. Without the helper nothing breaks: the panels simply keep whatever
source the user has selected. A window whose terminal streams were injected (a
test) leaves the input source alone, because changing it is machine-wide.

The package needs Node.js 24.9+ (DeepSeek Harness's own floor), which it does not
carry. `install.sh` takes the machine's own Node when it is new enough, and
otherwise offers to install one (Homebrew, `apt-get`, `apk`, or a SHA-256 verified
standalone archive in `$HULALA_HOME/runtime/node`) before it offers the extracted
package to its own `hulala install`. The archive also carries no dependency tree:
`hulala install` and `hulala update` run `npm ci` from the release's lock (through
the machine's proxy, retrying `registry.npmmirror.com`), apply the release's
patches, and rebuild only the allowlisted native packages. The route is recorded in
`runtime/node_modules/.hulala-runtime.json`; a machine without npm gets a clear
error rather than a dependency-tree download. That command validates `bin/hulala --version` and manages
immutable versions; it never stops a running Host. Use `hulala host stop`
explicitly before starting a new Host version. `install.sh` also copies the
package's binaries into `$HULALA_HOME/bin`, and `hulala install` writes
`$HULALA_HOME/bin/hulala` as the command: a POSIX shell script that picks the
Node runtime (the installer's `runtime/node` first, then `node` on `PATH`) and
starts `launcher.mjs` beside `active.json`, which reads the active version and
runs it. Nothing outside `$HULALA_HOME` describes where the program lives, so
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
