/**
 * A changelog release as plain transcript lines.
 *
 * The transcript is not a Markdown surface — a notice row is one wrapped Text —
 * so the bullets are flattened here instead of being handed raw Markdown that
 * would print its own syntax. The group labels (`Added`, `Fixed`) stay as the
 * file spells them: the changelog is written in English so the release page and
 * the client print the same words.
 *
 * @module hulala-cli/changelog/render
 */
import type { ChangelogRelease } from './parse.js'

/**
 * One line of changelog Markdown without the inline syntax.
 *
 * Links keep both halves, because a terminal line may render the URL as a
 * hyperlink and dropping it would hide where an issue lives.
 * @param text - Markdown inline text.
 * @returns the same sentence as plain terminal text.
 */
export function plainInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/gu, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gu, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/__([^_]+)__/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * One release as the transcript prints it: a heading, then its groups.
 * @param release - the parsed section.
 * @returns the lines, newest information first.
 */
export function releaseLines(release: ChangelogRelease): string[] {
  const heading = release.version === undefined
    ? 'Unreleased'
    : `v${release.version}${release.date === undefined ? '' : ` — ${release.date}`}`
  const lines = [heading]
  for (const change of release.changes) {
    if (change.items.length === 0) continue
    lines.push('', change.group)
    for (const item of change.items) lines.push(`  • ${plainInline(item)}`)
  }
  return lines
}
