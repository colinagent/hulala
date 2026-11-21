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

## [0.3.32] - 2026-11-21

### Changed

- The approval card's choices include the Session-wide grant in its footer:
  `[f] whole Session` / `[f] 本会话完全权限`. It was already a key (`f`), but
  only a dim body line named it, so the one option that stops every later turn
  from asking was easy to miss. Choosing it still switches the Session to Full
  access through the Host's own `/permission` write path.
- An archived prompt is drawn on the editor's level-1 heading band instead of the
  level-2 tint, so the prompt in the transcript and the `#` heading in the editor
  column are the same colour on every terminal: the page moved 12% of the way
  towards the palette's red warmed halfway to its yellow. A terminal that reports
  no page now gets that same derivation on the editor's fallback theme, instead
  of a separate fixed chip.

### Fixed

- An approval answer is no longer lost when the transport drops between the
  choice and its delivery. DSH keeps the pending waterfall and replays it on the
  next generation; the client now remembers the tool call's decision and answers
  that replay with the same choice instead of asking again, and says so in the
  transcript. A card whose delivery dies also says it will return, rather than
  vanishing and leaving the turn apparently stuck.

## [0.3.31] - 2026-11-21

### Added

- A release blog on the website: `/blog/` and `/zh-CN/blog/` carry one post per
  release in both languages, linked from the header, the footer and
  `/sitemap.xml`, with the first post for this version.

### Changed

- The website's language switch is one link instead of two. It names the language
  you would arrive at, remembers the choice, and the root follows the browser's
  language on a first visit; a URL that already names its language, or a shared
  deep link, is always served as addressed.
- An archived prompt is drawn on the terminal's own palette instead of a fixed
  chip. Its band is now the editor's level-2 heading tint — the reported page
  moved a tenth of the way towards the palette's yellow — with the page's text
  ink and an arrow faded back into the band, so a prompt in the conversation and
  a `##` heading in the editor column are one palette, and a light or unusual
  terminal theme no longer gets a dark slab in the middle of its transcript. A
  terminal that reports no page keeps the fixed chip.
- The terminal tab says where the Session works and, on a remote Host, which
  machine: `pi - Hulala:Fix the composer` locally and
  `root@dev:pi - Hulala:Fix the composer` when attached to `dev`. The machine
  prefixes the directory the way scp writes a remote path, and the Session's
  name now hangs off the product name instead of restarting the title with a
  third ` - ` segment — so a truncated tab keeps the machine and the directory,
  and a local tab no longer has to carry this machine's own account and
  hostname. A remote window names the ssh alias it attached through and the
  account that alias resolves to (read from `ssh -G`, without opening a
  connection); a Host that resolves no account leaves `dev:pi` rather than
  `@dev:pi`.

### Removed

- The Session rail's host row. The machine a window is attached to is named in
  the terminal tab instead, which gives the rail back the row the fixed header
  held for it; `/remote` and `hulala remote <ssh>` are still how a window
  switches machines.

## [0.3.30] - 2026-11-20

### Added

- A timed `ask_user_question` is answered on the terminal's own clock. The call
  arrives with a foreground wait keyed by its tool call, and DSH suspends its own
  timer while a client holds the claim, so the card claims it, reads the
  Host-computed window, counts it down in the footer and rejects with
  `ASK_TIMED_OUT` when it ends — which is what turns the call into a question the
  Session still lists instead of a tool call that hangs. Releasing the claim at
  the deadline hands the wait back, so a card nobody is looking at cannot stop the
  Host from timing out either.
- A timed call whose window closed stays answerable. The Session's `userQuestions`
  projection is mirrored into cards marked in the rail, the picker and the
  footer; answering one goes through `userQuestions.answer` and arrives in the
  agent as a new turn, so an answer given an hour later still reaches the model
  that asked.
- `Alt-G` puts away the question the open Session is waiting on and brings it
  back, and the footer/rail/status bar count what is waiting in other Sessions.
  A parked timed card keeps its claim and its deadline, so putting it away is not
  the same as letting the window close.

### Changed

