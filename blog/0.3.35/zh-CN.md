---
slug: panel-keys-without-a-command-key
title: 不用 Command 键也能切面板
description: Hulala 0.3.35 把面板切换挪到 Ctrl-H 和 Ctrl-L：ssh、tmux 和 Terminal.app 里都到得了，不再依赖 Command 组合键。
date: 2026-11-23
version: 0.3.35
---

## 按下去没反应的那颗键

turn 还在跑，你想把键盘挪回输入框，按下 `Shift-Cmd-H`——什么都没发生。你正
ssh 在另一台机器上，或者在 tmux 里，或者用的终端根本不回键盘报告：`Cmd` 组合键
从这儿就发不出去。第二写法 `Ctrl-Shift-H` 在老编码里干脆一个修饰键都留不下，
一样不是一个键。

这就是 0.3.35 要解决的事：整套布局按键以前只有说 Kitty 键盘协议的终端才送得到。
现在每个手势都落在 `Ctrl` 字母上，ssh 里也一样按。

## 为什么 Command 组合键不算数

终端告诉程序「按了什么」只有两条路。老路是一个字节：`Ctrl-H` 是 `0x08`，
`Ctrl-M` 是 `0x0d`，`Ctrl-[` 是 `0x1b`。新路要程序先开口问，终端才会说「这是
`Cmd`+`Shift`+`H`，按下而不是连发」。

Hulala 从第一个版本就在问。Ghostty、kitty、WezTerm、iTerm2 会答；Terminal.app、
ssh 会话、以及 tmux 里的大部分组合不会答。没有这份报告时，客户端面对的键盘把组合键
压成一个字节，而一个要按三个键、还不知道到不到得了的快捷键，没人会按第二次。

先试过另一个方向：保留 Command，让每个人去改自己的终端配置。结果是在这台机器上
能用，到下一台就失效，而我们反复听到的答案是「我是 ssh 上去用的」。一个依赖外层终端
配置的键位不叫键位，叫偏好。

## 现在这一套

每个布局键都以 `Ctrl` 开头，字母就是它移动的东西：

- `Ctrl-H` / `Ctrl-L`：在会话栏、对话栏和已画出的列之间移动键盘。
- `Ctrl-S`：显示或收起会话栏。
- `Ctrl-,` / `Ctrl-.`：上一个 / 下一个会话；终端送不到「Ctrl 加逗号、句点」时用 `Ctrl-↑` / `Ctrl-↓`。
- `Ctrl-T`、`Ctrl-D` 没变：内置终端、Neovim。
- `Ctrl-Shift-D`：只留 Neovim——字母就是它不动的那一列的那个键。
- `Cmd-L` 和 `Ctrl-Shift-L`：清屏重画。`Ctrl-L` 以前干这个，现在它是向右移。

旧组合键都还能用，`Shift-Cmd-H` / `Shift-Cmd-L` / `Shift-Cmd-S` 是备选；
`/rail`、`/chat`、`/nvim`、`/sessions` 完全不依赖键盘报告。

## 列里的程序还拿着哪些键

`Ctrl-H` 就是 `0x08`，列里的程序会把它读成 `<C-h>`，也就是另一个退格。客户端还是
把它拿走——否则没有任何一个字节能把键盘从程序里救出来。退格键本身是另一个字节
（`0x7f`），在 Neovim 和 shell 里照常删字。

反方向的例外只有一个：`Ctrl-S`。随包发布的 Neovim 配置把 `<C-s>` 绑成 `:write`，
所以编辑器列拿着键盘时这个字节归 Neovim，会话栏那颗键在那里不起作用。终端列则相反，
客户端留着它——shell 会把 `C-s` 当流控，屏幕上的输出会冻住直到你按 `C-q`，
那不是命令，是事故。

`Ctrl-L` 不从有焦点的列里拿走：列已经在最右边，右边没有东西可去。Neovim 里它还是重绘。

`Ctrl-I` 依然不绑任何东西，以后也不会：它就是 `Tab` 的字节。`Ctrl-[` 同理，它是 `Esc`。

## 这次没解决的

`Ctrl-,` 和 `Ctrl-.` 只有在键盘报告里才和普通逗号、句点分得开。没有报告的终端上它们
什么也不做，所以同样的两个动作还绑了 `Ctrl-↑` 和 `Ctrl-↓`。

`Ctrl-Shift-D` 的退化方式不一样：老编码里它就是 `Ctrl-D` 的字节，在这种终端上按它会
开关编辑器列，而不是「只留 Neovim」；`/nvim` 是不依赖报告的那一种写法。

用 Ghostty 的话注意它自己占了 `super+shift+d`（`new_split:down`）和
`super+shift+arrow_up`（`jump_to_prompt`），这两个 Command 写法要现在它的配置里写
`keybind = …=unbind` 才到得了。`Ctrl` 写法不需要任何配置。

## 怎么看，怎么改

`/keys` 会列出每个动作和当前生效的键，想确认某个构建到底绑了什么，看这里最快。
自己的文件是 `~/.hulala/config/keybindings.json`，schema 和默认表同一套，`/keys`
会重读它，不用重启：

```json
{
  "panel.focusLeft": ["ctrl+h"],
  "panel.rail": ["ctrl+s"]
}
```

0.3.35 还有几处安静些的改动。新会话的第一块现在会说明这个会话加载了什么：它的
skills，以及目录里 `mcp.json` 声明的 MCP 服务器，答案来自 Host 而不是当前窗口。
弹窗会把背后的面板压暗，并且在被回答之前一直拿着键盘；客户端退出后，Ghostty 里
也不会再留下那张 Kitty 图片的 logo。

用 [安装 Hulala](/download/) 或 `hulala update` 拿到它；想看来龙去脉，可以读 0.3.34 的
[`Ctrl-[` 为什么是 `Esc`](/zh-CN/blog/ctrl-bracket-is-escape/)。
