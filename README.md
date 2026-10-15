<div align="center">
  <img src="assets/brand/hulala-logo-v2.svg" alt="Hulala" width="128" />
  <h1>Hulala</h1>
  <p>Read, write, code, and keep working — in your browser, on your own machine.</p>
  <p><a href="README.zh-CN.md">简体中文</a> · <a href="https://hulala.ai/">Website</a> · <a href="docs/browser-workbench.md">Browser edition</a></p>
</div>

Hulala is an Apache-2.0 browser workbench built on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Run `hulala` after installation: it starts the local service, waits for the workbench, and opens **http://hulala.localhost:3210/**.

Each Workspace opens in a browser tab named after its folder. Views of the same Workspace share its Host and running work; file editor tabs stay inside that page. Remote tabs also show the SSH host alias.

## Workbench

- Files, search, imports, downloads and conflict-aware saving, with durable draft recovery.
- Markdown/code editors, PDF/EPUB/DOCX readers, drawings, references and PDF export.
- Native Harness conversations, model selection, approvals, attachments, sessions and Agent Presets.
- Pi, DeepSeek, Codex and Claude Agent SDK integrations, using their native tools and credential stores.
- Host-owned commands with bounded output, stdin, stop/reconnect and history; Git branches and status.
- Cron, Messenger, archive cleanup and trusted Workspace plugins.
- Direct SSH Workspaces with host-key verification, scoped file/resource access and verified remote Host packages.

The retained command interface is a pipe-based command runner, not an interactive PTY emulator. Browser page zoom and browser tab shortcuts remain native. Closing a page does not cancel its background work.

## Run from source

Use **Bun 1.4.2**, Git, and the repository's development toolchain (Node.js 24+). The Runtime is pinned to Harness `0.1.5-rc.2`.

```sh
git clone https://github.com/colinagent/hulala.git
cd hulala
bun install --frozen-lockfile
bun run build
bun run start
```

`bun run dev` builds and starts the browser workbench in the foreground. `bun run dev:harness` retains the upstream Harness UI development entry. The earlier Loop prototype in `apps/web` and `packages/core` is parked.

## Installable packages

Browser release artifacts are staged locally; building this repository does not publish to npm or GitHub Releases. See [distribution details and validation](docs/browser-workbench.md).

```sh
bun run pack:workbench
bun scripts/workbench/npm-package.ts <verified-package-directory>
```

A standalone package contains its own Bun, Host, Runtime, web assets and licenses. It runs without a developer checkout or Node/Bun on PATH. From its extracted directory:

```sh
./bin/hulala install --add-to-path
# Open a new terminal after a PATH change.
hulala
```

On Windows, use `.\bin\hulala.exe install --add-to-path`. The npm distribution uses a lightweight `hulala` package with exact platform aliases; npm/npx requires Node.js 18+. A verified runtime copy keeps background services independent of a disposable npx cache.

Build targets are macOS arm64/x64, glibc Linux arm64/x64 and Windows x64. Native results are recorded by the browser CI matrix; a cross-compilation alone is not an acceptance result. Windows arm64 and musl Linux are not claimed as supported.

## Service and updates

```sh
hulala --no-open
hulala --foreground
hulala service status
hulala service restart
hulala service shutdown
hulala doctor
hulala update
hulala rollback
hulala uninstall
```

Busy restarts are refused with a work summary; `--force` explicitly stops that work. Standalone updates verify checksums and the complete package, test a candidate with isolated state, and switch versions atomically. Rollback checks data-format compatibility. npm, Bun and pnpm installations use their owning package manager. Uninstall retains configuration, credentials, Workspaces and session data.

Login startup is separate and opt-in: `hulala service install` enables a current-user launchd, systemd or Task Scheduler job. `hulala service uninstall` removes that job. Installing the program does not enable login startup, open the browser, or leave a user service running.

## Data and credentials

- Hulala state: `~/.config/hulala`; default Workspace: `~/hulala-workspace/workspace`.
- `HULALA_HOME` and `HULALA_WORKSPACE_ROOT` accept absolute isolated roots; `HULALA_PORT` changes the public port.
- The service binds to numeric loopback. It does not edit DNS or the hosts file. Browser access uses a same-origin HttpOnly session; internal Host tokens stay outside the renderer.
- Provider authentication stays with the native Provider/Agent stores, including Harness's managed credential store. Credentials and personal state are not bundled with source or releases.
- Git, system shells, optional external Agent tools and model access remain separate capabilities. Codex uses `codex app-server`; provider configuration is available in Settings.
- Plugins execute trusted local code. They are not an untrusted-code sandbox. Install only plugins you choose to trust.

## Development and review

```sh
bun run check
bun run check:workbench
```

Tests use injected state/Workspace roots and synthetic/local model fixtures. Installed-package smoke tests exercise npm, npx cache removal, archive integrity, native startup, update/rollback, SSH and user-data retention. Detailed commands, package layouts and browser adaptations are in [docs/browser-workbench.md](docs/browser-workbench.md).

Hulala's first-party code is [Apache-2.0](LICENSE). Third-party components retain their own licenses and terms, including the separately licensed Claude Agent SDK; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Hulala is independent of DeepSeek, OpenAI, Anthropic and the Pi maintainers.
