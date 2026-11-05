/**
 * The terminal the screenshots pretend to run in.
 *
 * Ghostty's default dark style (`Ghostty Default Style Dark`). The client asks
 * the terminal for its background, foreground and 16-colour palette, and builds
 * the editor theme from the answers, so a capture that stays silent would be
 * rendered with fallback colours the product never uses. Answering the queries
 * is what makes the frames look like a real window.
 *
 * @module hulala/scripts/docs/terminalTheme
 */

export const terminalTheme = {
  background: '#282c34',
  foreground: '#ffffff',
  palette: [
    '#1d1f21', '#cc6566', '#b6bd68', '#f0c674',
    '#82a2be', '#b294bb', '#8abeb7', '#c4c8c6',
    '#666666', '#d54e53', '#b9ca4b', '#e7c547',
    '#7aa6da', '#c397d8', '#70c0b1', '#eaeaea',
  ],
} as const

/** `#rrggbb` as the `rgb:rrrr/gggg/bbbb` form a terminal reports. */
export function xTermColor(hex: string): string {
  const value = hex.replace('#', '')
  const channel = (from: number): string => value.slice(from, from + 2).repeat(2)
  return `rgb:${channel(0)}/${channel(2)}/${channel(4)}`
}

/**
 * The reply to one terminal query, or undefined for anything else.
 * @param query - the escape sequence the client wrote.
 * @returns the bytes a Ghostty window would answer with.
 */
export function terminalReply(query: string): string | undefined {
  const osc = /^\u001b\](10|11|4;(?:\d+));\?\u0007$/u.exec(query)
  if (osc === null) return undefined
  const [, what, index] = osc
  if (what === '10') return `\u001b]10;${xTermColor(terminalTheme.foreground)}\u0007`
  if (what === '11') return `\u001b]11;${xTermColor(terminalTheme.background)}\u0007`
  const colour = terminalTheme.palette[Number(index)] ?? terminalTheme.foreground
  return `\u001b]4;${index};${xTermColor(colour)}\u0007`
}
