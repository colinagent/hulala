# Changelog

Every Hulala release is recorded here, and the GitHub Release notes for
`hulala-v<version>` are taken from the same section. One product, one version:
the terminal client and its embedded Host ship together.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
New entries go under `## [Unreleased]`, in one of `### Added`, `### Changed`,
`### Fixed`, `### Removed`, and they are written in English. A released section
is immutable. `bun run changelog:cut` turns the unreleased entries into the
section for the version in `package.json`; `bun run changelog:check` fails when
that version has no section. Releases before 0.2.30 are not recorded.

## [Unreleased]

## [0.3.13] - 2026-11-14

### Fixed

- A dropped editor socket ended the column, and the Neovim behind it — with the
  buffers the user was writing. The Host now keeps the editor for a 20 second
  grace window keyed by the column's identity, the client reconnects to it with
  that identity and rebuilds the grid from a fresh attach, and only a client that
  never comes back loses the process. The tree-boundary report is watched instead
  of polled five hundred times a minute.
- A bracketed paste split across reads pasted its own opening marker and typed
  the content as keys; the transport now holds an unfinished paste until its end
  marker arrives. `modifyOtherKeys` chords are decoded too, so a terminal that
  reports Shift-Space or Ctrl-I that way no longer types the sequence.
- Neovim's bell rings, and its `titlestring` shows on the window title while the
  editor column holds the keyboard — the client's own title comes back when it
  does not.
- `hulalaFiles` removed and renamed files with `node:fs`; those go through
  `ctx.fs` now, which is the only path that carries the workspace policy and the
  staleness guard. Directory operations keep `node:fs`, which the abstraction
  does not model.
- Pointer reports were decided by the column's kind (the editor always, a shell
  never) while a real terminal decides from the program's own modes. Both columns
  now ask their session: a shell that never enabled tracking receives nothing,
  and a `nvim` running in the terminal column receives clicks, drags and its wheel.
  The editor follows Neovim's `mouse_on`/`mouse_off`, so `:set mouse=` stops the
  forwarding it used to ignore.
- The editor drew a run of one character — a rule, a scrollbar, a status-line fill —
  as that character followed by blanks: `grid_line`'s `repeat` was applied to the
  cell's text, and our implementation wrote one glyph and then spaces. Nvim's own
  reference UI copies the text into every repetition.
- `grid_scroll` moved content the wrong way: `rows > 0` means "content moves up",
  and the copy read from `dest - rows` instead of `dest + rows`, so a scrolled row
  was refilled with the line that had just left. The test had been written to the
  same wrong direction, so both were green.
- A wide character's right half (an empty cell) was painted as a space, shifting
  the rest of that line one column right.
- Input now has one decoder (`tui/input/keys.ts`): text, named keys, Kitty CSI-u,
  mouse reports and pastes are decoded in one place, and a sequence it does not
  know is dropped instead of typed — including OSC/DCS replies from the terminal.
  A wheel notch over a column is one report per notch, as a terminal sends it.
- A paste into the terminal column was one Host command, and the Host refuses any
  command above 64 KiB: pasting a long script failed the attachment and lost the
  text. Input is now split into pieces the Host accepts, measured in UTF-8 bytes
  (a page of Chinese is three times its character count) and never inside a
  character.
- A diagnostic on Neovim's stderr closed the editor column. It is a message, not
  an ending: the column survives it, and the exit frame is what ends a session.
- Chords the terminal reports in the Kitty form — Command-C, Command-Left,
  Ctrl-Shift-Up, and Shift-Enter — were typed into the buffer as text
  (`<M-[>99;9u`) because the editor's key mapping only knew legacy bytes. They
  now become `<D-c>`, `<D-Left>`, `<C-S-Up>` and `<S-CR>`, and the numbered keys
  (F5–F12, Home, End) are named instead of typed.
- A remote command with no answer hung `/remote` on "checking…" forever. Probes
  now give up after 20s, control commands after 60s, and an install after 15
  minutes, and an install failure shows the installer's own last line.
- A wheel notch over a column went to the frame's own viewports, so a trackpad
  swipe over the terminal or the editor scrolled the conversation behind them.
  The column now answers it: a program that tracks the mouse gets the report
  (Neovim scrolls the buffer), a shell pages its own history, and neither one
  moves the transcript.
- A held escape is given back before the key that follows it, so two escapes —
  or an escape and a key — arriving together no longer lose the first one.
