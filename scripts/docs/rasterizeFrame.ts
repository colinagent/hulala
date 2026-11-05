/**
 * Rasterize one captured TUI frame (ANSI bytes) into a PNG.
 *
 * A terminal screenshot is a grid of cells, so this draws the grid the way the
 * terminal does: every glyph is placed at its own cell origin, rules are drawn
 * as rules, and wide glyphs claim two cells. Headless Chrome does the type
 * rendering, which is why this stays macOS/Linux-only tooling.
 *
 * @module hulala/scripts/docs/rasterizeFrame
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GhosttyVt } from '../../apps/cli/src/tui/pane/ghosttyVt.ts'
import { terminalTheme } from './terminalTheme.ts'

const FONT = 14
const CELL = 8.4
const LINE = 21
const PAD = 26

// The capture answers the client's colour queries with this theme, so the cells
// that keep the terminal default belong to it too.
const BG = terminalTheme.background
const FG = terminalTheme.foreground
const PALETTE = terminalTheme.palette

interface Cell { ch: string; fg?: string; bg?: string; bold: boolean; dim: boolean; italic: boolean; underline: boolean }
interface Style { fg?: string; bg?: string; bold: boolean; dim: boolean; italic: boolean; underline: boolean; inverse: boolean }

const defaultStyle = (): Style => ({ bold: false, dim: false, italic: false, underline: false, inverse: false })

/** Apply one SGR parameter list to a style. */
function applySgr(style: Style, params: number[]): Style {
  const next: Style = { ...style }
  for (let i = 0; i < params.length; i += 1) {
    const p = params[i]!
    if (p === 0) return defaultStyle()
    else if (p === 1) next.bold = true
    else if (p === 2) next.dim = true
    else if (p === 3) next.italic = true
    else if (p === 4) next.underline = true
    else if (p === 7) next.inverse = true
    else if (p === 22) { next.bold = false; next.dim = false }
    else if (p === 23) next.italic = false
    else if (p === 24) next.underline = false
    else if (p === 27) next.inverse = false
    else if (p === 39) next.fg = undefined
    else if (p === 49) next.bg = undefined
    else if (p === 38 || p === 48) {
      const target = p === 38 ? 'fg' : 'bg'
      const mode = params[i + 1]
      if (mode === 5) { next[target] = PALETTE[params[i + 2] ?? 0] ?? FG; i += 2 }
      else if (mode === 2) { next[target] = `rgb(${params[i + 2]},${params[i + 3]},${params[i + 4]})`; i += 4 }
    }
  }
  return next
}

function charWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0
  const wide = (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff)
  return wide ? 2 : 1
}

