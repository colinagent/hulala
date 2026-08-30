<div align="center">
  <img src="assets/brand/hulala-logo.svg" alt="Hulala paper pinwheel logo" width="128" />
  <h1>Hulala</h1>
  <p><strong>Growth in motion.</strong></p>
  <p><strong>Read. Write. Code. Keep going.</strong></p>
  <p>Open-source DeepSeek Harness runtime and native Agent Loop plugins for local, long-term work.</p>
  <p>
    <a href="README.zh-CN.md">简体中文</a>
    ·
    <a href="https://hulala.ai/">Website</a>
    ·
    <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a>
    ·
    <a href="#quick-start">Quick start</a>
  </p>
  <p>
    <img alt="DeepSeek Harness" src="https://img.shields.io/badge/DeepSeek-Harness-4D6BFE" />
    <img alt="Node.js 24+" src="https://img.shields.io/badge/Node.js-24%2B-339933?logo=nodedotjs&logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5B5BD6?logo=typescript&logoColor=white" />
    <img alt="Local first" src="https://img.shields.io/badge/Local--first-111827" />
  </p>
</div>

Hulala is an open-source, local-first AI workbench for the long run. It turns [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) into a place where reading context informs writing, writing sharpens intent, and coding makes ideas real—without moving credentials or sessions into a hosted gateway.

This repository contains the public Harness workbench, Runtime, and native Agent Loop plugins. It keeps Harness's Cordis plugin architecture and makes its Agent Loop replaceable, so you can switch between **Pi Coding Agent**, **OpenAI Codex**, **Claude Code**, and the original **DeepSeek Agent Loop** without adding an ACP gateway or a separate driver layer.

Pi is the default Agent. Every runtime keeps its native model access, tools, approvals, MCP configuration, skills/extensions, and local authentication.

> DeepSeek Harness is currently a developer preview. Hulala follows its plugin APIs closely, so breaking upstream changes may require an update.

## The growth flywheel

```text
Read → Write → Code → Reflect → Repeat
```

Hulala is built around continuity rather than isolated prompts. Read the Workspace and its history, write down the reasoning, turn the idea into code, inspect the evidence, and let that result become context for the next turn. The flywheel compounds because the work stays local, inspectable, and attached to the Workspace that produced it.

## Why Hulala

- **One DeepSeek Harness, multiple Agents** — change the active Agent Loop from the composer instead of moving between separate terminal apps.
- **Native integrations** — Pi uses its TypeScript SDK, Codex uses `codex app-server`, Claude Code uses the Agent SDK, and DeepSeek uses Harness's original Agent Loop.
- **Models and Thinking controls** — choose the provider/model and supported reasoning level directly beside the prompt.
- **Remembered selection** — a successful Runtime, model, or Thinking choice becomes the user default for the next new session and survives a local Runtime restart.
- **Full coding tools** — read, bash, edit, write, project instructions, skills, extensions, MCP servers, and approval flows remain available where the selected Agent supports them.
- **Local-first credentials and sessions** — tokens remain in the native Pi, Codex, Claude Code, or environment stores. Hulala does not run a hosted credential gateway.
- **Workspace continuity** — reopen the last Workspace automatically; a fresh install starts at `~/.config/hulala/workspace`.
- **Proxy support** — use terminal environment variables, the macOS system proxy/Clash, a manual HTTP proxy, or force direct connections.
- **Vite development workflow** — client-side workbench controls update with HMR while Harness remains running.

## Supported Agents

| Agent | Integration | Authentication | Native capabilities retained |
| --- | --- | --- | --- |
| **Pi** (default) | `@earendil-works/pi-coding-agent` SDK | Accounts panel, `pi /login`, or `~/.pi/agent` | models/providers, tools, skills, extensions, sessions, Thinking levels |
| **DeepSeek** | original `@deepseek-ai/dsh-agent-loop` | `DEEPSEEK_API_KEY` and normal Harness settings | original Harness Agent Loop and DeepSeek models |
| **OpenAI Codex** | `codex app-server --stdio` | existing `codex login` session | tools, MCP, sandbox, approvals, threads, models, reasoning effort |
| **Claude Code** | `@anthropic-ai/claude-agent-sdk` | existing Claude Code login or Anthropic environment | Claude Code tool preset, settings, skills, plugins, MCP, permissions |

Hulala replaces the single process-wide Agent Loop transactionally through Cordis Loader. A blank conversation switches immediately. If the current conversation already has history, the UI asks for confirmation and opens a new conversation in the same Workspace, preventing a silent mid-session runtime change.

## Quick start

Requirements:

- Node.js 24 or newer
- npm and Git
- credentials for whichever Agent you want to use

Clone, install, and start:

```bash
git clone https://github.com/colinagent/hulala.git
cd hulala
npm install
npm run dev
```

Or use one shell command:

```bash
git clone https://github.com/colinagent/hulala.git && cd hulala && npm install && npm run dev
```