- A pointer report split by the terminal read — `ESC [ <` and its tail arriving
  separately, which is what a fast-moving mouse produces — was handed to the
  frame as text and typed into the composer. Both fragments are held until the
  report is whole; a lone Escape is still a key, not a held fragment.

## [0.3.12] - 2026-11-14

### Fixed

- A remote window asked the Host to mint its default Workspace, which an
  established Host refuses on purpose (it already has workspaces and Sessions).
  It now continues in the newest Session's directory — a path that Host has
  proved it can open.

## [0.3.11] - 2026-11-14

### Fixed

- A window on another machine created its first Session in this machine's
  directory, which cannot exist there: it now asks the Host for its own default
  Workspace. A Host that still cannot create one shows the reason and keeps the
  window open instead of closing it.
- The test suite wrote its fake Session id into the developer's own
  `config/client.json`, so a later launch tried to resume `session-1234`. Only a
  process that owns its terminal records a Session now.

## [0.3.10] - 2026-11-14

### Fixed

- Attaching to a machine whose Host is stopped refused with "runs an older
  Hulala": a stopped daemon reports no version, and that was read as an older
  release. It now starts the Host, asks again, and only attaches when the running
  release agrees with this client.
- `/remote`'s update left the old Host running. Installing replaces files, not
  the process, so the daemon still answered with the previous release — the
  window then failed to attach. The update now stops the remote Host, and the
  attach that follows starts the new one.

## [0.3.9] - 2026-11-13

### Fixed

- A fresh install opened Neovim without its vendored plugins — a netrw directory
  listing instead of the explorer, and no pickers — until the Host restarted.
  The editor's home is now resolved again after the publish step creates it.

## [0.3.8] - 2026-11-13

### Fixed

- The editor column's channel was refused whenever the event stream was
  connected: the route asked the transport for ownership of the one API socket
  the mux already holds, so it only worked in a window with nothing attached. It
  now passes the same trust fence and cookie check without claiming that seat.

## [0.3.7] - 2026-11-13

### Added

- MCP servers can belong to a directory. The Host loads `@colinagent/dsh-mcp`,
  which reads `~/.agents/mcp.json` and `<cwd>/.agents/mcp.json` and mounts one
  `dsh-mcp-client` per Agent, so a repository's MCP server is reachable only in
  Sessions working there and `/cwd` switches the set. It ships as a bundle the
  runtime depends on, so an upgrade moves it with the Host instead of leaving a
  copy in the profile.
- The editor column renders Neovim's UI protocol: the client attaches as a UI,
  draws the grid it is sent, and forwards keys as `nvim_input` notation (a paste
  becomes `nvim_paste`). Pointer reports become `nvim_input_mouse`, and the file
  tree's boundary arrives from the Host instead of a marker file the client
  reads. The editor and the terminal column now share one renderer, one palette
  and one focus model, and the mode arrives as a `mode_change` event.
- The Host serves `/api/editor`: one authenticated WebSocket per editor opens
  `nvim --embed` in the Session's directory and carries Neovim's own msgpack
  channel, so the column can render a grid and send key notation instead of
  owning a pty. The editor's home, generated settings, runtime and vendored
  plugins moved into `@hulala/editor-home`, which both the client that publishes
  a release and the Host that starts Neovim read.
- `Ctrl-V` attaches the image on the client's own clipboard to the message being
  written. The bytes travel inside the prompt frame as a base64 image part, so a
  Host reached over SSH receives the screenshot without an upload and without a
  second channel; the media type is sniffed from the bytes, the limit is 10 MB,
  and every refusal (no image, too large, unknown format, no reader) is reported
  instead of swallowed.

### Changed

- A source checkout can switch machines too: a restart re-runs the entry the
  client is already running (`bun run start` runs the built bundle through it)
  instead of refusing because nothing is installed.
- A window remembers the Session it last showed per machine
  (`lastSessionByHost` in `config/client.json`), so switching Host and coming back
  resumes that machine's Session instead of whichever was open last. A remembered
  Session that no longer exists says so after the transcript opens and starts
  another.
- `/remote` picks the machine this window attaches to, from the aliases already in
  `~/.ssh/config`, and the sidebar's first row names the current one (`devbox ⌄`,
  or `host · local`). Picking another machine checks it first and offers an install
  or an update when it needs one; `/remote local` comes back to this machine.
  Selection is the highlight ink on the label, never a filled row.
