<div align="center">
  <img src="assets/brand/hulala-logo.svg" alt="Hulala 纸风车 Logo" width="128" />
  <h1>Hulala</h1>
  <p><strong>呼啦啦，你的成长飞轮。</strong></p>
  <p><strong>阅读、写作、编程，持续前行。</strong></p>
  <p>面向长期本地实践的开源 DeepSeek Harness Runtime 与原生 Agent Loop 插件。</p>
  <p>
    <a href="README.md">English</a>
    ·
    <a href="https://hulala.ai/zh-CN/">官网</a>
    ·
    <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a>
    ·
    <a href="#快速开始">快速开始</a>
  </p>
  <p>
    <img alt="DeepSeek Harness" src="https://img.shields.io/badge/DeepSeek-Harness-4D6BFE" />
    <img alt="Node.js 24+" src="https://img.shields.io/badge/Node.js-24%2B-339933?logo=nodedotjs&logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5B5BD6?logo=typescript&logoColor=white" />
    <img alt="本地优先" src="https://img.shields.io/badge/Local--first-111827" />
  </p>
</div>

Hulala 是一个面向长期实践的开源、本地优先 AI 工作台。它把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 扩展成一处连续工作的空间：阅读上下文形成输入，写作让思考变得清晰，编程再把想法变成真实成果；凭据和会话不需要经过托管网关。

这个仓库公开 Harness Workbench、Runtime 与原生 Agent Loop 插件。它保留 Harness 原生的 Cordis 插件体系，把 Agent Loop 做成可替换插件，因此可以在 **Pi Coding Agent**、**OpenAI Codex**、**Claude Code** 和 **DeepSeek 原生 Agent Loop** 之间切换，不需要额外的 ACP 网关或另一套 Driver。

默认 Agent 是 Pi。每套运行时仍然使用自己的模型、工具、审批、MCP、Skills/Extensions 和本地认证。

> DeepSeek Harness 目前仍处于 Developer Preview。Hulala 紧贴其插件 API，上游出现不兼容更新时可能需要同步升级。

## 成长飞轮

```text
阅读 → 写作 → 编程 → 复盘 → 再来一次
```

Hulala 关注连续积累，而不是一次性的 Prompt。阅读 Workspace 与历史，写下推理，把想法做成代码，检查真实证据，再让结果成为下一轮的上下文。工作始终保存在本地、可以检查，并与产生它的 Workspace 保持连接，成长飞轮因此能够持续复利。

## 主要能力

- **一个 Harness，多套 Agent**：直接在输入框下方切换 Pi、DeepSeek、Codex 和 Claude Code。
- **原生接入**：Pi 直连 TypeScript SDK，Codex 使用 `codex app-server`，Claude Code 使用 Agent SDK，DeepSeek 保留原始 Harness Agent Loop。
- **模型与 Thinking 控制**：每次对话都能在输入区选择 Provider、模型和模型支持的思考级别。
- **选择记忆**：成功选择 Runtime、模型或 Thinking 后会成为下一次新会话的用户默认值，并在本地 Runtime 重启后恢复。
- **不阉割工具**：保留各 Agent 支持的 read、bash、edit、write、项目指令、Skills、Extensions、MCP 和审批能力。
- **本地认证与会话**：凭据仍由 Pi、Codex、Claude Code 或系统环境管理，不经过 Hulala 托管网关。
- **工作区自动恢复**：启动时自动打开上一次工作区；首次使用默认创建 `~/.config/hulala/workspace`。
- **Clash/代理支持**：支持终端环境变量、macOS 系统代理、手动 HTTP 代理和强制直连。
- **Vite HMR**：开发输入区控件时可以热更新，无需反复重启 Harness。

## 支持的 Agent

