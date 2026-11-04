/**
 * Session picker modal.
 *
 * Two filters: sessions whose directory is the launch directory, and every
 * session the Host knows. Typing filters live over directory + identifier;
 * `Ctrl-F` (or Enter with a non-empty query) runs Host content search.
 *
 * @module hulala-cli/tui/view/overlays/resume
 */
import type { Component } from '@earendil-works/pi-tui'
import { fuzzyFilter, matchesKey, truncateToWidth } from '@earendil-works/pi-tui'
import type { TerminalSearchItem, TerminalSession } from '../../data/remote.js'
import { LIST_MOVE_HINT, listMove } from '../../keys.js'
import { buildStyles } from '../theme.js'
import { panel } from './panel.js'

export type ResumeResult = { kind: 'session'; sessionId: string } | { kind: 'new' } | { kind: 'cancel' }

export interface ResumeOverlayOptions {
  sessions: readonly TerminalSession[]
  cwd: string
  color: boolean
  onSearch(query: string): Promise<{ items: TerminalSearchItem[]; hasMore: boolean }>
  onResolve(result: ResumeResult): void
}

function stamp(timestamp: number): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.valueOf()) ? '?' : date.toISOString().slice(0, 16).replace('T', ' ')
}

function shortId(sessionId: string): string {
  return `${sessionId.slice(0, 8)}…${sessionId.slice(-4)}`
}

export class ResumeOverlay implements Component {
  private readonly options: ResumeOverlayOptions
  private tab: 'cwd' | 'all' = 'cwd'
  private query = ''
  private cursor = 0
  private search: { items: TerminalSearchItem[]; hasMore: boolean } | null = null

  constructor(options: ResumeOverlayOptions) {
    this.options = options
  }

  invalidate(): void {}

  private visibleRows(): TerminalSession[] {
    const scoped = this.tab === 'cwd'
      ? this.options.sessions.filter(session => session.cwd === this.options.cwd)
      : [...this.options.sessions]
    const candidates = scoped.filter(session => this.query.trim() === '' ? session.blank !== true : true)
    if (this.query.trim() === '') return candidates.sort((a, b) => b.updatedAt - a.updatedAt)
    return fuzzyFilter(candidates, this.query, session => `${session.cwd ?? ''} ${session.sessionId}`)
  }

  render(width: number): string[] {
    const s = buildStyles(this.options.color)
    const panelWidth = width
    const inner = panelWidth - 4
    const rows = this.visibleRows()
    const count = this.search === null ? Math.min(12, rows.length) : this.search.items.length
    if (this.cursor >= count) this.cursor = Math.max(0, count - 1)

    const tabLabel = (name: 'cwd' | 'all', label: string): string => {
      const text = this.tab === name ? `[ ${label} ]` : `  ${label}  `
      return this.tab === name ? s.accent(text) : text
    }
    const body: string[] = []
    body.push(`${tabLabel('cwd', 'Current folder')} ${tabLabel('all', 'All folders')}  ${truncateToWidth(this.options.cwd, Math.max(4, inner - 30))}`)
    body.push(s.accent(`> ${this.query}`))

    if (this.search !== null) {
      if (this.search.items.length === 0) {
        body.push(s.dim('  (no matching content)'))
      } else {
        this.search.items.forEach((item, index) => {
          const marker = index === this.cursor ? '›' : ' '
          const line = `${marker} ${shortId(item.sessionId)}  ${truncateToWidth(item.snippet, Math.max(4, inner - 22))}`
          body.push(index === this.cursor ? s.accent(line) : line)
        })
        if (this.search.hasMore) body.push(s.dim('  (more results…)'))
      }
    } else if (rows.length === 0) {
      body.push(s.dim('  (no matching Session)'))
    } else {
      rows.slice(0, 12).forEach((session, index) => {
        const marker = index === this.cursor ? '›' : ' '
        const running = session.running === true ? ' ● running' : ''
        const line = `${marker} ${stamp(session.updatedAt)}  ${shortId(session.sessionId)}  ${truncateToWidth(session.cwd ?? '', Math.max(4, inner - 40))}${running}`
        body.push(index === this.cursor ? s.accent(line) : line)
      })
    }

    return panel(panelWidth, 'Resume Session', body, [s.dim(`Tab 切换 · ${LIST_MOVE_HINT} · Enter 打开 · Ctrl-F 内容搜索 · Esc 取消`)])
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'ctrl+c')) {
      this.options.onResolve({ kind: 'cancel' })
      return
    }
    if (matchesKey(data, 'escape')) {
      if (this.search !== null) {
        this.search = null
        return
      }
      this.options.onResolve({ kind: 'cancel' })
      return
    }
    if (matchesKey(data, 'ctrl+f')) {
      void this.runSearch()
      return
    }
    if (matchesKey(data, 'tab')) {
      this.tab = this.tab === 'cwd' ? 'all' : 'cwd'
      this.cursor = 0
      this.search = null
      return
    }
    if (listMove(data, 'up')) {
      this.cursor = Math.max(0, this.cursor - 1)
      return
    }
    if (listMove(data, 'down')) {
      this.cursor += 1
      return
    }
    if (matchesKey(data, 'backspace')) {
      this.query = this.query.slice(0, -1)
      this.cursor = 0
      this.search = null
      return
    }
    if (matchesKey(data, 'enter')) {
      if (this.query.trim() !== '' && this.search === null) {
        void this.runSearch()
        return
      }
      if (this.search !== null) {
        const item = this.search.items[this.cursor]
        this.options.onResolve(item === undefined ? { kind: 'cancel' } : { kind: 'session', sessionId: item.sessionId })
        return
      }
      const chosen = this.visibleRows()[this.cursor]
      this.options.onResolve(chosen === undefined ? { kind: 'new' } : { kind: 'session', sessionId: chosen.sessionId })
      return
    }
    if (data.length === 1 && data.charCodeAt(0) >= 0x20) {
      this.query += data
      this.cursor = 0
      this.search = null
    }
  }

  private async runSearch(): Promise<void> {
    const query = this.query.trim()
    if (query === '') return
    try {
      this.search = await this.options.onSearch(query)
      this.cursor = 0
    } catch {
      this.search = { items: [], hasMore: false }
    }
  }
}