- `hulala --remote <ssh>` attaches this window to a Host on another machine
  through the user's own ssh: the probe asks a login shell, the endpoint record is
  read the same way, one loopback forward carries the connection, and the origin
  is rewritten so everything above it speaks to `127.0.0.1`. A window attached
  this way reconnects to the same machine after `/restart` instead of coming back
  local, and a dropped remote connection offers that reconnect rather than
  probing (or starting) this machine's daemon.
- The installer takes `--yes`, the one consent a client can give ahead of time: it
  answers the Node download question for a run that has no tty, and nothing else
  becomes automatic.
- The editor column ships Neovim 0.12.6 instead of 0.11.4. The publish step
  compares the packaged binary with the one in the state root, so an existing
  installation picks it up the next time the editor opens.
- The terminal column renders a Session-owned terminal on the Host instead of a
  shell this process spawned. The shell, its working directory, its size and its
  scrollback now belong to the Host, so the column is the same code path when the
  Host is reached over SSH. `@deepseek-ai/dsh-api-terminal-controller` and
  `@deepseek-ai/dsh-api-workspace-files` joined the Host composition, and the
  client mounts both Remotes; a Host that refuses the terminal shows why instead
  of an empty column.

## [0.3.6] - 2026-11-13

### Fixed

- The Host composition row for `@deepseek-ai/dsh-deliverable-file-references` was
  only written into freshly created profiles: `HOST_ROW_IDS` did not name it, so
  a profile made by an earlier version never received the row. Existing profiles
  pick it up on the next start.

## [0.3.5] - 2026-11-12

### Fixed

- A chat reply that references an image as `![Description](<path>)` can now be
  turned into a real attachment, because the Host mounts
  `@deepseek-ai/dsh-deliverable-file-references` — the same model guidance DSH's
  own Web and SDK compositions mount. Without it the model was never told how to
  reference a file it produced.

## [0.3.4] - 2026-11-12

### Changed

- A command row prints the command it ran under the title, so a folded call says
  what produced its output; a running call shows the command alone. The preview
  keeps the **start** of the output, like every other text row, instead of its
  end: `ls`, `cat` and a test header all read from their first line, and a
  preview that starts in the middle makes the reader guess what they are looking
  at. Only a thought keeps its end.
- A thought now keeps its last **five** lines instead of four: four cut most
  thoughts off mid-sentence before the part worth reading.

## [0.3.3] - 2026-11-12

### Changed

- Step rows now show a preview of what they did instead of a title alone, and a
  body shorter than its budget is shown whole. A command row keeps the end of its
  output, a search row the start, a `read` row its window. `Ctrl-O` opens every
  tool row and every thought, and `/reasoning` cycles a thought between its
  folded tail, the full text and hidden.
- A `write`, `edit` or `apply_patch` row draws the change itself: one path header
  per file, `-`/`+` lines with three lines of context, `⋯` between hunks, and a
  `+N -M` count in the title. The hunks are the tool result's own `diffs`, so the
  row shows what landed on disk.
- A thought now shows its label and the last four lines it has reached, with a
  count of the rest, instead of a single-line summary. The window is the same
  while it streams and after it settles, so a turn's geometry stops growing.

### Fixed

- Dragging text in the conversation now selects and copies it from a step row's
  header line too: the header no longer takes the press, so the transcript's own
  selection keeps working and a press and release on the same cell still folds
  the row.
- Selected text now reaches the clipboard the user pastes from. Over SSH or mosh
  the client writes OSC 52 to the terminal, so the selection lands on the
  machine the user is sitting at; on the user's own machine it uses the native
  clipboard or the platform's writer (`pbcopy`, `wl-copy`, `xclip`, `xsel`). A
  copy that cannot land now says why instead of reporting a false "Copied!".
- A mouse report split by a slow read is put back together instead of being
  dropped, so a click or drag over a laggy SSH link no longer disappears.

## [0.3.2] - 2026-11-12

### Added

- `hulala install bot` installs the first-party chat bot
  (`@colinagent/hulala-bot`, Telegram and Lark) into the `tui` profile. It is a
  shortcut for `hulala plugin --profile tui add @colinagent/hulala-bot`; the bot
  is still a plugin and is not part of the release archive.

## [0.3.1] - 2026-11-12

