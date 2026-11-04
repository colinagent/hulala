<div align="center">
  <img src="assets/brand/hulala-logo-v2.svg" alt="Hulala" width="128" />
  <h1>Hulala</h1>
  <p>面向终端的本地优先 DeepSeek Harness 工作台。</p>
  <p><a href="README.md">English</a> · <a href="https://hulala.ai/zh-CN/">官网</a></p>
</div>

Hulala 基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)。

一台机器上一个 Host daemon 拥有一个 state root 并运行 Harness 引擎。每个终端窗口
都是连到那个进程的客户端——想开几个开几个，关掉只是断开，不会停下任何东西。正在跑
的 turn 会继续，与启动它的窗口是否还在无关。

Host 使用 DSH 原生的 `/connect` 认证、`/api` Remote 调用和 `/api/remote.mux` 事件流，
没有第二套 REST，也没有第二个 Agent Runtime。

## 客户端

**终端** —— `hulala` 连接本机 Host（没有就 detached 启动一个），打开终端客户端：

```sh
hulala                              # 终端客户端
hulala --resume <session-id>        # 继续一个已有 Session
hulala host start|stop|status       # 管理共享的 Host daemon
hulala update                       # 安装最新版本
hulala update --check               # 只看不装
```

终端内输入 `/help` 查看命令：Session、prompt、流式输出、审批、提问、模型选择和取消。

**官网** —— `apps/website` 是公开下载站，不内嵌 Agent Runtime。

## 终端客户端是一个插件宿主

一个窗口就是一个 Cordis `Context`。kernel（`apps/cli/src/tui/kernel.ts`）只拥有
`Context` 本身和它的销毁；其余每个功能都是 `apps/cli/src/tui/plugins/` 下的插件：

```text
kernel            Context 创建、插件装载、销毁
lifecycle         关闭标志
viewModel         Host 事件折成 transcript 条目
terminal          终端设备、屏幕、键位表
render            帧循环与它的同步步
layout            帧：七个座位、列宽、焦点
editor            内置编辑器：发布、环境、标记文件
panes             右列：pty 里的一个程序
composer          输入行，以及选择器借用那个 dock 槽
overlays          审批、提问、选择器、键盘持有
session           打开的 Session、它的目录、模型和 follow 流
rail              Session 列表列
view              transcript 与 dock 各行
commands          斜杠命令与 prompt 投递
input             唯一的输入管线
update            版本提示与换版
user              用户插件的装载器
```

座位是封闭集合——`main`、`dock.pending`、`dock.cwd`、`dock.input`、`dock.status`、
`rail`、`pane`——而且座位只声明**内容，永远不声明几何**。列宽、最小值和窄终端规则
都留在帧那边。

因为客户端就是这些插件拼出来的，一个功能可以换掉而不碰邻居，故障也是隔离的：某个
插件无法激活、或者它的 `render` 抛错，代价只是它自己那几行。

### 自己写插件

一个插件就是一个目录里一个普通的 `.mjs`。它不 import 任何东西——整个 API 作为
`activate` 的参数传进来——所以不需要构建步骤，也不需要 `node_modules`。

```sh
hulala plugin new hello      # 写入 ~/.hulala/config/plugins/hello/
hulala plugin check hello    # 校验它，并渲染它注册的每一个座位
hulala plugin list           # 装了什么，哪些被关掉了
hulala plugin disable hello  # 停止加载，但不删除
```

```js
/** @param {import('@hulala/plugin-sdk').PluginApi} tui */
export function activate(tui) {
  tui.command('hello', '打个招呼', () => { tui.notice('hello') })
  return tui.seat('dock.status', { id: 'hello' }, {
    render: width => [`hello from ${width} columns`],
  })
}
```

契约在 `packages/tui-plugin`，并且**只增不减**：同一 API 版本内可以加字段，不会改变
已有字段的含义。目标 API 版本超出客户端实现的插件，会在加载时按名字被拒绝，消息里
带着两个版本号。