- The Host boots through DeepSeek Harness's own profile boot instead of a copy of
  it kept in this repository. Every launch step DSH owns is now the upstream one:
  the layered launch environment (`process.env`, the invoking directory's `.env`,
  `$DSH_HOME/.env`), the `engines.dsh` bundle gate with its skip report,
  plugin-package interception, fail-loud, bounded shutdown, and the readiness
  commit. DSH's profile boot patches Node's own module loaders through a native
  addon, so the Host process is Node everywhere, including `bun run host` and the
  Boot tests.
- The Host profile is DSH's own `web` template — `@deepseek-ai/dsh-base` plus
  `@deepseek-ai/dsh-web-app` — and this repository's profile patch holds four
  id-level overrides and no re-declared row. Rows that were hand-copied here are
  gone (the Web carrier keeps its own compression and trusted-host settings, the
  upload row keeps DSH's id, agent presets come from the bundle), upstream rows
  this Host used to leave out now mount (`job-controller`, `workspace-changes`,
  the Remote event source, the browser UI behind the launch token), and the
  agent preset list is DSH's own: `standard`, `ptc`, `minimal`, `cordis`.
- The Host carrier's bind address is the Web invocation flag DSH already parses,
  so `--host`/`--port` reach `web-startup` instead of a row of ours.
- DeepSeek Harness moves from `0.2.2-rc.1` to `0.2.2-rc.5` in every manifest and
  the lockfile. Two upstream changes are absorbed rather than patched around: the
  subagent test now reads `agent.session.header.origin`, because `agents.roots()`
  is gone, and a terminal/editor description carries `origin` and `control` as
  required fields. The `dsh-subprocess-local` patch is regenerated against rc.5 —
  Bun's runner delimiter moved into a different build chunk, and a patch keyed on
  the old version is ignored in silence. The bundled `@colinagent/dsh-mcp` plugin
  moves to `0.1.1` so its own peer and `engines.dsh` ranges name rc.5 too.
- Approvals and questions are pending interactions owned by the Session that
  raised them, not dialogs that take the keyboard when they arrive. Both share
  one queue per Session with a per-kind precedence (approval 0, question 1,
  plan-review 2), one interaction on screen at a time, and a hand-off
  (`Alt-D`, `d` on the approval card) that passes the request to the next
  answerer on DSH's waterfall and leaves a notice in the transcript. A request
  from a Session this window never opened is handed on immediately instead of
  being answered here, which is what stopped a turn started in another window —
  or over SSH — from asking its permission question inside this one.
- A Computer-Use agent's approval arrives as a question with an `approval`
  intent, and is drawn as one: the subject on its own line, the caller's own
  localized question as the heading, the detail dimmed, and the three actions the
  caller named marked `✓`, `✕` and `∞`, with no free-text row. It outranks the
  classic approval seam because DSH gives it precedence 1, and the answer is the
  same option list either way.

### Fixed

- Host requests that leave the machine honour `http_proxy`, `https_proxy`,
  `all_proxy` and `no_proxy` again, including values supplied by
  `$DSH_HOME/.env`. DSH's boot installs its outbound proxy policy as the
  process-wide dispatcher before the first plugin mounts; the boot this
  repository carried never did, so web fetch, providers and MCP over HTTP all
  connected directly while `curl` on the same machine went through the proxy.

- The footer's speed reading is the Host's own decode figure again. The client
  timed its deltas from the first *text* chunk, while DSH counts a step's output
  tokens from its first chunk of any kind and stops at the assembled message — so
  a reasoning-only step (most tool steps) contributed tokens with no time, and a
  session that actually decodes at 177 tok/s showed 3808. The Host now composes
  DSH's `session-stats` projection and the footer renders `sessionStats.decodeTokens
  ÷ decodeMs`, the same number as DSH's own stats table. Context occupancy and
  the session token total come from the `contextPressure` and `tokenUsage`
  projections for the same reason: one fold owns each figure, in the Host.
- The file tree's own prompt — `a` for a new file or directory, `c` for
  "Copy to" — is a floating window beside the picker rather than part of its
  layout, so closing the tree with `Space`+`e` left the box on screen while it
  still held the keyboard, and the next keys were typed into it. The prompt now
  belongs to the tree: closing the tree closes it, whichever key or click did.
- A late-answer card now closes when another client answers the call, and a reply
  already queued in the Host inbox no longer reopens it. The `userQuestions` and
  `inbox` projections are reconciled together, and the foreground wait and the
  durable card share DSH's `question:<session>:<call>` identity, so one tool call
  never produces two cards — or a card whose overlay outlives its row and blocks
  every later interaction.
- Plain (non-TTY) mode no longer submits an empty answer to a question. It asks
  again for a choice or a line of text, and rejects with `ASK_CANCELLED` when the
  input ends instead of answering with an empty selection.

## [0.3.29] - 2026-11-18

### Changed

- A Bash row prints its command after `$`, the way a terminal does, instead of
  after the composer's `❯`. The turn arrow stays the one marker a reader can type
  into; a command under a tool card is output, not a prompt.
- The tool card is now tinted by the call's own state, the way pi's tool boxes
  are, and placed against the terminal instead of on a fixed slab. The client
  already asks the terminal for its default colours (OSC 10/11) to paint the
  editor column; the cards are placed from the same answer in OKHSL — the
  perceptual space the palette is written in — as one step of lightness above the
  page, in the tone's own hue: green once a call lands, red if it failed, sand
  while it runs or after it was stopped. The tint is a tenth of pi's saturation
  and the step is smaller, so a column of steps is one quiet surface with a cast
  rather than a traffic light. Body and accent inks are measured against the
  resulting surface, and a terminal that reports no page — or a light one — gets
  surfaces derived the same way from the frame's footer slate, so no card is a
  hand-picked literal.
- A step row's title now sits on the page instead of inside the card: the icon,
  the name, the description and the duration are a line of their own, and the
  surface below holds only the body. A title printed on the surface made every
  row start with a slab, and a call with nothing to show became an empty one; a
  call with no body to draw is now its title alone. The title also keeps the
  terminal's own text ink instead of the body's muted one — it is read at a
  glance while scrolling — and only a failure, a stop or a live turn recolours
  it.
- The archived user prompt is a padded panel instead of a one-row chip: a blank
  row of the panel's own fill sits above and below the text, the way pi's user
  message is a `Markdown` with `paddingY: 1` on a background, and the tool card
  here already pads its surface. A single filled row read as a highlighted line
  squeezed between two page rows rather than as the operator's own turn.

### Fixed

- A tool card's surface no longer leaves a notch at its right edge: the body rows
  were filled one column short of the blank padding rows above and below them, so
  the page showed through in a step the eye caught. Every row of the block is now
  filled to the column's width, with the text still budgeted one cell narrower.
- A conversation no longer keeps fragments of an older frame in the corner of the
  window — the write queue could discard a frame (a stalled terminal, a refused
  descriptor, or frames composed for a window that changed size while they were
  queued) without telling the renderer, which then kept diffing every later frame
  against a screen the terminal never received. Every discard now reports its
  reason, and the renderer throws its copy of the screen away: the next frame is a
  clear plus every row. A frame composed for a grid the window no longer has is
  refused instead of applied, because its absolute rows can wrap and, on the last
  row, scroll the whole screen. `Ctrl-L` remains the manual repair.
- The status band stops one cell short of the terminal's right edge. It is the
  frame's bottom row, so a row that overflows it scrolls the screen; a terminal
  that counts an ambiguous-width `…` or `—` as two cells can now only cost that
  one padding cell.
- A multi-line Bash command no longer leaves the newest transcript text sitting
  in the composer's blank rows. A folded tool card truncated the whole command
  into one row, and `truncateToWidth` counts a newline as zero columns but keeps
  the byte: the terminal moved down into the rows below, while the differential
  renderer still believed those rows were unchanged and never repainted them.
  The card now shows the command's first source line with a continuation mark,
  and every frame has bare control characters removed at the output queue while
  keeping CSI/OSC/DCS sequences intact. Under `HULALA_DEBUG_CLIENT=1` a removal
  is logged as `frame control row=N 0x..=count`, and every log line names its
  `pid`.

## [0.3.28] - 2026-11-18

### Changed

- `hulala` starts a new Session in the directory it was run from. A window no
  longer reopens the Session it showed last time, which is also why its working
  directory used to be that Session's Workspace instead of the shell's cwd.
  `--resume <id>`, `/resume` and `/sessions` still open an earlier Session, and a
  `/update` restart keeps the one on screen; switching Host with `/remote` starts
  a new Session on the destination instead of handing it an id that belongs to
  the machine the window came from.

## [0.3.27] - 2026-11-18

### Fixed

- A window that hands the terminal to a new client process survives the handoff in
  an installed release. `/restart`, a `/remote` switch, an update and remote
  recovery all re-run the launcher, and the installed entry in the state root is
  a POSIX shell script that picks the runtime Node — it was being started with
  the current interpreter, so the successor died on its second line with
  `SyntaxError: Invalid or unexpected token` and the window vanished instead of
  reopening. An installed release now executes its launcher; a source checkout
  still re-runs its own entry on its own interpreter.

## [0.3.26] - 2026-11-17

### Fixed

- A window on another machine re-attaches by itself after the Host there restarts.
  `hulala host restart`, an update and a reboot each make the Host bind a new
  loopback port, while the ssh forward under an open window keeps pointing at the
  old one — a port nobody serves, which the window used to wait out forever even
  though the machine answered on the very ssh it already had. Recovery now asks
  the machine where its Host listens (a read: `host status` starts and stops
  nothing) and becomes a new process when the port moved.
- Pasting into a window whose Host cannot be reached says so instead of printing
  `fetch failed`: the client waits up to five seconds for a forward that is being
  rebuilt, retries the store once, and then reports that the Host is unreachable
  and the paste was not saved. A refusal the Host did answer still carries its
  status and reason.

## [0.3.25] - 2026-11-17

### Changed

- A submitted line is a command only when its first word is in the client's
  command registry, or in the open Session's Host catalog. The shape heuristic is
  gone, so `/nope` — a typo, or any path that begins with a slash — goes to the
  model as a prompt instead of being answered with "unknown command". The
  registry in `apps/cli/src/tui/commandCatalog.ts` now owns the dispatcher too:
  its rows feed the `/` menu, the palette, `/help`, the hints, the completion and
  the whitelist, aliases are declared in the row, and the handler map in
  `plugins/commands.ts` is keyed by the registry's name union — adding a command
  without a handler does not compile.

### Fixed

- A pasted folder is refused instead of read, and a copied file is measured
  before its bytes are: the clipboard can name a directory, a fifo, or a 2 GB
  video, and reading it first put the client's memory (or its event loop, on a
  fifo) on the line to discover it could not be pasted. The refusal says which
  of the two it was, and the size is checked again after the read in case the
  file grew.

## [0.3.24] - 2026-11-17

### Fixed

- A pasted path is a prompt, not a command. `Ctrl-V` inserts an absolute path
  (`/tmp/hulala-pastes/…png` on a Linux Host), and because it starts with the
  slash a command starts with, submitting it answered `unknown command
  /tmp/hulala-pastes/…` instead of sending the image to the model. A line is a
  command only when the word after the slash is one bare word with no separator
  or extension; anything that looks like a path goes out as a prompt, in the
  terminal client and in plain mode alike.

## [0.3.23] - 2026-11-17

### Changed

- `Ctrl-V` pastes a **path**, the way pi does, instead of attaching an image to
  the prompt. A clipboard file (a Finder copy) keeps its own path when the Host
  is this machine; a screenshot, and anything that has to reach another machine,
  is written into the Host's own temp directory (`$TMPDIR/hulala-pastes/`) first
  and that path is inserted, so the model opens exactly the file that was pasted
  — also behind `hulala ssh`, where the client's own `/var/folders/…` path names
  nothing. A paste is ephemeral, so it never lands in the state root and the OS
  reclaims it; plain text is pasted as text. The Host writes it on
  `POST /api/paste`, behind the same connection cookie as every other request,
  owner-only and bounded; the prompt frame no longer carries inline images.

## [0.3.22] - 2026-11-17

### Changed

- The debug trace dates a stall instead of describing one. `HULALA_DEBUG_CLIENT`
  now records a tty write that takes longer than a frame (`write 3435ms 30B`),
  how late the event loop fired (`lag`), and how long input stopped (`gap`), so a
  machine that slept, a terminal that stopped reading and a reconnect can be
  told apart from the log alone. A damaged mouse report is recorded as
  `damaged`, the one line that says the byte stream itself was truncated.

### Fixed

- Image paste works in an installed release. `Ctrl-V` reads the clipboard
  through the TUI library's native helper, and that helper is a separate N-API
  module the bundle cannot inline; the release never shipped it, so on macOS —
  where an image has no command-line reader to fall back to — every paste
  answered "this platform has no clipboard image reader", remote or local. The
  package now carries the prebuild at `native/<platform>/prebuilds/…`, the first
  place the library looks relative to its bundle, and packaging fails instead of
  quietly omitting it.
- A mouse report that lost its introducer is dropped instead of typed. A pty's
  input queue holds about a kilobyte, so a terminal that is not being read loses
  the front of whatever report it was writing; when the surviving bytes were
  `64;60;39M` none of them looked like a sequence, and they reached the composer
  and the shell as text — `60;39M65;60;39M…` across the screen after a wake. The
  parser now recognises the tail of a report inside a burst of reports and
  throws it away, and the input pipeline refuses one as a last resort. A whole
  report keeps working: that is pi-tui's pointer event, not a fragment.
- A terminal that stopped reading can no longer starve the input side. A tty
  write is synchronous, so a busy terminal blocked the event loop it shares with
  stdin — and a loop that is blocked reads nothing, which is how a pty ends up
  dropping the middle of a mouse report. Frames are queued and written from the
  thread pool now: a frame that no longer fits is dropped whole and the window
  repaints in full once the queue drains, the queue is flushed before a successor
  process takes the screen, and it is flushed again before the restore sequence
  becomes the last thing the terminal sees. Measured on a terminal that stopped
  draining its pty for four seconds, the client read every one of the 448 reports
  sent in that window; before, a single 30-byte write blocked the loop for 3.4 s
  and input stopped for the whole of it.
- A window that slept or lost its transport starts its input and its frame over.
  A half-received sequence that outlived its stream is dropped rather than
  drained — draining handed its bytes back as keys — and the next frame is a
  full repaint, because a differential one keeps every cell it believes is
  unchanged, which is exactly what a frame written over during a sleep leaves
  wrong. A reconnect is the trigger; a wall clock that jumped is the fallback,
  since macOS suspends the machine without stopping the process.

## [0.3.21] - 2026-11-16

### Fixed

- A window on another machine survives the ssh dropping under it. The forward
  is rebuilt on the port it already had, the launch token is exchanged for a
  fresh cookie, and the transport reconnects by itself — the Session, the open
  editor and the terminal column come back instead of the window retrying a
  dead loopback port until it is restarted by hand. Three separate faults made
  that fatal: the forward's ssh was never watched, a `/connect` cookie dies with
  the socket that owned its Peer so every retry after one drop answered 401, and
  the first reopen waited on a Host call that a stalled carrier never answers.
- A Host that was replaced while the client was away (an update, `hulala host
  restart`, a reboot) is re-attached automatically, at the moment the forwarded
  origin reports a different daemon, instead of leaving a window that can never
  attach again.
- Library log lines no longer land in the middle of the transcript. The
  transport's `[connection] connection lost, retry #N` was written to the same
  terminal the alternate screen was painting; while the client owns the screen,
  console output goes to the debug log instead.
- A dropped terminal or editor column re-attaches to the process the Host kept,
  replaying its screen, instead of freezing on the last frame it received. The
  editor column also survives a longer outage before it gives up.

## [0.3.20] - 2026-11-16

### Fixed

- The composer's caret is a steady block again at startup. The renderer is
  built with the terminal's own cursor enabled, and the client's first "no
  column owns the caret" answer was skipped as a no-op, so the hardware cursor
  stayed on: the input box showed the terminal's blinking caret instead of the
  client's static block, until a column took the caret and gave it back once.

### Changed

- A click moves the keyboard to the panel it lands in. The conversation, the
  Session rail and the open column are now three panels with one owner: clicking
  one focuses it, and the panels that do not hold the keyboard are drawn faint,
  so a split reads at a glance the way a terminal's own panes do. The gesture
  still does what the cell said — a step row folds, a drag across prose selects
  it, and a click inside a column still reaches its program when it tracks the
  pointer — and a modal or an open selector keeps the keyboard until it closes.

## [0.3.19] - 2026-11-16

### Added

- Scheduled tasks live in the Host. DSH's schedule service is now part of the
  Host composition, so a task keeps the Host's state root instead of a cron
  entry and survives client restarts. `/tasks` lists every Host task with its
  frequency, next run, and last delivery, and `/create-auto-task` fills the
  composer with the same requirements prompt DSH Web uses; Telegram runs the
  same pair against the same service, with the requirements inline. The agent
  still owns creation: it reads the clock and the client zone, then calls
  `schedule_create`, so neither client parses natural language.

- A tool approval can grant the whole thread Full access. The approval dialog
  now offers `f` next to allow-once and reject: it answers the pending request
  once and switches that Session to the `danger-full-access` preset, so later
  turns stop hitting file-write limits and stop asking for permission. It writes
  the Host's own `/permission` state, persists with the Session, and leaves new
  Sessions on their configured default. Questions the agent asks you are a
  different seam and are unaffected.

### Changed

- Tool calls are drawn on a card. Every step's title and body now sit on one
  quiet full-width surface, with a blank row of that surface above and below it,
  instead of running together with the prose around them — a long conversation no
  longer asks the reader to count indents to see where one call ends. The card
  says nothing about status: a failed command is marked by its red leading glyph
  and its `exit 5` capsule, not by a red block, and a page-background row keeps
  two consecutive calls from fusing into a single slab. A shell's folded preview
  now keeps the *end* of its output — the last five lines, with the count of the
  lines above them, since a command's answer is usually there — a change previews
  in five rows instead of nine, and a settled call always shows how long it took.

### Fixed

- Scrolling a conversation with a trackpad did nothing, and each swipe instead
  recalled an earlier prompt into the composer. The client cleared all-motion
  tracking (`?1003l`) *after* the renderer had enabled button tracking, and a
  terminal that keeps mouse reporting in one flag — Ghostty, for one — turns the
  whole group off on any one mode's reset. With no mouse reporting the alternate
  screen converts scrolling into Up/Down keys, which is exactly the composer's
  history. The disable is now written before the renderer's enable, so button
  tracking, the wheel and click-to-expand stay on.
- `Up`/`Down` in the composer only knew the prompts the running window had
  submitted, so after a restart or when attaching to a Session the history was
  empty — pi seeds its editor from the loaded transcript instead. The prompts a
  Session's journal replays (a resumed conversation, a prompt another window
  sent) are now remembered once, and `Up` reaches the turn sent before this
  window existed.