### Added

- `hulala plugin --profile <name> add <package>` installs a DeepSeek Harness
  plugin into the Host's profile, with the same arguments `dsh plugin` forwards
  to pnpm. Plugins the user installed into their own DSH install under the same
  profile name are detected at boot and loaded too, so one plugin set serves both
  programs; the DSH home is only read, never written.
- A plugin installed into a profile now resolves its own dependencies from that
  profile, while the Harness packages still come from the runtime.

### Changed

- The Harness home moved from `<state root>/config/harness` to
  `<state root>/harness`. Sessions, the credential document, profiles and
  storages live there, none of which belong under `config/`; `config/` is back to
  settings only.
- `hulala plugin` now speaks DSH's plugin vocabulary: profiles, bundles and
  `engines.dsh`. The command is `dsh plugin` with this binary's name, including
  the required `--profile`.

### Removed

- The terminal client's own plugin command and directory
  (`hulala plugin new|check|list|disable`, `~/.hulala/config/plugins`). The
  client's panels are still assembled from modules internally, but that kernel is
  not a user extension point: there is one plugin system, and it is DSH's.

### Fixed

- `hulala plugin` chose the runtime by sorting version directory names, so an
  install with two versions could manage the wrong one; it now reads the active
  version the installer recorded.
- A concurrent boot and install could overwrite each other's edit to the profile
  manifest, losing a plugin from the bundle list.

## [0.3.0] - 2026-11-11

### Added

- Code blocks in the conversation are highlighted for the languages their fences
  name, fold into the column instead of being cut silently at its edge, and are
  drawn as a frame with the language on its top edge. A block with no language
  keeps the muted code ink, and a `read` or `write` row highlights the file it
  names the same way.
- Math in the conversation, and in a reasoning block the reader expands, renders
  as Unicode; an expression the renderer cannot draw keeps its source.

### Changed

- Every heading level in the editor column has its own colour and its own band:
  level 1 is the palette's red warmed towards its yellow, then yellow, green,
  cyan, blue and magenta, with the band behind the words only as wide as the
  text. The inks are the terminal's own palette colours, undimmed.
- A heading in the transcript is inked yellow and inline code violet, the inks
  pi's theme gives `mdHeading` and `mdCode`; pi-tui keeps a heading bold on its
  own.

### Fixed

- A rendered table in the editor column keeps its shape while the cursor moves
  through it, instead of flashing back to its pipes on the row under the cursor.

## [0.2.31] - 2026-11-10

### Added

- Markdown is rendered in the editor column: headings, code panels, tables,
  checkboxes and quotes, while the line under the cursor keeps its raw source.
  `Space u m` toggles it.
- Mermaid blocks draw their diagram under the fence in the editor column, by the
  same engine the transcript uses.
- Mermaid code blocks in the transcript render as Unicode diagrams; one that
  cannot be drawn keeps its source and names the reason.
- `/changelog` prints this build's changes, and a state root announces them once
  per release after its first Session opens.
- Host commands sit in the `/` menu and the palette beside the client's own, and
  run against the Session's composition.
- A command the Host runs is a step row in the transcript, with a compaction's
  summary folded away until the reader asks for it.

## [0.2.30] - 2026-11-10

### Added

- The terminal client and its embedded Host ship as one archive per platform:
  `bin/hulala`, the Host under `runtime/`, the bundled Neovim and ripgrep, and
  the npm lock `hulala install` resolves the dependencies from.
- Three columns in one window: the Session rail, the conversation, and one
  sidebar that switches between the built-in terminal and Neovim, with `Cmd-E`
  for Neovim alone.
- Neovim opens on the Session directory and is the file tree: the bundled
  explorer replaces netrw, and buffers survive while the column is hidden.
- One Host daemon per state root. Windows attach through `endpoint.json`,
  `Ctrl-Q` detaches, and only `hulala host stop` ends it.
- The Harness surfaces are used directly — streaming output, approvals,
  questions, model selection, cancellation, `/connect` and `/api/remote.mux` —
  on the DSH Agent Loop, with no second Runtime and no second REST layer.
- A client plugin is one `.mjs` file (`hulala plugin new|check|list|disable`),
  and Creator mode lets the agent inspect the client's own Cordis surface.
- Every bundled binary is a real file in `$HULALA_HOME/bin`, appended to a child
  process's `PATH` so an installed tool always wins.
