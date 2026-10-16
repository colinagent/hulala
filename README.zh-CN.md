<div align="center">
  <img src="assets/brand/hulala-logo-v2.svg" alt="Hulala" width="128" />
  <h1>Hulala</h1>
  <p>在自己的电脑上，通过浏览器阅读、写作、编程，持续工作。</p>
  <p><a href="README.md">English</a> · <a href="https://hulala.ai/zh-CN/">官网</a> · <a href="docs/browser-workbench.md">Web 版说明</a></p>
</div>

Hulala 是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的开源浏览器工作台，第一方代码采用 Apache-2.0。安装后输入 `hulala`，命令会启动本地服务，等待工作台就绪，然后打开 **http://hulala.localhost:3210/**。

每个 Workspace 对应一个浏览器标签，标签标题显示文件夹名称；远端标签还显示 SSH 主机别名。同一个 Workspace 的多个页面共用 Host 和后台任务，文件编辑标签保留在页面内部。

## 工作台能力

- 文件、搜索、导入、下载、保存冲突处理与持久化草稿恢复。
- Markdown/代码编辑、PDF/EPUB/DOCX 阅读、绘图、引用面板与 PDF 导出。
- Harness 原生会话、模型选择、审批、附件、历史与 Agent Presets。
- Pi、DeepSeek、Codex 和 Claude Agent SDK，保留各自的原生工具及凭据存储。
- Host 管理的命令执行、有限输出、stdin、停止、重连与历史；Git 分支和状态。
- Cron、Messenger、归档清理与可信 Workspace 插件。
- 直接 SSH Workspace：主机指纹确认、文件和资源隔离、远端 Host 包校验。

命令面板保留现有管道命令能力，不冒称完整 PTY 交互终端。浏览器的页面缩放和标签快捷键保持原生行为。关闭页面不会取消后台工作。

## 从源码运行

使用 **Bun 1.4.2**、Git 和仓库开发工具链（Node.js 24+）。当前 Harness 锁定为 `0.1.5-rc.2`。

```sh
git clone https://github.com/colinagent/hulala.git
cd hulala
bun install --frozen-lockfile
bun run build
bun run start
```

`bun run dev` 构建并以前台方式启动浏览器工作台。`bun run dev:harness` 保留上游 Harness UI 的开发入口。`apps/web` 和 `packages/core` 中较早的 Loop 原型已经暂停扩展。

## 安装包

macOS 或 glibc Linux 一行安装 Hulala Web：

```sh
curl -fsSL https://hulala.ai/install.sh | sh
```

安装完成后重新打开终端，运行 `hulala`。安装脚本会自动识别平台并校验安装包的 SHA-256；下载中断后自动续传，官方下载源不可用或过慢时自动切换至 GitHub。[官网安装说明](https://hulala.ai/zh-CN/download/)。

下载适用于 macOS、Linux 或 Windows 的[Web 版 0.1.5](https://github.com/colinagent/hulala/releases/tag/web-v0.1.5)。使用发行页的 `SHASUMS256.txt` 校验压缩包，解压后按下方命令安装。npm 包尚未发布。完整目录、验证方法见[Web 版说明](docs/browser-workbench.md)。

从源码构建安装包：

```sh
bun run pack:workbench
bun scripts/workbench/npm-package.ts <已校验的完整包目录>
```

独立包自带 Bun、Host、Runtime、网页资源和许可证，运行时不依赖源码仓库或另外安装的 Node/Bun。在解压目录中执行：

```sh
./bin/hulala install --add-to-path
# PATH 修改后打开新终端。
hulala
```

Windows 使用 `.\bin\hulala.exe install --add-to-path`。npm 分发采用轻量主入口与精确锁定的平台包，npm/npx 需要 Node.js 18+；后台服务使用经过校验的稳定副本，不依赖随时可能被删除的 npx 缓存。

构建目标是 macOS arm64/x64、glibc Linux arm64/x64 和 Windows x64。各目标的原生结果由浏览器 CI 矩阵记录，交叉编译成功不等于实机验收通过。Windows arm64 和 musl Linux 不在当前支持声明内。

## 服务、更新与卸载

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

有运行任务或草稿时，普通重启会先拒绝并显示摘要；明确使用 `--force` 才会停止相关工作。独立安装会校验下载和完整包，在隔离状态下试启动候选版本，然后原子切换。回滚检查数据格式兼容性。npm、Bun、pnpm 安装使用各自的包管理器更新。卸载保留配置、凭据、Workspace 和会话数据。

开机启动独立且默认关闭：`hulala service install` 配置当前用户的 launchd、systemd 或任务计划程序；`hulala service uninstall` 取消它。安装程序本身不会创建开机启动、打开浏览器或留下用户服务。

## 数据与凭据

- Hulala 状态目录：`~/.config/hulala`；默认 Workspace：`~/hulala-workspace/workspace`。
- `HULALA_HOME`、`HULALA_WORKSPACE_ROOT` 接受绝对路径，用于独立状态或测试；`HULALA_PORT` 修改本地端口。
- 服务仅监听回环地址，不修改 DNS 或 hosts。浏览器使用同源 HttpOnly 会话，内部 Host token 不进入渲染器。
- Provider 认证由原生 Agent/Provider 存储负责，包括 Harness 管理的凭据仓库。源码和安装包不包含个人凭据或状态。
- Git、系统 shell、可选 Agent 外部工具和模型访问是独立能力；Codex 使用 `codex app-server`，Provider 在设置中配置。
- 插件运行可信本地代码，不是不可信代码沙箱。只安装你明确信任的插件。

## 开发检查

```sh
bun run check
bun run check:workbench
```

测试使用注入的状态/Workspace 根目录与本地模型 fixture。安装包检查覆盖 npm、npx 缓存清理、归档完整性、原生启动、升级回滚、SSH 与卸载后数据保留。

第一方代码采用 [Apache-2.0](LICENSE)。第三方组件保留各自的许可证和条款，Claude Agent SDK 不被重新许可为 Apache-2.0，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。Hulala 是独立项目，与 DeepSeek、OpenAI、Anthropic 及 Pi 维护者不存在隶属关系。