/** Split a rendered line into positioned cells. */
function parseLine(line: string): Cell[] {
  let style = defaultStyle()
  const cells: Cell[] = []
  const regex = /\u001b\[([0-9;]*)m/gu
  let index = 0
  while (index < line.length) {
    regex.lastIndex = index
    const match = regex.exec(line)
    if (match !== null && match.index === index) {
      const params = match[1] === '' ? [0] : match[1]!.split(';').map(Number)
      style = applySgr(style, params)
      index = regex.lastIndex
      continue
    }
    const ch = String.fromCodePoint(line.codePointAt(index)!)
    index += ch.length
    const fg = style.inverse ? style.bg ?? BG : style.fg ?? FG
    const bg = style.inverse ? style.fg ?? FG : style.bg
    const last = cells[cells.length - 1]
    if (last !== undefined && last.ch === '\u0000') cells.pop()
    cells.push({ ch, fg, bg, bold: style.bold, dim: style.dim, italic: style.italic, underline: style.underline })
    if (charWidth(ch) === 2) cells.push({ ch: '\u0000', fg, bg, bold: false, dim: false, italic: false, underline: false })
  }
  return cells
}


/** One frame to draw: an ANSI capture and its grid size. */
export interface FrameInput {
  ansiPath: string
  pngPath: string
  cols: number
  rows: number
}

/** Draw one captured frame into `pngPath`.
 * @returns the CSS-pixel size of the drawn card.
 */
export function rasterizeFrame(input: FrameInput): { width: number; height: number } {
  const { ansiPath, pngPath, cols, rows } = input
  const bytes = readFileSync(ansiPath)
  const vt = new GhosttyVt(cols, rows)
  vt.write(bytes)
  const cursor = vt.cursor()
  const lines = vt.renderRows(cols, rows, cursor, { draw: (text: string) => text })

  /** Blend two CSS colours; used to render faint text on a filled band. */
function mix(fg: string, bg: string, amount = 0.45): string {
  const parse = (value: string): [number, number, number] => {
    const rgb = /rgb\((\d+),(\d+),(\d+)\)/u.exec(value)
    if (rgb !== null) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
    const hex = /#([0-9a-f]{6})/iu.exec(value)
    if (hex !== null) {
      const n = Number.parseInt(hex[1]!, 16)
      return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
    }
    return [217, 214, 208]
  }
  const [r1, g1, b1] = parse(fg)
  const [r2, g2, b2] = parse(bg)
  const blend = (a: number, b: number): number => Math.round(a * (1 - amount) + b * amount)
  return `rgb(${blend(r1, r2)},${blend(g1, g2)},${blend(b1, b2)})`
}

/** CSS that fills the part of a cell a block element covers, or undefined. */
function blockRect(text: string): string | undefined {
  const cp = text.codePointAt(0) ?? 0
  if (cp === 0x2588) return '' // full block
  const left: Record<number, number> = { 0x258f: 1, 0x258e: 2, 0x258d: 3, 0x258c: 4 }
  const right: Record<number, number> = { 0x2595: 1, 0x2594: 2, 0x2593: 3, 0x2590: 4 }
  if (left[cp] !== undefined) return `clip-path:inset(0 ${100 - (left[cp]! / 8) * 100}% 0 0)`
  if (right[cp] !== undefined) return `clip-path:inset(0 0 0 ${100 - (right[cp]! / 8) * 100}%)`
  if (cp === 0x2580) return 'clip-path:inset(0 0 50% 0)'
  if (cp === 0x2584) return 'clip-path:inset(50% 0 0 0)'
  return undefined
}

const esc = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const spans: string[] = []
  for (let row = 0; row < lines.length; row += 1) {
    let col = 0
    for (const cell of parseLine(lines[row]!)) {
      if (cell.ch === '\u0000') { col += 1; continue }
      const width = charWidth(cell.ch)
      const text = cell.ch
      // Terminal rules are drawn as real rules: the font glyph leaves the gaps a
      // terminal closes, and a screenshot should show a solid divider.
      // Block elements are geometry, not type: a terminal draws them to fill
      // part of the cell, and a font's glyph leaves gaps that read as artefacts.
      const block = blockRect(text)
      if (block !== undefined) {
        spans.push(`<span style="left:${(col * CELL).toFixed(2)}px;top:${(row * LINE).toFixed(2)}px;width:${(width * CELL).toFixed(2)}px;height:${LINE}px;background:${cell.fg};${block}"></span>`)
        col += width
        continue
      }
      const rule = text === '\u258f'
      if (rule) {
        const vertical = true
        // Rules are drawn as boxes, so the dim opacity the text spans use has to
        // be stated here too: a dim rule is a fainter line, not a narrower one.
        const dim = cell.dim ? ';opacity:.62' : ''
        const style = vertical
          ? `left:${(col * CELL).toFixed(2)}px;top:${(row * LINE).toFixed(2)}px;width:1px;height:${LINE}px;background:${cell.fg}${dim}`
          : `left:${(col * CELL).toFixed(2)}px;top:${(row * LINE + LINE / 2).toFixed(2)}px;width:${(width * CELL).toFixed(2)}px;height:1px;background:${cell.fg}${dim}`
        spans.push(`<span style="${style}"></span>`)
        col += width
        continue
      }
      if (text.trim() !== '' || cell.bg !== undefined) {
        const styles = [
          `left:${(col * CELL).toFixed(2)}px`,
          `top:${(row * LINE).toFixed(2)}px`,
          `width:${(width * CELL).toFixed(2)}px`,
          'height:' + LINE + 'px',
          'line-height:' + LINE + 'px',
          `color:${cell.fg}`,
          cell.bg ? `background:${cell.bg}` : '',
          cell.bold ? 'font-weight:600' : '',
          cell.italic ? 'font-style:italic' : '',
          cell.underline ? 'text-decoration:underline' : '',
          cell.dim ? (cell.bg ? `color:${mix(cell.fg, cell.bg)}` : 'opacity:.62') : '',
        ].filter(Boolean).join(';')
        spans.push(`<span style="${styles}">${esc(text)}</span>`)
      }
      col += width
    }
  }

  const width = Math.round(cols * CELL + PAD * 2)
  const height = Math.round(rows * LINE + PAD * 2)
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#07080a}
    .card{position:relative;width:${width}px;height:${height}px;background:${BG};overflow:hidden}
    .grid{position:absolute;left:${PAD}px;top:${PAD}px;width:${Math.round(cols * CELL)}px;height:${Math.round(rows * LINE)}px;
      font-family:"SF Mono",SFMono-Regular,Menlo,"DejaVu Sans Mono","Symbols Nerd Font Mono",monospace;font-size:${FONT}px;
      font-variant-ligatures:none;white-space:pre}
    .grid span{position:absolute;overflow:visible;display:block}
  </style></head><body><div class="card"><div class="grid">${spans.join('')}</div></div></body></html>`

  const dir = mkdtempSync(join(tmpdir(), 'hulala-frame-'))
  const page = join(dir, 'frame.html')
  writeFileSync(page, html)
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  execFileSync(chrome, [
    '--headless=new', '--hide-scrollbars', '--disable-gpu', '--no-sandbox',
    '--force-device-scale-factor=2',
    `--window-size=${width},${height}`,
    `--screenshot=${pngPath}`,
    `file://${page}`,
  ], { stdio: 'pipe' })
  return { width, height }
}
