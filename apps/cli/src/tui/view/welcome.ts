/**
 * The welcome block the conversation opens with: the banner, then what the open
 * Session loaded.
 *
 * pi's start screen is the model here, and its shape is two stacked blocks: a
 * header (logo, version, key hints) and the loaded resources ([Context],
 * [Skills], [Extensions]) that say what is in effect before the first prompt.
 * This is that pair for Hulala — the product's own banner, then the two
 * inventories it actually has: the skills the composer may invoke, and the MCP
 * servers the Session's directory declares. The Host answers both; nothing here
 * reads a file or a profile.
 *
 * It is a component of the transcript document, not a home-screen special case,
 * which is what fixes the order a launch reminder appears in: the changelog is a
 * transcript row like any other, so it can only print *below* this block instead
 * of replacing it. The block scrolls away with the conversation, exactly as pi's
 * header does.
 *
 * The facts are text, not a table: a bracket heading is what pi prints, and a
 * name list has no column to align, so a narrow terminal only has to wrap commas
 * instead of measuring every label. Names are alphabetical and deduplicated,
 * because a Session's composition can reach the same skill through a profile row
 * and a directory.
 *
 * No facts is a normal state: `undefined` means the Host has not answered (an
 * older Host, a fake one in a test) and the banner stands alone; two empty lists
 * mean the Session loads neither, and also render nothing — a heading with no
 * names teaches nothing.
 *
 * @module hulala-cli/tui/view/welcome
 */
import { visibleWidth, type Component } from '@earendil-works/pi-tui'
import { t } from '../i18n/index.js'
import { brandBannerLines } from './brandBanner.js'
import { buildStyles } from './theme.js'

/** What one Session's composition loaded, as the Host reports it. */
export interface StartupFacts {
  /** Skills the Session's composer may invoke, by the name `/` completes to. */
  readonly skills: readonly string[]
  /** MCP servers the Session's `mcp.json` documents will mount. */
  readonly mcp: readonly string[]
}

/** The banner and the loaded facts, as the transcript draws them. */
export class Welcome implements Component {
  private facts: StartupFacts | undefined
  /** The last rendering, so a frame that changed nothing does not rebuild it. */
  private drawn: { width: number; banner: readonly string[]; lines: string[] } | undefined

  constructor(private readonly color: boolean) {}

  /**
   * Publish the loaded facts, or clear them.
   * @param facts - the Host's answer, or `undefined` when there is none.
   */
  setFacts(facts: StartupFacts | undefined): void {
    this.facts = facts
    this.drawn = undefined
  }

  invalidate(): void {
    this.drawn = undefined
  }

  render(width: number): string[] {
    // The banner caches itself by width, language and keymap; this block caches
    // on top of it so the transcript's frame cache keeps its identity while
    // nothing changed.
    const banner = brandBannerLines(width)
    const cached = this.drawn
    if (cached !== undefined && cached.width === width && cached.banner === banner) return cached.lines
    const lines = [
      ...banner,
      ...(banner.length === 0 ? [] : ['']),
      ...this.sections(width),
    ]
    this.drawn = { width, banner, lines }
    return lines
  }

  /** One heading and its indented, comma-wrapped list per inventory. */
  private sections(width: number): string[] {
    const facts = this.facts
    if (facts === undefined) return []
    const sections = [
      { heading: t('startup.skills'), values: names(facts.skills) },
      { heading: t('startup.mcp'), values: names(facts.mcp) },
    ].filter(section => section.values.length > 0)
    if (sections.length === 0) return []
    const styles = buildStyles(this.color)
    const lines: string[] = []
    for (const [index, section] of sections.entries()) {
      // One blank row between sections, the way pi spaces its loaded-resource
      // blocks; the last one needs none, because the document separates the
      // whole welcome block from the transcript that follows.
      if (index > 0) lines.push('')
      lines.push(styles.accent(`[${section.heading}]`))
      for (const line of wrapped(section.values, width)) lines.push(styles.dim(`  ${line}`))
    }
    return lines
  }
}

/** Sorted, deduplicated names; a blank entry is dropped rather than printed. */
function names(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(value => value !== ''))]
    .sort((left, right) => left.localeCompare(right))
}

/**
 * One comma list broken at the terminal's width.
 *
 * The list is indented by the caller, so the budget is two columns narrower. A
 * single name longer than the row is left whole: a server name is a namespace
 * the model and the user share, and an ellipsis would hide which one it is.
 */
function wrapped(values: readonly string[], width: number): string[] {
  const budget = Math.max(16, width - 2)
  const lines: string[] = []
  let line = ''
  for (const value of values) {
    if (line === '') {
      line = value
      continue
    }
    const next = `${line}, ${value}`
    if (visibleWidth(next) <= budget) {
      line = next
      continue
    }
    lines.push(line)
    line = value
  }
  if (line !== '') lines.push(line)
  return lines
}
