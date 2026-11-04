/**
 * Help modal: slash commands and keybindings.
 *
 * @module hulala-cli/tui/view/overlays/help
 */
import type { Component } from '@earendil-works/pi-tui'
import { truncateToWidth } from '@earendil-works/pi-tui'
import { buildStyles } from '../theme.js'
import { panel } from './panel.js'

const COMMANDS: readonly string[] = [
  '/help                 show this list',
  '/sessions             list and switch Sessions',
  '/new                  start a new Session in this directory',
  '/resume [id]          pick a saved Session (or open one by id)',
  '/model [p/m]          select the model for later steps',
  '/login [provider]     add a provider API key (stored by the Host)',
  '/rename <title>       rename the current Session',
  '/cancel               cancel the running turn',
  '/status               show Session and turn state',
  '/editor               打开或关闭编辑列（等同 Ctrl-T）',
  '/quit                 detach (the Host keeps running)',
]

const KEYS: readonly string[] = [
  'Enter 提交（回合运行中则插话）· Alt-Enter 排队 · Alt-Up 回收待发消息 · Ctrl-J 换行',
  '↑/↓ 或 Ctrl-N/P 上下（历史/列表）· Tab 补全',
  'Esc 取消当前回合 · 空闲时进左侧会话栏（草稿保留）',
  'Ctrl-C 取消/退出 · Ctrl-L 重绘 · Ctrl-O 展开/折叠工具输出',
  'Ctrl-T 编辑器列（关闭前会问要不要保存）',
  'Ctrl-G 进/收会话栏 · Ctrl-[ / Ctrl-] 会话↔对话↔编辑器',
  '会话栏：↑↓/j k/Ctrl-N P 移动 · Enter 切换 · n 新建 · / 搜索 · ←/→ 展开 all · r 刷新 · Esc 回输入框',
  '会话栏最多先列 30 个：More 行上 Enter 展开其余（Less 收回）',
  '鼠标点击行首 ▸ 展开/折叠该行',
]

export interface HelpOverlayOptions {
  color: boolean
  onClose(): void
}

export class HelpOverlay implements Component {
  private readonly options: HelpOverlayOptions

  constructor(options: HelpOverlayOptions) {
    this.options = options
  }

  invalidate(): void {}

  render(width: number): string[] {
    const s = buildStyles(this.options.color)
    const panelWidth = width
    const inner = panelWidth - 4
    const body: string[] = []
    for (const command of COMMANDS) body.push(truncateToWidth(command, inner))
    body.push(s.accent('按键'))
    for (const key of KEYS) body.push(s.dim(truncateToWidth(key, inner)))
    return panel(panelWidth, '帮助', body, [s.dim('任意键关闭')])
  }

  handleInput(_data: string): void {
    this.options.onClose()
  }
}
