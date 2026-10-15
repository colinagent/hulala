# Browser workbench

The browser edition reuses Hulala's workbench UI and local Harness capabilities.
The CLI starts the browser workbench at `http://hulala.localhost:3210`.
Each Workspace has its own browser tab and an isolated Harness process; views
of the same Workspace share that
process. The source, native packaging and installation tools are available;
this browser release has not been published to npm or GitHub Releases.

## Development

Use the repository's pinned Bun version and lockfile:

```sh
bun install --frozen-lockfile
bun run check:workbench
bun run start
bun run pack:workbench
```

The package command builds a complete native distribution in a new staging
directory, then writes its tar.gz archive and SHA-256. Use the pinned Bun version.
It does not publish or install anything. To create the lightweight npm launcher
and matching platform package from that verified directory:

```sh
bun scripts/workbench/npm-package.ts <package-directory>
bun scripts/workbench/smoke-installed.ts <package-directory>
bun scripts/workbench/smoke-package.ts <package-directory>
```

These are local build instructions; this browser release has not been published.
By default Hulala uses the system browser. `HULALA_BROWSER` can select an
absolute browser executable path (no shell arguments); `--no-open` leaves the
browser closed and prints the local address.
The npm wrapper selects an exact platform alias and copies the verified package
to immutable Hulala runtime storage before execution. Background processes can
therefore continue after an npx download cache is removed. Generated platform
packages use versions such as `0.1.4-darwin-arm64`; the main `0.1.4` package
locks all platform aliases to matching versions. Pack the generated staging
packages, not the CLI source checkout.

## Source layout

| Location | Responsibility |
| --- | --- |
| `apps/workbench` | React UI, editors, styles, translations, and browser platform contracts |
| `apps/local-host` | Authenticated local API, Harness composition, files, conversations, commands, Git, Cron, Messenger, plugins |
| `packages/workbench-contracts` | Runtime-validated API schemas and injectable state/Workspace path contracts |
| `packages/plugin-sdk` | Contracts for trusted local plugins |
| `scripts/workbench` | Source-boundary checks and staged package integrity tooling |

The workbench browser build imports neither Electron nor Node filesystem/process
capabilities. `WorkbenchPlatform` names the capabilities consumed by the UI;
there is no public arbitrary IPC channel or arbitrary Host method dispatcher.
The transport installs a concrete platform before rendering. HTTP and read-only
WebSocket events use a same-origin, HttpOnly process-scoped session; Host tokens
never enter URLs or renderer state.
Workspaces open in browser tabs, with their folder name in the tab title.
Native window-management controls are absent. Page zoom belongs to the browser;
document zoom remains available in the editor and reader controls.

## Capability ownership

| Baseline capability | Browser/Host owner | Adaptation stage |
| --- | --- | --- |
| Workspace bootstrap, list/focus/close window, page title | Browser routing, one Workspace per tab | 2 |
| Files, search, resources, imports, directory picker, recovery backup | Authenticated Host; browser uploads/downloads | 3 |
| Clipboard, PDF export, drawing iframe, resource previews | Browser APIs plus explicitly scoped Host operations | 3–4 |
| Conversations, models, provider authorization, approvals | Harness services in Host; typed browser requests/events | 5 |
| Commands, Git, Cron, Messenger, archive | Host-owned tasks and persistence | 6 |
| SSH hosts, credentials, tunnels and remote startup | Local Host and native credential store | 7 |
| Settings, zoom, theme, local plugin views/RPC and update UI | Browser capabilities plus narrowly scoped Host APIs | 8 |

All existing capability families remain in the migration inventory. Native-only
behavior needs an explicit web adaptation; compilation alone does not establish
feature parity. Workspace/session ownership must be preserved in every request.

## Files and recovery