## [0.3.18] - 2026-11-16

### Added

- `hulala remote <ssh-host>` — and its `hulala ssh <ssh-host>` synonym — opens
  the client directly on a Host that runs on another machine, so reaching the dev
  box no longer means opening a local window and switching it with `/remote`
  first. It runs the same probe `/remote` runs: a stopped Host is started, a
  missing or older one is installed through the same website script, and an
  unreachable or newer one is reported instead of changed. `hulala remote` with
  no machine lists the aliases in your own `~/.ssh/config`; the in-window
  `/remote` picker is unchanged.

## [0.3.17] - 2026-11-15

### Fixed

- `curl | sh` and `hulala update` could not install 0.3.16 at all: the release
  archive carries code only and installs its dependency tree with `npm ci`
  after it starts, but the client resolved `ws` while its bundle loaded, so
  every command in a freshly unpacked archive — including `hulala install`
  itself — died with `ws not found`. The lookup now runs on the first
  connection, and a built-bundle test starts `--version` with no
  `node_modules` beside it, which is the archive's own shape.

## [0.3.16] - 2026-11-15

### Fixed

- Switching to a remote Host with `/remote` left the shell and the restarted
  client reading one terminal: the caret jumped to the front of the text, arrow
  keys arrived split, and terminal replies reached the shell as commands that
  could end the client on the first send. The restart now hands the terminal to
  one successor in the same process group and waits for it, and releases stdin
  before that successor starts, so a single process owns the tty throughout.