| Agent | 接入方式 | 登录方式 | 保留的原生能力 |
| --- | --- | --- | --- |
| **Pi**（默认） | `@earendil-works/pi-coding-agent` SDK | Accounts、`pi /login` 或 `~/.pi/agent` | 多 Provider/模型、工具、Skills、Extensions、会话、Thinking |
| **DeepSeek** | 原始 `@deepseek-ai/dsh-agent-loop` | `DEEPSEEK_API_KEY` 和 Harness 原生设置 | 原生 Agent Loop 与 DeepSeek 模型 |
| **OpenAI Codex** | `codex app-server --stdio` | 已有的 `codex login` 会话 | 工具、MCP、Sandbox、审批、线程、模型、Reasoning Effort |
| **Claude Code** | `@anthropic-ai/claude-agent-sdk` | 已有 Claude Code 登录或 Anthropic 环境变量 | Claude Code 工具预设、Settings、Skills、Plugins、MCP、权限审批 |

Hulala 通过 Cordis Loader 事务性替换进程内唯一的 Agent Loop。空白会话可以直接切换；会话已有历史时，界面会先确认，再在同一 Workspace 中新建会话，避免用户误以为历史会话中途更换了 Agent。

## 快速开始

环境要求：

- Node.js 24 或更高版本
- npm 和 Git
- 至少配置好一套想使用的 Agent 凭据

克隆、安装、启动：

```bash
git clone https://github.com/colinagent/hulala.git
cd hulala
npm install
npm run dev
```

也可以一条命令完成：

```bash
git clone https://github.com/colinagent/hulala.git && cd hulala && npm install && npm run dev
```