Text reads return an opaque Harness file version. Every replacement must carry
that document's version; creating a file must require an absent destination.
Conflicts retain the draft and offer a separate copy and a disk comparison.
Automatic saves are serialized per document path. File reads from watchers may
refresh clean documents, but cannot replace edits made while a read was running.

Drafts are continuously journaled in IndexedDB and under the configured Host
state directory. Web Locks distinguish active views from abandoned ones, including
duplicated browser tabs. Recovery keeps distinct buffers for the same file and
never automatically overwrites the disk. Dirty pages receive browser-controlled
navigation warnings. Saved editor files, pane placement and active selection
are restored separately from drafts.

File and folder inputs, drop and paste use browser File/Blob objects. Uploads
stream through HTTP with progress and cancellation, a 256 MiB limit per file,
and atomic publication. Import conflicts can be skipped or conditionally
replaced; a file changed after confirmation is rejected. Partial multi-file
imports retain completed files and report the failure. Resource handles are
Workspace scoped, expire, support Range, and revalidate paths when opened.
Downloads retain file names. Host filesystem operations constrain paths to the
selected Workspace, including symlink checks. System open/reveal requests are
explicit named operations, not a shell bridge.

## References, readers and PDF export

The right pane can pin a file from another registered Workspace. Its source
label remains visible; file operations, media resources and recovery drafts use
the source connection. The page keeps its own Workspace and browser title.
Reader positions and pane references survive reloads.

PDF export renders the existing Markdown view in a separate Chrome, Edge or
Chromium process with a disposable profile. It uses a private process pipe,
waits for complete document rendering, then publishes the PDF inside the source
Workspace without replacing an existing file. `HULALA_PDF_BROWSER` can specify
the rendering executable. The production packaging stage still needs to
validate engine availability on every supported platform.

