/**
 * Message transcript.
 *
 * Maps the view-model items onto pi-tui components. Assistant text uses pi's
 * `Markdown`, archived user prompts use the `UserMessage` panel, tool calls use
 * `ToolRowView`, reasoning uses `ThinkRow`, and the tail of a live turn is the
 * `RunningRow` clock.
 *
 * A step row is not collapsed to a title line: it draws a preview of its body
 * (the end of a command's output, the start of a result, a mutation's diff, the
 * end of a thought) within a per-family line budget, and the reader opens the
 * rest with a click or `Ctrl-O`. A body shorter than its budget is shown whole.
 *
 * Components are cached per item so streaming deltas update one `Markdown` in
 * place instead of rebuilding the transcript. Each of them answers a repaint with
 * the array it returned last time while nothing it draws changed, so a frame that
 * only scrolled the viewport gets the document it already had back: scrolling a
 * long conversation costs the rows in the viewport, not the rows it has ever
 * drawn.
 *
 * A step row is also a mouse target: a primary click folds or unfolds that one
 * row, the way the web transcript's disclosure rows behave. A tool row answers
 * on its first line only, so the body's text (a diff, a file's contents) stays
 * available for selection; a reasoning block answers anywhere on itself, since
 * its folded body *is* the row. The hit test needs no per-row components
 * because this container knows the line range each item occupies — the
 * alternate screen hands it coordinates local to the scrolled document. A click
 * is the *only* gesture answered here: claiming the press as well would take the
 * whole drag away from the screen's text selection.
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
import { t } from '../i18n/index.js'
import { COLLAPSED, EXPANDED, GUTTER } from './rowGlyph.js'
import { CommandRowView, commandExpandable } from './commandRow.js'
import { RunningRow } from './runningRow.js'
import { mermaidMarkdown } from './mermaid.js'
import { codeHighlighter } from './codeHighlight.js'
import { type ReasoningMode, ThinkRow } from './thinkRow.js'
import { ToolRowView } from './toolRow.js'
import { UserMessage } from './userMessage.js'
import { brandBannerLines } from './brandBanner.js'

/** Session roots every tool row relativizes against. */
export interface TranscriptRoots {
  cwd?: string | undefined
  home?: string | undefined
}

export class Transcript implements Component {
  private items: TranscriptItem[] = []
  private readonly components = new WeakMap<TranscriptItem, Component>()
  private readonly markdowns = new WeakMap<TranscriptItem, Markdown>()
  /** Text last pushed into each assistant's `Markdown`, so a frame rewrites only what moved. */
  private readonly syncedText = new WeakMap<TranscriptItem, string>()
  /** Per-row overrides; the global toggles act as the baseline they flip. */
  private readonly flipped = new Set<TranscriptItem>()
  private hovered: TranscriptItem | undefined
  private ranges: Array<{ item: TranscriptItem; start: number; end: number }> = []
  /**
   * The last assembled document: one rendered chunk per item, in order.
   *
   * Every row answers a repaint with the same array it returned last time while
   * nothing about it changed, so a frame that only scrolled the viewport can
   * hand the renderer the document it already had. Concatenating tens of
   * thousands of cached lines per wheel notch was the whole cost of scrolling a
   * long conversation.
   */
  private assembled: {
    width: number
    parts: readonly string[][]
    running: string | undefined
    lines: string[]
  } | undefined
  private expandAll = false
  private reasoningMode: ReasoningMode = 'tail'
  private runningStartedAt: number | undefined
  private readonly markdownTheme: MarkdownTheme
  private readonly styles: ReturnType<typeof buildStyles>
  private readonly runningRow: RunningRow
  /** Width of the last frame; a code block folds into it, so it must be known. */
  private width = 80

