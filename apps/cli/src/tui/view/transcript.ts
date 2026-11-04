/**
 * Message transcript.
 *
 * Maps the view-model items onto pi-tui components. Assistant text uses pi's
 * `Markdown`, archived user prompts use the `UserMessage` panel, tool calls use
 * the one-line `ToolRowView`, reasoning uses `ThinkRow`, and the tail of a live
 * turn is the `RunningRow` clock.
 *
 * Components are cached per item so streaming deltas update one `Markdown` in
 * place instead of rebuilding the transcript.
 *
 * A step row's first line is also a mouse target: a primary click folds or
 * unfolds that one row, the way the web transcript's disclosure rows behave.
 * The hit test needs no per-row components because this container knows the
 * line range each item occupies — the alternate screen hands it coordinates
 * local to the scrolled document, and its own text selection keeps working on
 * every other line.
 *
 * @module hulala-cli/tui/view/transcript
 */
import {
  Markdown,
  Text,
  type Component,
  type MarkdownTheme,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from '@earendil-works/pi-tui'
import type { TranscriptItem } from '../data/viewModel.js'
import { buildStyles, buildTheme } from './theme.js'
import { COLLAPSED, EXPANDED, GUTTER } from './rowGlyph.js'
import { RunningRow } from './runningRow.js'
import { type ReasoningMode, ThinkRow } from './thinkRow.js'
import { ToolRowView } from './toolRow.js'
import { UserMessage } from './userMessage.js'

/** Session roots every tool row relativizes against. */
export interface TranscriptRoots {
  cwd?: string | undefined
  home?: string | undefined
}

export class Transcript implements Component {
  private items: TranscriptItem[] = []
  private readonly components = new WeakMap<TranscriptItem, Component>()
  private readonly markdowns = new WeakMap<TranscriptItem, Markdown>()
  /** Per-row overrides; the global toggles act as the baseline they flip. */
  private readonly flipped = new Set<TranscriptItem>()
  private hovered: TranscriptItem | undefined
  private ranges: Array<{ item: TranscriptItem; start: number; end: number }> = []
  private expandAll = false
  private reasoningMode: ReasoningMode = 'summary'
  private runningStartedAt: number | undefined
  private readonly markdownTheme: MarkdownTheme
  private readonly styles: ReturnType<typeof buildStyles>
  private readonly runningRow: RunningRow

  constructor(
    private readonly color: boolean,
    private readonly roots: () => TranscriptRoots,
  ) {
    this.markdownTheme = buildTheme(color).markdown
    this.styles = buildStyles(color)
    this.runningRow = new RunningRow(() => ({ startedAt: this.runningStartedAt }), color)
  }

  setItems(items: TranscriptItem[]): void {
    this.items = items
  }

  /** Show or hide the live turn clock under the last item. */
  setRunning(startedAt: number | undefined): void {
    this.runningStartedAt = startedAt
  }

  toggleExpandAll(): void {
    this.expandAll = !this.expandAll
  }

  /** Cycle reasoning between its summary line, the full block, and hidden. */
  cycleReasoning(): ReasoningMode {
    this.reasoningMode = this.reasoningMode === 'summary'
      ? 'full'
      : this.reasoningMode === 'full' ? 'hidden' : 'summary'
    return this.reasoningMode
  }

  get reasoning(): ReasoningMode {
    return this.reasoningMode
  }

  invalidate(): void {}

  /** Refresh streaming components after a delta or attempt end. */
  updateStreaming(): void {
    const last = this.items[this.items.length - 1]
    if (last !== undefined && last.kind === 'assistant') {
      this.markdowns.get(last)?.setText(last.streaming ? `${last.text}▌` : last.text)
    }
  }

  render(width: number): string[] {
    const lines: string[] = []
    this.ranges = []
    for (const item of this.items) {
      const component = this.componentFor(item)
      const rendered = component.render(width)
      this.ranges.push({ item, start: lines.length, end: lines.length + rendered.length })
      for (const line of rendered) lines.push(line)
    }
    if (this.runningStartedAt !== undefined) {
      for (const line of this.runningRow.render(width)) lines.push(line)
    }
    return lines
  }

  /**
   * Fold or unfold the row whose header line the pointer is on. Only the header
   * is a target, so the body text underneath stays available for selection.
   */
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const row = this.ranges.find(range => range.end > range.start && event.y === range.start)
    const target = row !== undefined && (row.item.kind === 'tool' || row.item.kind === 'reasoning') ? row.item : undefined

    if (event.type === 'move') {
      if (target === this.hovered) return undefined
      this.hovered = target
      return { handled: true, render: true }
    }
    if (event.button !== 'left' || target === undefined) return undefined
    // The alternate screen only synthesizes `click` for a component that took
    // the press, so the press is claimed without acting on it.
    if (event.type === 'press') return { handled: true }
    if (event.type !== 'click') return undefined
    this.flip(target)
    return { handled: true, render: true }
  }

  private flip(item: TranscriptItem): void {
    if (this.flipped.has(item)) this.flipped.delete(item)
    else this.flipped.add(item)
  }

  private toolExpanded(item: TranscriptItem): boolean {
    return this.expandAll !== this.flipped.has(item)
  }

  private thinkMode(item: TranscriptItem): ReasoningMode {
    if (this.reasoningMode === 'hidden') return 'hidden'
    const full = (this.reasoningMode === 'full') !== this.flipped.has(item)
    return full ? 'full' : 'summary'
  }

  private componentFor(item: TranscriptItem): Component {
    const existing = this.components.get(item)
    if (existing !== undefined) return existing
    const component = this.build(item)
    this.components.set(item, component)
    return component
  }

  private build(item: TranscriptItem): Component {
    switch (item.kind) {
      case 'user':
        return new UserMessage(item.text, this.color)
      case 'reasoning':
        return new ThinkRow(
          item,
          this.color,
          this.markdownTheme,
          () => this.thinkMode(item),
          () => this.gutter(() => this.thinkMode(item) === 'full', item),
        )
      case 'assistant': {
        // The same two-column edge every step row's gutter uses, so message
        // text and row icons share one left margin.
        const markdown = new Markdown(item.streaming ? `${item.text}▌` : item.text, 2, 0, this.markdownTheme, undefined, { renderLatex: false })
        this.markdowns.set(item, markdown)
        return markdown
      }
      case 'tool':
        return new ToolRowView(
          item,
          this.roots,
          this.color,
          () => this.toolExpanded(item),
          () => this.gutter(() => this.toolExpanded(item), item),
        )
      case 'error':
        return new Text(this.styles.error(`! ${item.message}`), 2, 0)
      case 'summary': {
        const rule = '─'.repeat(20)
        return new Text(this.styles.dim(`${rule}\nSummary\n${item.text}\n${rule}`), 2, 0)
      }
      case 'notice':
        return new Text(item.tone === 'warn' ? this.styles.warn(item.text) : this.styles.dim(item.text), 2, 0)
    }
  }

  /** `▾` when open, `▸` under the pointer, two blank columns otherwise. */
  private gutter(open: () => boolean, item: TranscriptItem): string {
    if (open()) return `${this.styles.dim(EXPANDED)} `
    if (this.hovered === item) return `${this.styles.dim(COLLAPSED)} `
    return GUTTER
  }
}
