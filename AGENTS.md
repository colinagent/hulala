# Loop with AI Repository Rules

## Read First

- This file is the source of truth for the public/private product boundary.
- **Current phase scope is the local DeepSeek Harness workbench and its local
  Agent Loop plugins.** The older Loop Core/Local Web prototype is parked and
  must not be expanded unless the product owner reopens that work.
- Do not design or implement Desktop, OpenBrain integration, Cloud, sync,
  accounts, billing, multi-tenancy, hosted runtimes, Telegram/channel gateways,
  teams, marketplace, or enterprise features in the current phase.
- Do not add speculative interfaces, packages, configuration, feature flags, or
  abstractions for those excluded products. Build only what Core and Local Web
  need now.
- Before adding or moving code, classify it using the public/private boundary below.
- If ownership is unclear, keep the work private and ask the product owner. Never
  publish first and clean it up later.
- Do not copy code, configuration, documentation, prompts, schemas, or operational
  details from a private repository into this repository without explicit approval.

## Repository Boundary

This public repository contains the local Harness workbench, its Agent Loop
plugins, and the parked Loop prototype. Private product repositories, internal
documents, unrelated applications, and machine-specific source trees are out
of scope. Do not name, import, or depend on them here.

The public GitHub URL is <https://github.com/colinagent/hulala>.

## License Status

- The product owner has decided that Loop Core and Local Web will be open
  source, but has **not yet selected the exact open-source license**.
- Do not add, change, or assume a license until the product owner makes that
  decision explicitly.
- Before importing third-party code, record its license and confirm that it is
  compatible with the license eventually chosen for this repository.
- Vendored DeepSeek Harness and Cordis packages are MIT. Their licenses are
  kept next to the source and summarized in `THIRD_PARTY_NOTICES.md`.
- Do not call a custom commercial or source-available license “open source.”

## What Is Open Source

Only the following local product surfaces belong in this repository:

### Harness Workbench

- DeepSeek Harness Web as the default local interface.
- Agent Loop plugins built on Harness `AgentFactory` and Cordis Loader entry
  replacement.
- Direct local SDK integrations for Pi, Codex and Claude Code, with their
  native tools, approvals, settings, skills/extensions and MCP configuration.
- Local runtime/model selection. Do not route these through a hosted gateway
  or use ACP as the primary integration.

### Loop Core

- The general Loop domain model: objective function, world model, feedback loop,
  budget bandwidth, contracts, cycles, evidence, decisions, revisions, and events.
- Local-first state machines, schemas, migrations, validation, and import/export.
- Local execution interfaces needed to run a Loop on the user's own machine.
- The old AgentDriver path is legacy prototype code. Do not extend it for the
  Harness workbench; new runtimes belong in Agent Loop plugins.
- Tests and public documentation for the above behavior.

### Local Web

- The local Web UI served from the user's machine and backed by Loop Core.
- Single-user local workflows for creating, running, reviewing, and exporting
  Loops.
- Local settings for user-owned model credentials, local models, Agent runtimes,
  and local data paths.
- Public build, development, packaging, and self-hosting instructions required to
  run the local product.

The public repository must remain independently usable without the private cloud.
Local user data must not require a Loop account, subscription, or proprietary
server to remain readable and exportable.

## Out of Current Scope — Do Not Build

The following are not part of the current product phase. Do not implement them
in this repository **or in another repository** unless the product owner starts
a new phase explicitly:

- Loop Cloud control plane, account system, organizations, multi-tenancy, hosted
  database, cloud sync service, remote access, and administrative consoles.
- Billing, pricing, subscriptions, entitlements, quotas, credits, settlement,
  fraud controls, and payment-provider integrations.
- Hosted Agent / dsh provisioning, runtime pools, wake/sleep orchestration, managed
  Sandboxes/Computers, capacity management, and cloud cost controls.
- Shared Telegram or other messaging gateways, hosted webhooks, channel routing,
  abuse prevention, and managed notification infrastructure.
- Managed LiteLLM deployment, platform model keys, provider contracts, commercial
  routing policy, margins, internal model catalogs, and managed model credits.
- Production deployment topology, hostnames, cloud accounts, credentials, secret
  layout, observability, incident response, release procedures, and internal
  runbooks.
- Proprietary Packs, enterprise features, RBAC, SSO, compliance controls, audit
  administration, marketplace settlement, and customer-specific integrations.
- Internal PRDs, financial models, unreleased strategy, customer information, and
  security-sensitive implementation details.

Do not pre-build neutral extension interfaces for these capabilities. Premature
abstractions are also out of scope.

## Desktop Boundary

- Do not build a separate Loop Desktop application.
- Loop's standalone public interface is the local Web application in this
  repository.
- Do not implement an integration inside another desktop product during the
  current phase.
- Another product's renderer/main-process code, private server, packaging,
  signing, update, and release infrastructure are proprietary. Never copy them
  into this repository.

## Naming

- **Loop Core**: open-source domain model and local runtime.
- **Loop Local Web**: open-source browser UI served locally.

Do not introduce product names for excluded surfaces in implementation code.

## Safety Checks Before Every Public Change

1. Confirm the change is necessary for Core or local Web to work independently.
2. Confirm the change does not create Desktop, Cloud, channel, billing,
   multi-tenant, or remote-runner code, including speculative abstractions.
3. Search for secrets, private URLs, tenant identifiers, pricing logic, internal
   model/provider details, and deployment information.
4. Confirm the change does not import or depend on private repository source.
5. Keep all local data formats documented and exportable.
6. Run relevant tests and review `git diff` before committing.
7. Do not push, publish packages, create releases, or deploy unless the user asks
   explicitly.