- Stray terminal reports — color replies, device attributes, cursor position and
  window-size replies — are dropped before they reach a modal or the composer.
- A key sequence whose escape byte was read on its own — an arrow key over a
  stalled frame — no longer types its tail as text once the rejoin window has
  closed: `[C` / `[D` can never appear in the composer or a shell again. The
  tail is dropped with a trace, and ordinary typing after it is untouched.
- `Ctrl-T` pressed right after startup used to fail silently: the Host terminal
  is scoped to the Session id, which had not landed yet. The open is now
  deferred until the id is known and the focus completes with it, so the column
  opens and holds the keyboard instead of leaving the keypress unanswered.
- A bracketed paste that took longer than the escape hold was handed back as the
  Escape key plus its own `[200~` marker and text. An unfinished paste is now
  held until its end marker; a paste is never a key sequence.
- Reattaching to a Host terminal now rebuilds the screen at the snapshot's own
  size before returning to the pane size, so wide characters, wrapped lines and
  the cursor land in the cells the program wrote instead of being reflowed at a
  different width.
- Wide characters are placed by the terminal emulator's own cell width instead
  of a string-width guess: a wide glyph never starts in the last column, and its
  spacer tail no longer becomes an extra space.
- Leaving the client also resets the cursor shape a column's program chose
  (`DECSCUSR`) and ends synchronized output (`?2026l`). A shell no longer
  inherits a bar cursor, and a frame that was mid-update is not left held.