The optional integration check `bun scripts/workbench/smoke-pdf.ts --keep`
creates an isolated multi-page PDF with Chinese text, math, a diagram, an image
and a table, and verifies draft isolation and overwrite protection. The printed
temporary directory contains the artifact for visual review. The rendering
protocol is defined by [Chrome DevTools](https://chromedevtools.github.io/devtools-protocol/).

## Direct SSH Workspaces

SSH connections, host-key checks, credentials and tunnels live in the local Host.
Each remote directory opens a browser tab named `directory @ host alias · Hulala`.
Tabs for the same directory share its remote Host. File operations and resources
pass through the SSH tunnel and retain their selected Workspace boundary.

Unknown or changed host keys require a fingerprint confirmation before authentication.
Passwords and key passphrases use [Bun's system credential store](https://bun.sh/docs/runtime/secrets).
An explicit session-only option keeps a secret in process memory until Hulala stops;
an unavailable system store never falls back to a plaintext configuration file.
OpenSSH config aliases are supported; ProxyJump/ProxyCommand require a directly
reachable connection instead of being silently bypassed.

Remote Hosts continue running when a browser tab or SSH link closes. Stop Agent
turns and commands using their controls before disconnecting if they should end.
Reconnecting reuses the remote Host and its persisted Workspace state.

During development, `HULALA_REMOTE_PACKAGES` points to directories named
`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, or `win32-x64`, each
containing a verified public remote Host package. Build a public portable Runtime,
then run `bun scripts/workbench/remote-package.ts <runtime-directory>` to add the
browser Host. Published releases use the verified release-index download path
described below. Native SSH/package execution is tested on macOS arm64/x64 and
Linux arm64/x64. Windows SSH execution remains unverified.

## Browser settings and trusted plugins

Global theme, language, and local service settings are persisted by the Host and
announced to all browser profiles. Follow System resolves independently for each
browser. View layout stays per tab. External JSONC preference edits are detected
by a watcher with a periodic check. Settings writes merge individual fields.

The local service can prevent idle sleep while it runs, including after its
browser tabs close. The UI reports the actual assertion or an unavailable/failed
capability. Installed-package checks exercise acquiring and releasing the native
assertion. Linux systems that deny the inhibitor report an explicit error and
retain the prior setting.

Trusted plugins are installed, enabled, and stored per Workspace. Multiple views
of one Workspace share one backend, its tasks and RPC state. UI modules and CSS
load from authenticated HTTP routes bound to the installed plugin revision.
Updates that fail activation restore the previous revision; uninstall removes
the installed code while retaining plugin data. Credential configuration returns
only success/status to the UI. The Host blocks known credential values from plugin
RPC responses, events, logs and plain settings.

Plugins run trusted local code with Host permissions and their UI runs in the
workbench document. This is not a sandbox for untrusted code. Imported document
previews retain their separate sandbox/CSP restrictions.

If browser preferences, IndexedDB or cross-tab broadcasts are blocked, the page
reports the limitation and continues with in-memory view state and Host-backed
drafts. Keep the page open while editing offline in this mode. Live Host view
leases prevent another tab from claiming an active draft.
The draft database opens in a Worker so a slow browser storage service cannot
block the UI thread. Storage requests have bounded waits; invalid cached view
identifiers are regenerated without deleting durable drafts.

Browser new/close-tab, address, reload and page-zoom shortcuts remain native.
The settings file supports application bindings for opening settings and searching
Workspace files; editor save/find operate in the focused editor.

## Package layout

The canonical package contains:

```text
bin/hulala                 native CLI (hulala.exe on Windows)
runtime/bin/bun            bundled Bun (bun.exe on Windows)
runtime/runtime/host.js    public Harness composition
runtime/host/              browser gateway, Workspace Host and SSH bootstrap
runtime/node_modules/      locked public dependencies and native libraries
runtime/packages/          Hulala Runtime plugins
runtime/remote-manifest.json
web/                       workbench HTML, JS, CSS, fonts and workers
settings/                  non-secret default templates
manifest.json              complete inventory, protocol/data format, lock identity
LICENSE, THIRD_PARTY_NOTICES.md, licenses/
```

The native entry resolves all assets relative to its installation. It supports
bare `hulala`, `--foreground`, `--no-open`, `--version`, and
`--check-package`. CLI and Host readiness must match both process and version.
No Node/Bun installation or source checkout is needed for the standalone package.
Git, system shells and optional external Agent tools remain separate capabilities.

Portable dependency installation projects the repository lock graph and uses
`--frozen-lockfile`; it does not resolve fresh dependency ranges or run install
scripts. Native prebuilt packages are selected by OS/CPU. External/cross-target
Bun executables require an explicitly pinned SHA-256. Build/installer metadata
that npm omits is removed before inventory generation; the unpacked npm tarball
is verified again against that same canonical inventory.

Native package checks cover macOS arm64/x64, Linux arm64/x64 and Windows x64:
installed startup, native SDK loading, default Agent sessions, npm global
installation, fresh npx invocation with cache removal, bundled search, and
install/restart/uninstall with user-data retention. SSH/SFTP checks also run on
macOS and Linux. Linux musl and Windows arm64 are not claimed as supported.

Local integrity verification rejects modified files, unexpected entries,
duplicate manifest paths, path traversal, and symlinks. It verifies consistency
with the manifest, not authenticity of an unsigned downloaded manifest. Release
source trust and installer verification remain separate distribution requirements.

Keep package contents separate from `~/.config/hulala` state and user Workspaces.
`HULALA_HOME` and `HULALA_WORKSPACE_ROOT` support isolated tests. CLI state belongs
under `runtime/launcher` and logs under `logs` within the configured root.
The private Desktop installer, updater, signing, and remote release artifacts
are not inputs to this build.

## Review and tests

The [2026-10-16 acceptance run](https://github.com/colinagent/hulala/actions/runs/38811822425)
for code revision `9af016c` passed all five native targets and both browser matrices.

`check:workbench` runs source-boundary checks, strict type checks, the migrated
Host/UI/contract tests, package-integrity tests, and a web/Host build. The Host
integration tests boot the public Harness from this repository using temporary
state and Workspace directories.

The browser matrix runs Chromium, Edge, Firefox and WebKit on Linux, plus
Chromium, Edge and Firefox on Windows. It covers folder-named tabs, settings
documents, Chinese editing, streaming conversations, composer stability, denied
browser storage, save failures and draft recovery. Run it locally with:

```sh
bunx playwright install chromium firefox webkit
bunx playwright test --config tests/browser/playwright.config.ts
```

The current macOS check also exercises installed Chrome and Playwright WebKit.
Current native Safari validation remains unverified; the automated matrix uses
the WebKit engine.

Historical tests for removed Agent modules and a superseded ban on native HTML
selects were excluded. Tests no longer read external Agent documents or private
Word fixtures; they construct synthetic input. Source maps, caches, personal
paths, credentials, Electron dependencies, and deployment settings are excluded
from the imported source and package inputs.


Conversation drafts are saved per browser view, including staged image references
and stable prompt request IDs. Refreshing restores the composer; distinct recovered
drafts remain selectable. Images upload through bounded HTTP streams into the
Harness attachment store (20 MiB each, 40 MiB per message, up to 19 images).
Text-only queued messages can be edited; the current Harness queue API cannot
preserve images during an edit, so image messages must be removed and resent.
Streaming reconnects use a fresh snapshot and cursor-based replay. Credential
files owned by configured providers cannot be read or copied through workspace
file/resource routes; manage them through the native Provider settings.

## Installation lifecycle

From an extracted package, run `./bin/hulala install --add-to-path` (Windows:
`.\bin\hulala.exe`). `--root` selects its managed program directory and `--bin`
selects the command directory. Installation validates a candidate with temporary
state; it does not leave a user service running or enable login startup.

`hulala update` uses the stable browser channel; `--version` pins a release and
`--channel preview` opts into prereleases. Local packages can use `--from`, with
`--sha256` required for archives and downloads. npm/Bun/pnpm/npx installations
report their owning manager's commands. Updates preserve an immutable previous
version; `hulala rollback` refuses incompatible user-data formats.

A requested restart first stops new writes, waits for in-flight changes, and
checks Agent turns, commands, Cron runs, plugins and drafts. Active work requires
an explicit `--force`. Cancelled or abandoned reservations resume the service.
Browser views renew their session cookie and retry pending draft backups after
reconnection. A bounded lease preserves draft ownership across Host restarts.

`hulala uninstall` removes its owned command and program versions, preserving
configuration, credentials, Workspaces and session data. Changed or unrecognized
files are retained. Windows uses a deferred helper for executables that remain
locked until the invoking command exits; the completion result is written to the
Hulala logs directory. PATH registration preserves existing profile content.

Login startup is opt-in through `hulala service install`, with current-user
launchd, systemd and Task Scheduler jobs. It uses a stable native launcher or the
original package-manager entry, never a disposable npx path. Provider credentials
are not copied into login-job environment files.

SSH connections can obtain an exact version/target package from the browser
release index, verify it, and transfer its Runtime subset. A remote Workspace
with another Host version requires an explicit restart. Running work requires a
further explicit stop confirmation; other remote directories remain running.

Release assets can be prepared without publishing:

```sh
bun scripts/workbench/release-assets.ts \
  --package <verified-package-directory> \
  --output <staging-parent> \
  --base-url <release-asset-base-URL>
```

Repeat `--package` for matching platform builds. This generates checksums, a
browser channel index, and POSIX/PowerShell bootstrap installers. Browser tags
use `browser-v<version>` and a separate `browser-channels` index, preserving
Desktop release tags and latest metadata. Generated staging URLs are not a claim
that assets have been published. Unsigned builds are not notarized or signed
with a publisher certificate; do not disable operating-system protections to
install them.
