# Vendored packages

This directory is a source-vendored snapshot of DeepSeek Harness and the Cordis
stack it already vendors. Loop copies the source in-tree instead of depending
on npm, so the harness layer is auditable, patchable, and pinned.

All package names are rescoped from `@deepseek-ai/*` to `@loopwithai/*` so a
future publish cannot squat the upstream registry names. Directory names and
upstream version numbers are unchanged.

Upstream checkout: `~/code/refs/deepseek-harness`  
Upstream commit: `47f943859b`  
Upstream license: MIT (DeepSeek, 2026; Cordis packages also MIT, Shigma)

## Cordis stack (`vendor/cordis/`)

| Directory | npm name | Upstream name | Version |
|---|---|---|---|
| `cosmokit/` | `@loopwithai/cosmokit` | `cosmokit` / `@deepseek-ai/cosmokit` | 1.8.2 |
| `schemastery/` | `@loopwithai/schemastery` | `schemastery` / `@deepseek-ai/schemastery` | 3.18.1 |
| `cordis/` | `@loopwithai/cordis` | `cordis` / `@deepseek-ai/cordis` | 4.0.1 |
| `loader/` | `@loopwithai/cordis-plugin-loader` | `@cordisjs/plugin-loader` | 1.0.0-rc.5 |
| `include/` | `@loopwithai/cordis-plugin-include` | `@cordisjs/plugin-include` | 1.0.4 |
| `group/` | `@loopwithai/cordis-plugin-group` | `@cordisjs/plugin-group` | 1.0.0 |
| `timer/` | `@loopwithai/cordis-plugin-timer` | `@cordisjs/plugin-timer` | 1.1.2 |
| `hmr/` | `@loopwithai/cordis-plugin-hmr` | `@cordisjs/plugin-hmr` | 1.0.15 |
| `logger-console/` | `@loopwithai/cordis-plugin-logger-console` | `@cordisjs/plugin-logger-console` | 1.0.0 |

## dsh cone (`vendor/dsh/`)

Seed: `session`, `system-prompt`, `llm`, `tools`, `agent`, `agent-loop`, `llm-deepseek`.  
The rest is the peer/dependency closure of that seed. Shell, sandbox, subagent, MCP, and web-search packages are intentionally excluded.

| Directory | npm name | Upstream path | Version |
|---|---|---|---|
| `agent/` | `@loopwithai/dsh-agent` | `packages/core/agent` | 0.1.0-rc.5 |
| `agent-loop/` | `@loopwithai/dsh-agent-loop` | `packages/core/agent-loop` | 0.1.0-rc.5 |
| `anonymous-user-id/` | `@loopwithai/dsh-anonymous-user-id` | `packages/identity/anonymous-user-id` | 0.1.0-rc.5 |
| `attachment/` | `@loopwithai/dsh-attachment` | `packages/attachment/attachment` | 0.1.0-rc.5 |
| `brand/` | `@loopwithai/dsh-brand` | `packages/util/brand` | 0.1.0-rc.5 |
| `code-runtime/` | `@loopwithai/dsh-code-runtime` | `packages/code-runtime/code-runtime` | 0.1.0-rc.5 |
| `credentials/` | `@loopwithai/dsh-credentials` | `packages/credentials/credentials` | 0.1.0-rc.5 |
| `home-paths/` | `@loopwithai/dsh-home-paths` | `packages/util/home-paths` | 0.1.0-rc.5 |
| `invariants/` | `@loopwithai/dsh-invariants` | `packages/runtime-diagnostics/invariants` | 0.1.0-rc.5 |
| `launch-environment/` | `@loopwithai/dsh-launch-environment` | `packages/util/launch-environment` | 0.1.0-rc.5 |
| `llm/` | `@loopwithai/dsh-llm` | `packages/llm/llm` | 0.1.0-rc.5 |
| `llm-deepseek/` | `@loopwithai/dsh-llm-deepseek` | `packages/llm/llm-deepseek` | 0.1.0-rc.5 |
| `scope/` | `@loopwithai/dsh-scope` | `packages/core/scope` | 0.1.0-rc.5 |
| `session/` | `@loopwithai/dsh-session` | `packages/core/session` | 0.1.0-rc.5 |
| `session-persistence/` | `@loopwithai/dsh-session-persistence` | `packages/session/session-persistence` | 0.1.0-rc.5 |
| `settings/` | `@loopwithai/dsh-settings` | `packages/settings/settings` | 0.1.0-rc.5 |
| `system-prompt/` | `@loopwithai/dsh-system-prompt` | `packages/core/system-prompt` | 0.1.0-rc.5 |
| `timeout/` | `@loopwithai/dsh-timeout` | `packages/util/timeout` | 0.1.0-rc.5 |
| `tools/` | `@loopwithai/dsh-tools` | `packages/core/tools` | 0.1.0-rc.5 |
| `protocol/` | `@loopwithai/dsh-typert-protocol` | `packages/typert/protocol` | 0.1.0-rc.5 |
| `user-approval/` | `@loopwithai/dsh-user-approval` | `packages/interaction/user-approval` | 0.1.0-rc.5 |

Third-party runtime deps stay on npm (`@standard-schema/spec`, `js-yaml`, `chokidar`, `eventsource-parser`, and whatever else each package.json already names).

## Local modifications

1. Every `package.json` is rescoped `@deepseek-ai/*` → `@loopwithai/*` and marked `private: true`. pnpm `workspace:^` ranges were rewritten to `*` so npm workspaces can resolve them.
2. Package `main` / `types` / `exports["."]` point at `src/index.ts` so the Loop workspace can load source without dsh's tsdown pipeline.
3. Tests, tsdown configs, and built `lib/` were not copied. Upstream uses `.ts` import specifiers, so there is no `lib/` emit. `build:vendor` loads a Cordis `Context` through `tsx` as a smoke check. `tsconfig.vendor.json` is a relaxed reference config for the two packages the driver imports (`cordis`, `cosmokit`); the rest of the cone is source-pinned for a later Loader composition. Next only transpiles those two packages. `@loopwithai/cordis` exposes `loop-shim.d.ts` as its types entry so Loop Web's strict typecheck does not ingest Shigma's source.
4. Source specifiers that named `@deepseek-ai/cordis`, `@deepseek-ai/dsh-*`, and the other scoped workspace packages were rewritten to `@loopwithai/*`.
5. Missing-cone workspace refs were dropped from `devDependencies`: `dsh-session-persistence-jsonl` (agent-loop) and `dsh-typert-registry` (agent, session).
6. `DshAgentDriver` currently boots a Cordis `Context`, tracks the request with `ctx.effect`, and calls DeepSeek chat-completions directly. `apps/web/cordis.yml` is the intended seed roster for a later Loader + `agent-loop` composition; settings, credentials, and persistence providers are not wired yet.

## How to update

1. Update the local dsh clone and note the new commit SHA.
2. Recopy the directories listed above from `~/code/refs/deepseek-harness`.
3. Re-run the rescope (`@deepseek-ai` workspace names → `@loopwithai`).
4. Rewrite `workspace:^` to `*` and drop workspace refs that are outside this cone.
5. Refresh this table and the local-modification log.
6. Run `npm install` and `npm run check`.
