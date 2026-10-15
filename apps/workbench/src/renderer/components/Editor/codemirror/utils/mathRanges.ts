export type MarkdownMathRange = { from: number; to: number; formula: string; display: boolean }

/** Locate math without interpreting dollars inside code or frontmatter. */
export function markdownMathRanges(text: string): MarkdownMathRange[] {
  const ranges: MarkdownMathRange[] = []
  const lines = text.split('\n')
  let offset = 0, fence = '', frontmatter = false
  let block: { from: number; lines: string[] } | undefined
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!, trimmed = line.trim()
    const start = offset
    offset += line.length + 1
    if (index === 0 && trimmed === '---') { frontmatter = true; continue }
    if (frontmatter) { if (trimmed === '---') frontmatter = false; continue }
    if (block) {
      if (trimmed === '$$') { ranges.push({ from: block.from, to: start + line.length, formula: block.lines.join('\n'), display: true }); block = undefined }
      else block.lines.push(line)
      continue
    }
    const delimiter = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (delimiter) {
      if (!fence) fence = delimiter
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = ''
      continue
    }
    if (fence || /^ {4}|^\t/.test(line)) continue
    if (trimmed === '$$') { block = { from: start, lines: [] }; continue }
    const display = /^\s*\$\$(.+)\$\$\s*$/.exec(line)
    if (display) { ranges.push({ from: start, to: start + line.length, formula: display[1]!, display: true }); continue }
    const codeRanges = [...line.matchAll(/(`+).*?\1/g)].map(match => ({ from: match.index!, to: match.index! + match[0].length }))
    for (const match of line.matchAll(/(^|[^\\$])\$([^$\n]+?)\$(?!\$)/g)) {
      const from = match.index! + match[1]!.length, to = match.index! + match[0].length
      if (match[2]!.trim() !== match[2] || codeRanges.some(range => range.from < to && range.to > from)) continue
      ranges.push({ from: start + from, to: start + to, formula: match[2]!, display: false })
    }
  }
  return ranges
}
