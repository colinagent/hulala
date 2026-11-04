# Hulala Public Repository Rules

## Read First

- This repository is the single source checkout for Hulala. It owns the Hulala
  Host/Server, the CLI and terminal client, the website, the Runtime composition,
  shared contracts, and the terminal client's plugin contract.
- The private `/Users/colin/note/projects/hulala-dev` repository owns release
  tooling, deployment configuration, signing/updater credentials, internal
  notes/PRDs, and release skills. It must not keep a second copy of this source.
- This repository is licensed GPL-3.0-only. Every source package keeps
  `"private": true` and the GPL license unless the product owner explicitly
  changes it. Do not publish source to a package registry.
- Never copy private notes, credentials, deployment details, or release logic
  into this repository. Never push, publish, deploy, or create a release unless
  the product owner explicitly asks for that external action.
- Preserve unrelated and uncommitted user work. Never use destructive Git
  commands to clean the tree.

## Product Architecture

- The terminal client is the only shipped UI. Desktop and the browser workbench
  were retired; do not reintroduce an Electron app, a web workbench, or a second
  UI surface without an explicit product decision.
- The terminal client is a Cordis plugin host. `apps/cli/src/tui/kernel.ts` owns
  the `Context` and its disposal; every feature is a plugin under
  `apps/cli/src/tui/plugins/`, and user plugins load from
  `<state root>/config/plugins/`. The plugin contract is
  `packages/tui-plugin` and it only ever grows.
- The Host is one Cordis/DeepSeek Harness process per state root. The public
  Runtime composes published DSH packages and the native DSH Agent Loop; the
  Host adds one assembly plugin (`hulalaHost`), the two gap plugins
  (`hulalaFiles`, `hulalaGit`), and the authenticated HTTP/WebSocket carrier.
- DeepSeek Harness is the only Agent Runtime. Do not add Pi/Codex/Claude Agent
  Loops, OpAgent Runtime/Protocol, Go services, or compatibility adapters.
- Transport is DSH-native: `/connect?token=` exchanges the launch token for a
  signed Cookie; `/api` carries Remote calls; `/api/remote.mux` carries streams
  and forwarded events. Do not add a second REST layer or token scheme.
- One Host daemon owns one state root. Terminal windows and any other client
  discover it through `endpoint.json` and attach; closing a client
  detaches instead of stopping the Host. Only an explicit user action starts or
  stops a Host, and there is no login autostart.
- The terminal client is bundled into the CLI; it must not spawn a private
  second Runtime or a DSH profile.

## Data And Security Boundary

- `~/.hulala` is the root for Hulala-owned configuration, state, logs, caches,
  runtime bundles, and transfers. `~/.hulala/bin` is the one directory of
  executables Hulala owns, and every entry is a real file, never a symlink: the
  `hulala` command, the published `nvim`, the published `rg` (taken from the
  `@vscode/ripgrep` package the Harness already installs), and macOS-only
  helpers, with their data under `~/.hulala/runtime/`. That directory is never
  added to a user shell's `PATH`; client child processes — the editor column and
  the Host — get it *appended* after the inherited entries, so bundled binaries
  are a fallback and can never shadow the user's own commands. The installer's only
  file outside `~/.hulala` is one symlink to `~/.hulala/bin/hulala` in a
  directory the user already has on `PATH` (Python console-script convention),
  used so installing never edits a shell profile; `--add-to-path` is the
  explicit opt-in for a marked profile block when no such directory exists.
  Deleting `~/.hulala` removes everything Hulala installed. Native helper source
  belongs in this repository
  (`apps/cli/native/`), never in the state root; `~/hulala-workspace` is the
  user Workspace
  root; the default Workspace is `~/hulala-workspace/workspace`.
- Code must accept injected HULALA state and Workspace roots for tests. Tests
  must never write to the real home directory.
- Secrets belong in an operating-system credential store or the owning
  Provider's native credential store. DeepSeek Harness may persist credentials
  in `$DSH_HOME/.credentials.yaml` under the injected Hulala config root.
  Credential files must be written atomically with user-only permissions; other
  config files contain only non-secret settings or opaque references.
- Servers bind to loopback, require a process-scoped random token or DSH signed
  Cookie, validate local origins/request sizes, and constrain file operations to
  an explicitly selected Workspace. Renderer code never reads files, spawns
  commands, opens SSH connections, or handles secrets directly.

## Source And Build Rules

- First-party application code is TypeScript/TSX. Do not introduce new
  first-party JavaScript, MJS, shell, Python, Rust, or Go implementation files.
- Use Bun 1.4.2 for installs, scripts, tests, and bundles. Keep `bun.lock`
  committed and deterministic. The Host and CLI execute on Node 24+ because DSH
  0.2.1 boots through Node's internal module loader.
- The Host keeps only the daemon shell and the two gap plugins. Add a DSH row
  only when the client feature that consumes it lands; do not mount unused
  controllers "for later".
- Large and binary resource content uses HTTP streaming. WebSockets carry only
  typed events and state changes.
- The website lives in `apps/website`; keep its Sites/Vinext surface and
  Cloudflare Workers Static Assets deployment working. R2 keeps only the latest
  complete release; use `scripts/release/publishR2.ts` and
  `deploy/cloudflare/README.md`.

## Out Of Current Scope

Do not add Loop Cloud, accounts, organizations, multi-tenancy, hosted Agent
provisioning, billing, Marketplace, Cloud Sync, hosted relay, shared messaging
gateways, managed model keys, or proprietary Packs. Do not restore the retired
browser workbench, local-host/workbench apps, an Electron Desktop, an older
profile layout, or Pi/Codex/Claude Agent Loops.

## Validation

Run the relevant narrow checks during development and the full check before
handoff. `check:patches` runs first on purpose: a `patchedDependencies` entry
whose version key stops matching is ignored in silence, so every dependency bump
must prove the patch is still applied.

```sh
bun run typecheck
bun run test
bun run build
```

Do not publish or deploy as part of validation.

## Backups

Before large structural changes, create a timestamped backup outside this
repository under `/Users/colin/note/projects/refs/`. Existing backups:
`hulala-backup-20261101-121356/` contains the pre-unified-Host workbench and
private tree; newer cleanup backups live in sibling timestamped directories.
Never back up into the repository or the home directory.