- The client no longer enables all-motion (`?1003`) or focus (`?1004`) reports at
  all: the adapter filters the renderer's enable sequence and clears any stale
  state, instead of switching the modes on and immediately off.
- The packaged client resolves `ws` from the runtime dependency tree instead of
  bundling it. The bundled copy kept the multiplex connection alive until a
  terminal column attached, then dropped it — a source run could not reproduce
  it, but every release artifact had it.
- Arrow keys and function keys arrived as `[C` / `[D` in the composer: their
  escape byte was read on its own, the frame took it for the Escape key, and what
  followed was text. A lone escape is now held for a tenth of a second — longer
  than Neovim's 50 ms `ttimeoutlen`, because this client reads stdin on the
  frame's event loop — so a frame that stalls between the two halves still gets
  one sequence, and a sequence that lost its escape (`[C`, `[3~`, `OA`) is
  restored from its tail instead of typed.
- The terminal was left unusable after the client went away: the alternate screen
  stayed on and mouse reporting stayed enabled, so the shell received every
  pointer report and echoed it as text. The client now writes the restore
  sequences synchronously on exit, on an uncaught error and on the signals a
  launcher sends, so a crashed or killed client no longer costs the terminal.
- The frame asked for all-motion mouse tracking (`?1003`), which turns every
  pointer movement into a report — hundreds a second on a trackpad, and a busy
  remote frame cuts them in half. It now keeps button motion (`?1002`): clicks,
  drags, selection and the wheel still work, and a trackpad no longer floods the
  input or moves the caret while typing.
