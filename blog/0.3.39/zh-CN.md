---
slug: plugin-installed-but-not-loaded
title: 插件装上了，Host 却没有加载它
description: Hulala 0.3.39 会告诉你正在运行的 Host 到底加载了哪些插件，启动时自动修复失效的插件链接，并且在你装完插件后说清有没有生效。
date: 2026-11-27
version: 0.3.39
---

插件是在 Host 进程启动时加载的，不是安装时加载的。如果你正在用的那个进程在安装完成之前就已经起来，它会一直用它当时 import 的那一份。0.3.39 把这件事变成可读的事实：欢迎块、`hulala host status` 都会给出运行中的组成，并且修好了一种能让插件永久消失的失效链接。

## 装是装完了，进程没换

插件安装只写磁盘上的 profile，Host 在启动时读一次并 import。之后没有任何东西会再读它。于是"装上了"和"加载了"是两个事实，而在此之前只有第一个能被观察到：`hulala plugin list` 读的也是磁盘上的 manifest。

我们是在更新一个聊天机器人插件时撞上的。包在 22:06:01 落到 `node_modules`，正在服务的 Host 在 22:05:20 启动，比它早 41 秒。磁盘上一切写着 0.3.24，实际应答的是 0.3.23。更麻烦的是，"从客户端启动 Host"在发现已经有一个在跑时，打印的 status 和真的启动一个是同一份 JSON，所以输出里没有任何线索。

0.3.39 补上的是那个缺失的事实：Host 每次回应健康检查都读一遍活着的 Loader，报出它手里真实的组成。

```sh
hulala host status
```

如果有声明了却没激活的条目，这个文档会多一个 `degraded` 列表；`hulala host start` 也会说清它启动了一个 Host，还是发现已经有一个在跑：

```
hulala: the Host was already running (pid 96269, started 2026-11-27T14:55:55.596Z); nothing was started.
```

## 欢迎块里的那三行

开一个新会话，你会先看到 banner，然后是技能与 MCP 列表。现在 banner 下面、这两个列表上面，多了一个 `[Problems]` 段：每个"声明了但没起来"的条目占一行，带包名、版本和 Loader 状态。

```
[Problems]
  @colinagent/dsh-mcp@0.1.1 (failed)
[Skills]
  release-hulala
```

组成完整时它不出现；老版本 Host 报不出组成时它也不出现，所以正常启动看起来和以前完全一样。位置是有意选的：MCP 列表是一个承诺，正准备依赖它的人应该先看到哪个承诺没兑现。

给脚本用的入口是：

```sh
hulala doctor
# … "problems": [], "warnings": []
# hulala doctor: ok
```

它检查 profile 里每个链接、运行中 Host 的组成、以及任何没激活的条目，有问题时非零退出；老 Host 报不出组成只算 `warning`，不算失败。

## 消失了八天的插件

这次发布的另一半是修复。Host 自带的 bundle 用 `link:` 挂进 profile，指向发布包里那一份。升级只保留当前和上一个 runtime，其余删除，于是 profile 里的符号链接指向了一个已经不存在的目录。

启动时的重新链接逻辑本来就有，但它先问错了问题：这个路径存在吗。悬空符号链接让这个答案是"不存在"，而路径实际上还被占着，于是创建新链接报 `EEXIST`，错误被吞掉，manifest 继续留着那条死链。Host 照常启动，Telegram 上的 bot 照常应答，MCP 工具却没了。八天、九次启动，只留下这一行：

```
dsh: warning: 1 entry did not activate
```

现在修复逻辑比较的是链接目标和 runtime 实际发布的那份，不一致就替换掉。任何一次启动都会修好（包括升级后的那一次），同一趟还会把 manifest 里过期的 `link:` 改写成当前路径。我们两个方向都验过：把链接改坏、启动 Host、`hulala doctor` 干净。

## 装完会告诉你有没有生效

`hulala plugin --profile tui add <包>` 还是那个安装命令，变的是最后一行。如果有 Host 在跑，命令会把它加载的和你刚装的比一次：

```
hulala: @colinagent/hulala-bot is installed but not loaded in the running Host (pid 96269); that Host started before it.
hulala: restart the Host to load it (`hulala host stop && hulala host start`), or pass --restart next time.
```

退出码仍然是 0，因为安装确实成功了。重启是另一个承诺，所以它有自己的开关：`--restart` 会停掉、重启、把组成读回来，你指定的包仍然没激活才非零退出。这两件事必须分开：一个"装成功了却报失败"的命令，只会训练人忽略退出码。

建议也按原因分开了。组成里根本没有这个包的行，说明那个进程启动得比安装早，重启有用；行在，状态是 `failed` 或 `skipped`，说明插件试过了没起来，消息会指向 Host 日志，而不是让你把已经做过的事再做一遍。

## 还没做到的

组成清单最多 128 行，完整的 Host 大约 200 行；失败的条目排在最前，我们自己的 `@colinagent/*` 永远在内，所以读这份清单的客户端不会被要求渲染整棵树。用 git 地址或 tarball 装的插件无法这样验证，因为 spec 里没有包名；`link:` 路径和 registry 包名可以。

这里报的都是启动期的问题。插件激活之后中途挂掉，目前仍然只是一行日志；这一周我们在 bot 上关掉了其中一个：没配任何渠道的 bot 现在会让激活失败，而不是打一行日志、状态假装健康。

客户端只在会话开始时显示这一段。会话开着的时候装插件，最快的答案是 `hulala doctor`；下一个会话会在欢迎块里写出来。

[安装或更新 Hulala](/download/)，或者读[上一个版本关于输入法的说明](/blog/terminal-stops-switching-input-method/)。
