/**
 * The archived prompt is a band, not a chip: the editor's level-1 heading band,
 * the page moved 12% of the way towards the palette's red warmed halfway to its
 * yellow. These tests pin that derivation against the editor's own formula
 * instead of a colour, so the band and the `#` heading it mirrors cannot drift
 * apart.
 */
import { afterEach, expect, test } from 'bun:test'
import type { TerminalColors } from '@earendil-works/pi-tui'
import { setTerminalPage } from '../../src/tui/view/theme.js'
import { UserMessage } from '../../src/tui/view/userMessage.js'

/** The band, its text ink and the arrow's ink of one rendered prompt. */
interface Render {
  band: [number, number, number]
  text: [number, number, number]
  arrow: [number, number, number]
}

const reported = (hex: string): { r: number; g: number; b: number } => ({
  r: Number.parseInt(hex.slice(1, 3), 16),
  g: Number.parseInt(hex.slice(3, 5), 16),
  b: Number.parseInt(hex.slice(5, 7), 16),
})

const triple = (parts: ArrayLike<string | undefined> | undefined): [number, number, number] => [
  Number(parts?.[0]),
  Number(parts?.[1]),
  Number(parts?.[2]),
]

/** `#rrggbb` as the triple the blends take. */
const from = (hex: string): [number, number, number] => {
  const { r, g, b } = reported(hex)
  return [r, g, b]
}

/** The editor's blend, in the client's rounding: nvimConfig.lua's `blend`. */
const blend = (from: readonly number[], into: readonly number[], amount: number): [number, number, number] => {
  const at = (index: number): number => Math.floor(from[index]! + (into[index]! - from[index]!) * amount + 0.5)
  return [at(0), at(1), at(2)]
}

/** The editor's level-1 heading band: page → `blend(red, yellow, 0.5)`, at 12%. */
const headingBand = (page: string, red: string, yellow: string): [number, number, number] =>
  blend(from(page), blend(from(red), from(yellow), 0.5), 0.12)

/** A 16-entry palette whose red and yellow are the only slots these tests steer. */
const palette = (red: string, yellow: string): NonNullable<TerminalColors['palette']> =>
  Array.from({ length: 16 }, (_, index) => reported(index === 1 ? red : index === 3 ? yellow : '#808080'))

/** What one terminal answered: a page, and a palette only when the case steers one. */
function answer(
  background: string | undefined,
  foreground: string | undefined,
  inks?: { red: string; yellow: string },
): TerminalColors | undefined {
  if (background === undefined || foreground === undefined) return undefined
  const colors: TerminalColors = { background: reported(background), foreground: reported(foreground) }
  if (inks !== undefined) colors.palette = palette(inks.red, inks.yellow)
  return colors
}

/** Draw one prompt at the page and palette the terminal reported. */
function renderPrompt(
  background: string | undefined,
  foreground: string | undefined,
  inks?: { red: string; yellow: string },
): Render {
  const colorterm = process.env.COLORTERM
  process.env.COLORTERM = 'truecolor'
  try {
    setTerminalPage(answer(background, foreground, inks))
    const rows = new UserMessage('who are you', true).render(40)
    const band = triple(/\u001b\[48;2;(\d+);(\d+);(\d+)m/u.exec(rows[0] ?? '')?.slice(1))
    const inkStarts = [...(rows[1] ?? '').matchAll(/38;2;(\d+);(\d+);(\d+)/gu)]
    return { band, text: triple(inkStarts[0]?.slice(1)), arrow: triple(inkStarts[1]?.slice(1)) }
  } finally {
    if (colorterm === undefined) delete process.env.COLORTERM
    else process.env.COLORTERM = colorterm
  }
}

afterEach(() => {
  setTerminalPage(undefined)
})

test('the band is the editor level-1 heading band of the reported page', () => {
  for (const [background, red, yellow] of [
    ['#1b1d23', '#ff757f', '#ff9e64'],
    ['#282c34', '#cc6666', '#e5c07b'],
    ['#ffffff', '#d54e53', '#d8aa78'],
  ] as const) {
    const { band } = renderPrompt(background, '#e0e0e0', { red, yellow })
    expect(band).toEqual(headingBand(background, red, yellow))
  }
})

test('a page without a reported palette still gets the band, from the editor fallbacks', () => {
  const { band } = renderPrompt('#1b1d23', '#e0e0e0')
  // nvimConfig's `error` and `number` slots fall back to these inks when the
  // palette is silent, so both halves of the split agree.
  expect(band).toEqual(headingBand('#1b1d23', '#ff757f', '#ff9e64'))
})

test('the prompt keeps the terminal text ink, and the arrow fades back into the band', () => {
  const { band, text, arrow } = renderPrompt('#1b1d23', '#e0e0e0', { red: '#ff757f', yellow: '#ff9e64' })
  expect(text).toEqual([0xe0, 0xe0, 0xe0])
  expect(arrow).toEqual(blend(text, band, 0.45))
  // The arrow is quieter than the body on both ends of the terminal range.
  const light = renderPrompt('#ffffff', '#1e1e1e', { red: '#ff757f', yellow: '#ff9e64' })
  expect(light.text).toEqual([0x1e, 0x1e, 0x1e])
  expect(light.arrow).toEqual(blend(light.text, light.band, 0.45))
})

test('a terminal that reports nothing falls back to the editor fallback theme', () => {
  const silent = renderPrompt(undefined, undefined)
  const band = headingBand('#1b1d23', '#ff757f', '#ff9e64')
  expect(silent).toEqual({ band, text: [0xe8, 0xe8, 0xe8], arrow: blend([0xe8, 0xe8, 0xe8], band, 0.45) })
})

test('reporting the page again restyles the prompt', () => {
  const first = renderPrompt('#1b1d23', '#e0e0e0', { red: '#ff757f', yellow: '#ff9e64' })
  const second = renderPrompt('#000000', '#dddddd', { red: '#ff757f', yellow: '#ff9e64' })
  expect(second.band).not.toEqual(first.band)
})