Open [http://127.0.0.1:3210](http://127.0.0.1:3210). `npm run dev` also starts the Vite HMR server on port `5174`.

For a production-style local start without the Vite development server:

```bash
npm start
```

## Sign in to an Agent

### Pi

Select **Pi**, then open **Accounts** beside the composer. The Web flow supports the OAuth providers exposed by Pi, including ChatGPT/OpenAI Codex and Anthropic. You can also authenticate in the terminal:

```bash
pi
# then run /login
```

Pi continues to own its configuration and credentials under `~/.pi/agent`. Hulala never returns raw tokens to the browser.

### OpenAI Codex

Install and sign in with the official [OpenAI Codex CLI](https://github.com/openai/codex), then select **Codex** in Hulala:

```bash
npm install -g @openai/codex
codex login
```

Hulala starts `codex app-server --stdio` when needed and reuses the CLI's existing local login. Set `CODEX_BINARY` only if your `codex` executable is not on `PATH`.

### Claude Code

Authenticate with [Claude Code](https://docs.anthropic.com/en/docs/claude-code/getting-started) normally, then select **Claude Code**:

```bash
npm install -g @anthropic-ai/claude-code
claude
```

The runtime uses the Claude Agent SDK and your normal Claude Code settings. Standard Anthropic environment credentials also continue to work.

### Native DeepSeek Agent Loop

Export your DeepSeek key before starting Hulala:

```bash
export DEEPSEEK_API_KEY="your-api-key"
npm run dev
```

Harness also supports its normal credential/settings layers. `DEEPSEEK_BASE_URL` can override the public DeepSeek endpoint when required.

## Using the workbench

1. Choose or add a Workspace. On startup, Hulala restores the last valid Workspace; otherwise it creates `~/.config/hulala/workspace` using the operating system's home directory.
2. Select **Pi**, **DeepSeek**, **Codex**, or **Claude Code** in the composer.
3. Select an available model and provider.
4. Select a Thinking level when the model exposes one.
5. Choose the Workspace access/approval mode and send your prompt.
6. Answer tool or permission requests in the Harness UI when the Agent asks.

Runtime, provider, model, and reasoning provenance are kept separately in assistant records so the source remains clear when work is replayed.

## Network proxy and Clash

Open **Settings → Proxy**:

- **Auto** (default) checks `HULALA_PROXY`, then `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY` and their lowercase variants. On macOS, it also detects the current system HTTP/HTTPS proxy, including a Clash system proxy.
- **Manual** uses the `http://` or `https://` proxy URL entered in the UI and overrides automatic detection. Example: `http://127.0.0.1:7897`.
- **Off** forces direct connections and removes inherited proxy variables from Agent child processes.

Changes apply to subsequent requests without restarting Harness. `NO_PROXY`/`no_proxy` is preserved. Proxy passwords are treated as write-only secrets and are never returned to the browser. SOCKS and PAC URLs are not supported yet; use the HTTP or mixed port exposed by Clash.

## Development

```bash
npm run dev        # DeepSeek Harness + Vite HMR; Pi is the default Agent
npm start          # build plugins and run Harness without Vite
npm run build      # build all Agent plugins and validate the Harness profile
npm test           # run unit and integration tests with fake/local providers
npm run typecheck  # strict TypeScript checks
npm run check      # vendor checks + tests + typecheck + production build
```

The generated Harness patch uses checkout-relative file URLs, so the repository can be cloned into any directory, including paths containing spaces. Host-side TypeScript changes require restarting Harness; changes to `packages/agent-loop-selector/src/client.ts` are hot-replaced by Vite.

## Architecture

```text
DeepSeek Harness Web + Cordis
└── agent-loop-runtime (transactional Loader entry)
    ├── Pi Agent Loop          — direct Pi TypeScript SDK
    ├── DeepSeek Agent Loop    — original Harness plugin
    ├── Codex Agent Loop       — codex app-server protocol
    └── Claude Code Agent Loop — Claude Agent SDK
```

```text
apps/harness-web/              portable Harness profile and local launcher
packages/runtime/              Bun lifecycle wrapper and portable Runtime bundles
packages/agent-loop-selector/  runtime/model/Thinking controls and Loader switch
packages/agent-loop-pi/        Pi SDK AgentFactory and Harness event bridge
packages/agent-loop-codex/     Codex app-server AgentFactory
packages/agent-loop-claude/    Claude Agent SDK AgentFactory
packages/network-proxy/        process-wide proxy service and Settings UI
```

The older event-sourced Loop prototype remains parked under `apps/web` and `packages/core`; it is not the default product surface and is not part of the current development focus.

## Security and privacy

- The workbench runs locally and does not proxy Agent traffic through a Hulala cloud service.
- Runtime credentials remain in their native local stores or environment variables.
- Credential APIs expose status and safe model metadata, never raw secret values.
- Tool execution and network access still depend on the selected Agent and the approval mode you choose.

## Built on

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — the plugin-first Agent harness and Web workbench foundation
- [Pi Coding Agent](https://github.com/earendil-works/pi) — the default multi-provider coding Agent runtime
- [OpenAI Codex](https://github.com/openai/codex) — Codex CLI and app-server protocol
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) — Claude Code and the Claude Agent SDK

## Contributing

Issues and pull requests are welcome. Please run `npm run check` before opening a pull request and keep new Agent integrations inside the native DeepSeek Harness/Cordis Agent Loop plugin boundary.

## License status

The project owner has not selected a license for Hulala yet. Until a `LICENSE` file is added, do not assume reuse or redistribution rights beyond applicable copyright law. Third-party components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Hulala is an independent project and is not affiliated with DeepSeek, OpenAI, Anthropic, or the Pi maintainers.
