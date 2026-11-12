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
