# Loop with AI

Loop with AI is a local-first system for running evidence-based human–Agent feedback loops. It turns a small, uncertain goal into an explicit contract and guides one complete cycle:

> Human prior → Agent advice → human decision → real-world evidence → model revision

The current product is intentionally limited to two open-source parts:

- **Loop Core** — TypeScript domain model, state machine, append-only events, budget checks, prompts, and export.
- **Loop Local Web** — a TypeScript/Next.js interface and local API backed by SQLite.

There is no account, cloud service, sync, billing, multi-tenancy, desktop app, remote runner, or messaging gateway in this phase.

## Why vendored dsh

The MVP uses a **source-vendored DeepSeek Harness (dsh) cone** as its only production Agent engine. Loop owns the contract, state transitions, budgets, decisions, and evidence; dsh performs a single Agent analysis when the user explicitly requests it.

The driver starts an in-process Cordis `Context`, calls DeepSeek chat-completions, then disposes the context. Browsing, editing, reviewing, and exporting a Loop never calls the model. The browser never sees the API key.

## Architecture

```text
Browser on localhost
        │
        ▼
Loop Local Web (Next.js + TypeScript)
        │
        ├── Loop Core (pure TypeScript state machine)
        ├── SQLite event store (~/.loopwithai/loop.db)
        └── DshAgentDriver ── in-process Cordis Context ──> DeepSeek API
```

SQLite stores append-only events. The current Loop state is rebuilt from those events, and every Loop can be exported as versioned JSON.

## Run locally

Requirements:

- Node.js 24 or newer
- npm
- a DeepSeek API key only when you want Agent advice

Install and start Loop:

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:3210>. You can create and inspect Loops before a model key is configured.

To enable Agent advice, create `apps/web/.env.local`:

```dotenv
DEEPSEEK_API_KEY=replace-with-your-deepseek-api-key
# Optional. Defaults to https://api.deepseek.com
# DEEPSEEK_API_URL=https://api.deepseek.com
# Optional. Defaults to deepseek-chat
# DEEPSEEK_MODEL=deepseek-chat
```

Restart Loop after changing `.env.local`. The browser never receives this key; the Local Web server calls DeepSeek from the Node process.

To keep data somewhere other than `~/.loopwithai`, set an absolute local directory:

```dotenv
LOOP_DATA_DIR=/absolute/path/to/loop-data
```

## Development

```bash
npm run build:vendor  # typecheck the vendored Cordis / dsh cone
npm run test          # Core and Web tests
npm run typecheck     # strict TypeScript checks for Loop packages
npm run build         # production Web build
npm run check         # all of the above
```

Workspace layout:

```text
packages/core/   Framework-independent Loop domain and application service
apps/web/        Local Web UI, HTTP routes, SQLite store, DshAgentDriver
vendor/cordis/   Vendored Cordis stack, rescoped to @loopwithai
vendor/dsh/      Closed peer cone of dsh used for one advice turn
```

The Web layer may display state and collect input, but all Loop transitions belong in Core. See [AGENTS.md](./AGENTS.md) for the hard public/private and product-scope boundaries. Third-party licenses are listed in [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). Vendor update steps live in [vendor/README.md](./vendor/README.md).

## Current vertical slice

The current implementation supports:

- opening an in-memory quantitative-strategy prototype in Local Web to experience the complete human prior → independent Agent challenge → signed experiment → simulated evidence → model revision flow;
- creating a weighted objective function, falsifiable world model, bandwidth budget, and guardrails;
- recording the human's prediction before revealing Agent advice;
- requesting structured independent analysis from in-process dsh without exposing the human prior;
- requiring a human-signed decision before an experiment starts;
- recording externally observed outcomes and costs;
- revising the model and strategy, then optionally starting the next cycle;
- replaying state from SQLite events and exporting the full event stream as JSON.

Not yet included are editable contracts, evidence file attachments, import/restore, migrations, pause/resume controls, asynchronous Agent runs, independent evaluators, and calibration dashboards.

## License status

The repository is intended to be open source, but the project owner has not selected a license yet. Until a `LICENSE` file is added, do not assume permission beyond copyright law or redistribute the code as if a license had already been chosen.