浏览器打开 [http://127.0.0.1:3210](http://127.0.0.1:3210)。开发模式还会在 `5174` 端口启动 Vite HMR。

不启动 Vite、以本地生产方式运行：

```bash
npm start
```

## 登录与认证

### Pi

在输入区选择 **Pi**，再点击 **Accounts**。Web 登录支持 Pi 暴露的 OAuth Provider，包括 ChatGPT/OpenAI Codex 与 Anthropic。也可以在终端登录：

```bash
pi
# 然后输入 /login
```

Pi 的配置与凭据仍由 Pi 保存在 `~/.pi/agent`；Hulala 不会把原始 Token 返回浏览器。

### OpenAI Codex

安装并登录官方 [OpenAI Codex CLI](https://github.com/openai/codex)，然后在 Hulala 中选择 **Codex**：

```bash
npm install -g @openai/codex
codex login
```

需要时 Hulala 会启动 `codex app-server --stdio`，并复用 Codex CLI 已有的本地登录。只有当 `codex` 不在 `PATH` 中时才需要设置 `CODEX_BINARY`。

### Claude Code

按 [Claude Code](https://docs.anthropic.com/en/docs/claude-code/getting-started) 的正常方式完成认证，再选择 **Claude Code**：

```bash
npm install -g @anthropic-ai/claude-code
claude
```

运行时使用 Claude Agent SDK 和原有 Claude Code Settings；标准 Anthropic 环境凭据也仍然有效。

### DeepSeek 原生 Agent Loop

启动前配置 DeepSeek Key：

```bash
export DEEPSEEK_API_KEY="your-api-key"
npm run dev
```

也可以继续使用 Harness 自己的凭据与 Settings 层；需要自定义服务地址时可设置 `DEEPSEEK_BASE_URL`。

## 使用方法

1. 选择或添加 Workspace。启动时优先恢复上次有效工作区，否则使用操作系统用户目录下的 `~/.config/hulala/workspace`。
2. 在输入框下方选择 **Pi**、**DeepSeek**、**Codex** 或 **Claude Code**。
3. 选择可用的模型与 Provider。
4. 如果模型支持，选择 Thinking Level。
5. 选择 Workspace 访问/审批模式，然后发送任务。
6. Agent 请求工具或权限时，在 Harness UI 中完成确认。

助手记录会分别保存 runtime、provider、model 和 reasoning 来源，回放历史时仍能确认回复来自哪套 Agent。

## Clash 与全局代理

打开 **Settings → Proxy**：

- **Auto**（默认）：依次读取 `HULALA_PROXY`、`HTTPS_PROXY`、`HTTP_PROXY`、`ALL_PROXY` 及其小写形式；macOS 下还会读取当前系统 HTTP/HTTPS 代理，因此 Clash 开启系统代理后可以自动生效。
- **Manual**：使用页面填写的 `http://` 或 `https://` 地址，并覆盖自动检测。例如 `http://127.0.0.1:7897`。
- **Off**：强制直连，并从 Agent 子进程环境中移除继承的代理变量。

保存后会立即影响后续请求，无需重启 Harness。自动和手动模式保留 `NO_PROXY`/`no_proxy`。带密码的代理地址按只写 Secret 处理，不会由 API 返回浏览器。首版暂不支持 SOCKS/PAC，请使用 Clash 暴露的 HTTP 或 Mixed 端口。

## 开发命令

```bash
npm run dev        # DeepSeek Harness + Vite HMR，默认 Pi
npm start          # 构建插件后启动 Harness，不启动 Vite
npm run build      # 构建全部 Agent 插件并校验 Harness Profile
npm test           # 使用 Fake/本地 Provider 运行测试
npm run typecheck  # 严格 TypeScript 检查
npm run check      # Vendor 检查 + 测试 + 类型检查 + 生产构建
```

Harness Patch 在启动时根据当前仓库位置生成 `file:` URL，所以可以把项目克隆到任意目录，包括带空格的跨平台路径。服务端 TypeScript 代码修改后仍需重启 Harness；`packages/agent-loop-selector/src/client.ts` 由 Vite 热更新。

## 架构

```text
DeepSeek Harness Web + Cordis
└── agent-loop-runtime（事务性 Loader Entry）
    ├── Pi Agent Loop          — Pi TypeScript SDK
    ├── DeepSeek Agent Loop    — Harness 原始插件
    ├── Codex Agent Loop       — codex app-server 协议
    └── Claude Code Agent Loop — Claude Agent SDK
```

```text
apps/harness-web/              可移植 Harness Profile 与本地启动器
packages/agent-loop-selector/  Runtime/Model/Thinking 控件与 Loader 切换
packages/agent-loop-pi/        Pi SDK AgentFactory 与 Harness 事件桥接
packages/agent-loop-codex/     Codex app-server AgentFactory
packages/agent-loop-claude/    Claude Agent SDK AgentFactory
packages/network-proxy/        进程级代理服务与 Settings UI
```

旧的事件溯源 Loop 原型保留在 `apps/web` 和 `packages/core`，但它不是默认产品入口，也不属于当前开发重点。

## 安全与隐私

- 工作台在本机运行，不会通过 Hulala 云服务转发 Agent 请求。
- 凭据继续保存在各 Agent 的原生本地存储或环境变量中。
- 凭据接口只提供登录状态和安全模型元数据，不返回 Secret。
- 工具执行和网络权限仍取决于所选 Agent 以及用户选择的审批模式。

## 基于以下项目

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：插件优先的 Agent Harness 与 Web 工作台基础
- [Pi Coding Agent](https://github.com/earendil-works/pi)：默认的多 Provider 编程 Agent 运行时
- [OpenAI Codex](https://github.com/openai/codex)：Codex CLI 与 app-server 协议
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)：Claude Code 与 Claude Agent SDK

## 参与贡献

欢迎提交 Issue 和 Pull Request。提交前请运行 `npm run check`，新增 Agent 也应继续遵守 DeepSeek Harness/Cordis 原生 Agent Loop 插件边界。

## License 状态

项目所有者尚未为 Hulala 选择 License。在仓库加入 `LICENSE` 之前，请勿推定拥有适用版权法以外的复用或再分发权利。第三方组件继续保留各自 License，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

Hulala 是独立项目，与 DeepSeek、OpenAI、Anthropic 及 Pi 维护者不存在隶属关系。