- A client whose window was closed stayed alive, holding its Host connection and
  its forward. Several of those on one Host are indistinguishable from the window
  a user is typing into — and a process keeps the code it started with, so a
  rebuilt `bin/hulala` does not change a client that never exited. A closed
  stdin now ends the client.

### Added

- `bun run start` records every stdin read and every piece the input parser made
  of it (`~/.hulala/logs/tui-debug.log`, capped at 8 MB). Input that arrives in
  pieces is invisible on screen; the trace is the only way to see what the
  terminal actually sent.

## [0.3.15] - 2026-11-14

### Fixed

- Input is framed by one buffer-first parser instead of the renderer's sequence
  splitter. That splitter emits anything without an escape byte one character at a
  time, which is right for a TUI and wrong for a program's bytes: a pointer report
  whose escape was read separately arrived as the Escape key and then
  `[<35;43;38M` — typed into the composer, and the stray Escape moved the keyboard
  into the rail. The parser holds whatever is incomplete, so a report is delivered
  whole however the kernel cut the read, and a report that lost its escape is
  still a report rather than text.
- The suite now checks that property directly: a report parses identically under
  every chunk size and at every split point, which is the case a 4 KiB read never
  showed and a busy remote frame did.

## [0.3.14] - 2026-11-14

### Fixed

- A pointer report the terminal reads in two pieces — the escape on its own, then
  `[<35;43;38M` — put the tail into the composer as text, so a moving trackpad
  typed `[<35;43;38M` and the caret appeared to jump. The escape is now held for a
  moment as a possible report head, a late tail is rejoined to the escape that was
  already delivered, and a report that lost its escape byte is still decoded as a
  report instead of being typed.
- `/remote` treated a stopped Host as attachable, because a stopped Host reports no
  version. It now starts it and reads the version before deciding, so an
  out-of-date machine offers its update instead of failing to attach with "runs an
  older Hulala".

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