  constructor(
    private readonly color: boolean,
    private readonly roots: () => TranscriptRoots,
  ) {
    const styles = buildStyles(color)
    // The shared markdown theme plus the one hook that needs this transcript's
    // own state: a code block wraps to the width the frame was drawn at.
    this.markdownTheme = {
      ...buildTheme(color).markdown,
      // A block with no language is still a block: pi inks it as code, so does
      // this, one step below the prose that introduces it.
      highlightCode: codeHighlighter((type, text) => styles.syntax(type, text), () => this.width, styles.dim),
    }
    this.styles = styles
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

  /** Cycle reasoning between its folded tail, the full block, and hidden. */
  cycleReasoning(): ReasoningMode {
    this.reasoningMode = this.reasoningMode === 'tail'
      ? 'full'
      : this.reasoningMode === 'full' ? 'hidden' : 'tail'
    return this.reasoningMode
  }

  get reasoning(): ReasoningMode {
    return this.reasoningMode
  }

  invalidate(): void {
    this.assembled = undefined
    for (const item of this.items) this.components.get(item)?.invalidate()
  }

  /**
   * Mirror an assistant item's current text into its cached `Markdown`.
   *
   * The reducer mutates the item in place — every delta grows `text`, and the
   * durable message settles it — while the component WeakMap keeps the object
   * it was built for. Without this the transcript would keep showing the first
   * delta of the answer, caret and all, after the turn ended.
   */
  private syncAssistant(item: TranscriptItem & { kind: 'assistant' }): void {
    const markdown = this.markdowns.get(item)
    if (markdown === undefined) return
    const text = item.streaming ? `${item.text}▌` : item.text
    if (this.syncedText.get(item) === text) return
    markdown.setText(text)
    this.syncedText.set(item, text)
  }

  /**
   * Build the document: every item's cached chunk, then the live turn's clock.
   *
   * The arrays handed out here are shared with the renderer and with the rows
   * that produced them, so a caller must treat the lines as read-only. Returning
   * the previous document unchanged is the point: the renderer clips it to the
   * viewport itself.
   */
  render(width: number): string[] {
    this.width = width
    // Home screen: nothing said yet, so the banner stands in for the transcript.
    if (this.items.length === 0 && this.runningStartedAt === undefined) return brandBannerLines(width)
    const assembled = this.assembled
    const parts: string[][] = []
    let stale = assembled === undefined || assembled.width !== width || assembled.parts.length !== this.items.length
    for (let index = 0; index < this.items.length; index += 1) {
      const item = this.items[index]!
      if (item.kind === 'assistant') this.syncAssistant(item)
      const rendered = this.componentFor(item).render(width)
      parts.push(rendered)
      if (!stale && assembled!.parts[index] !== rendered) stale = true
    }
    // The running clock is compared as text: it is one line that changes every
    // second, not a reason to rebuild the document.
    const running = this.runningStartedAt === undefined ? undefined : this.runningRow.render(width).join('\n')
    if (!stale && running === assembled!.running) return assembled!.lines

    const lines: string[] = []
    this.ranges = []
    for (let index = 0; index < parts.length; index += 1) {
      const rendered = parts[index]!
      this.ranges.push({ item: this.items[index]!, start: lines.length, end: lines.length + rendered.length })
      for (const line of rendered) lines.push(line)
    }
    if (running !== undefined) for (const line of running.split('\n')) lines.push(line)
    this.assembled = { width, parts, running, lines }
    return lines
  }

  /**
   * Fold or unfold the row whose header line the pointer is on. Only the header
   * is a target, so the body text underneath stays available for selection.
   */
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    // A tool row answers on its header line; a thought answers on any of its
    // rows, because the folded block has no separate header to aim at.
    const row = this.ranges.find(range => range.end > range.start && (
      event.y === range.start
      || (range.item.kind === 'reasoning' && event.y > range.start && event.y < range.end)
    ))
    const target = row !== undefined && (
      row.item.kind === 'tool'
      || row.item.kind === 'reasoning'
      || (row.item.kind === 'command' && commandExpandable(row.item))
    ) ? row.item : undefined

    if (event.type === 'move') {
      if (target === this.hovered) return undefined
      this.hovered = target
      return { handled: true, render: true }
    }
    if (event.button !== 'left' || target === undefined) return undefined
    // The press is left unclaimed so the alternate screen's own text selection
    // keeps working from a row header too: a drag that starts here selects the
    // text, and only a press and release on the same cell arrives as a click.
    if (event.type !== 'click') return undefined
    this.flip(target)
    return { handled: true, render: true }
  }

  private flip(item: TranscriptItem): void {
    if (this.flipped.has(item)) this.flipped.delete(item)
    else this.flipped.add(item)
  }

  /** Whether one detail row (a tool call, a command's summary) is open. */
  private rowExpanded(item: TranscriptItem): boolean {
    return this.expandAll !== this.flipped.has(item)
  }

  private thinkMode(item: TranscriptItem): ReasoningMode {
    if (this.reasoningMode === 'hidden') return 'hidden'
    // `Ctrl-O` opens every body, the thought's included, while the thought is
    // folded. An explicit `/reasoning full` already means "open" and `/reasoning
    // hidden` wins outright, so neither needs the global toggle to agree with it.
    // The per-row flip closes one again, exactly as it does for a tool row.
    const open = this.reasoningMode === 'full' || (this.reasoningMode === 'tail' && this.expandAll)
    return open !== this.flipped.has(item) ? 'full' : 'tail'
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
        const text = item.streaming ? `${item.text}▌` : item.text
        const markdown = new Markdown(text, 2, 0, this.markdownTheme, undefined, {
          // Math renders as Unicode; an expression it cannot draw stays source.
          renderLatex: true,
          // Mermaid blocks become diagrams; whether the message is still
          // arriving decides if an incomplete drawing reports warnings.
          transform: (source, width) => mermaidMarkdown(source, width, { streaming: () => item.streaming }),
        })
        this.markdowns.set(item, markdown)
        this.syncedText.set(item, text)
        return markdown
      }
      case 'tool':
        return new ToolRowView(
          item,
          this.roots,
          this.color,
          () => this.rowExpanded(item),
          () => this.gutter(() => this.rowExpanded(item), item),
        )
      case 'command': {
        // Only a manual compaction carries a body: the summary is a detail row
        // like a tool's output, so the same expand gesture opens it.
        const open = (): boolean => commandExpandable(item) && this.rowExpanded(item)
        return new CommandRowView(
          item,
          this.color,
          open,
          () => commandExpandable(item) ? this.gutter(open, item) : GUTTER,
        )
      }
      case 'error':
        return new Text(this.styles.error(`! ${item.message}`), 2, 0)
      case 'summary': {
        const rule = '─'.repeat(20)
        return new Text(this.styles.dim(`${rule}\n${t('transcript.summary')}\n${item.text}\n${rule}`), 2, 0)
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