没有沙箱。插件是普通的 ESM，拿着客户端自己的权限。只从你会直接运行的来源安装。

## Creator mode

默认关闭。打开之后，Host 会多一份自己 Cordis 面的只读视图，agent 拿到检查它的工具
——于是 agent 可以给你的终端客户端写插件。

```sh
hulala creator on     # 然后 hulala host stop，让 Host 带着它重启
hulala creator status
hulala creator off    # 把这项能力从组合里移除
```

开关是 `<state root>/config/creator.json`。关掉时会从已有 profile 里删掉那些行——
能力是消失，不是闲置。

## 安装

```sh
curl -fsSL https://hulala.ai/install.sh | sh
```

支持 `darwin-arm64`、`darwin-x64`、`linux-x64`、`linux-arm64`。Windows 尚未实现。
机器需要 Node.js 22.13+；不需要 Neovim，因为包里自带一个。

发布包是自包含的 Node 安装：

```text
hulala-<version>-<target>/
  bin/hulala                 Node CLI 与终端客户端
  bin/nvim                   内置 Neovim（runtime tree 在 runtime/editor/ 下）
  bin/ime                    macOS 输入法辅助（仅 darwin 目标）
  server/hulala-host.mjs     Host wrapper
  runtime/host.mjs           编译后的 Host
  runtime/node_modules/      DeepSeek Harness 引擎
  runtime/editor/            Neovim runtime、tree-sitter parsers、snacks.nvim
  manifest.json
```

包里每个二进制都是真正的文件，绝不是软链：安装器把它们复制进 `$HULALA_HOME/bin`，
升级后第一次打开编辑器时客户端会再发布一次（编辑器的运行数据落在
`$HULALA_HOME/runtime/editor/`）。`rg` 也用同样方式从 Harness 自己为 `grep` 工具装的
`@vscode/ripgrep` 发布出来，所以编辑器的 picker、以及模型通过 `bash` 跑的任何东西都
不需要机器上装了 ripgrep；那个目录是**追加**到子进程 `PATH` 的，所以已安装的 `rg`
仍然优先。

`Ctrl+T` 打开内置终端——Session 目录下的用户 shell；`Ctrl+F` 打开编辑器列。macOS 上
编辑器获得焦点时输入法切到英文，焦点回到 composer 时切回去。`Ctrl-[` 回到 composer
但不关列，列隐藏时进程保留，所以 shell 作业和 Neovim 缓冲区都还在。详见
`apps/cli/README.md`。

## 从源码运行

使用 Bun 1.4.2 和 Node.js 24+。Host 运行在 Node 上，因为 DeepSeek Harness 通过 Node
内部模块加载器启动。

```sh
git clone https://github.com/colinagent/hulala.git
cd hulala
bun install --frozen-lockfile
bun run build
bun run start
```

常用命令：

```sh
bun run check           # check:patches → typecheck → test → build
bun run check:patches   # 证明每个 patchedDependencies 条目确实被应用
bun run typecheck
bun run test
bun run host:build
bun run website:build
```

`check:patches` 排第一是刻意的。`patchedDependencies` 的键是**精确版本号**；键对不上时
bun 会静默忽略补丁，产物里装的是没打补丁的上游文件。这个检查断言已装版本与键一致，
并且补丁新增的每一行都在已装文件里。

## 目录

```text
apps/cli       终端客户端、插件宿主、程序生命周期
apps/server    Hulala Host daemon 壳（DSH webServer + connection）
apps/website   官网和下载元数据
packages/runtime             DSH 组合（一个原生 Agent Loop）
packages/host-client         发现、detached 启动、共享客户端契约
packages/desktop-contracts   Host/client 线协议与 state root 路径
packages/tui-plugin          终端客户端插件契约
packages/distribution        安装、更新与回滚
```

## 许可证

Hulala 第一方代码采用 GPL-3.0-only。第三方组件保留各自许可证，见
`THIRD_PARTY_NOTICES.md`。
