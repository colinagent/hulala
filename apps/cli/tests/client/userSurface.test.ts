/**
 * The archived prompt is a band, not a chip: the editor's level-2 heading, both
 * its background and its ink — the page moved 10% of the way towards the
 * palette's yellow, and the prompt's text in that yellow itself. These tests pin
 * that derivation against the editor's own formula instead of a colour, so the
 * band and the `##` heading it mirrors cannot drift apart.
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

/** The editor's level-2 heading band: the page → the palette's yellow, at 10%. */
const headingBand = (page: string, yellow: string): [number, number, number] =>
  blend(from(page), from(yellow), 0.1)

/** The editor's level-2 heading ink: the palette's yellow, undimmed. */
const headingInk = (yellow: string): [number, number, number] => from(yellow)

/** The heading's `##` delimiters: `blend(hue, bg, 0.45)`. */
const delimiter = (ink: readonly number[], page: readonly number[]): [number, number, number] =>
  blend(ink, page, 0.45)

/** WCAG 2.1 contrast between two inks, so a readback can be judged, not guessed. */
const contrast = (a: readonly number[], b: readonly number[]): number => {
  const luminance = (rgb: readonly number[]): number => {
    const channel = (value: number): number => {
      const s = value / 255
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(rgb[0]!) + 0.7152 * channel(rgb[1]!) + 0.0722 * channel(rgb[2]!)
  }
  const [light, dark] = luminance(a) >= luminance(b) ? [a, b] : [b, a]
  return (luminance(light!) + 0.05) / (luminance(dark!) + 0.05)
}

/** A 16-entry palette whose yellow is the only slot these tests steer. */
const palette = (yellow: string): NonNullable<TerminalColors['palette']> =>
  Array.from({ length: 16 }, (_, index) => reported(index === 3 ? yellow : '#808080'))

/** What one terminal answered: a page, and a palette only when the case steers one. */
function answer(
  background: string | undefined,
  foreground: string | undefined,
  yellow?: string,
): TerminalColors | undefined {
  if (background === undefined || foreground === undefined) return undefined
  const colors: TerminalColors = { background: reported(background), foreground: reported(foreground) }
  if (yellow !== undefined) colors.palette = palette(yellow)
  return colors
}

/** Draw one prompt at the page and palette the terminal reported. */
function renderPrompt(background: string | undefined, foreground: string | undefined, yellow?: string): Render {
  const colorterm = process.env.COLORTERM
  process.env.COLORTERM = 'truecolor'
  try {
    setTerminalPage(answer(background, foreground, yellow))
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

test('the band is the editor level-2 heading band of the reported page', () => {
  for (const [background, yellow] of [
    ['#1b1d23', '#ff9e64'],
    ['#282c34', '#e5c07b'],
    ['#0b0e14', '#e5c07b'],
  ] as const) {
    const { band } = renderPrompt(background, '#e0e0e0', yellow)
    expect(band).toEqual(headingBand(background, yellow))
  }
})

test('a page without a reported palette still gets the band, from the editor fallback', () => {
  const { band } = renderPrompt('#1b1d23', '#e0e0e0')
  // nvimConfig's `number` slot falls back to this ink when the palette is silent,
  // so both halves of the split agree.
  expect(band).toEqual(headingBand('#1b1d23', '#ff9e64'))
})

test('the prompt is drawn in the heading ink, and the arrow in the delimiters’ fade', () => {
  const { band, text, arrow } = renderPrompt('#1b1d23', '#e0e0e0', '#ff9e64')
  expect(band).toEqual(headingBand('#1b1d23', '#ff9e64'))
  // The ink is the heading's, not the terminal's foreground: the prompt and `##`
  // are one colour, so a light page does not flip the prompt to dark either.
  expect(text).toEqual(headingInk('#ff9e64'))
  expect(arrow).toEqual(delimiter(text, from('#1b1d23')))
})

test('a pale palette on a light page is deepened until the prompt still reads', () => {
  const pale = '#d8aa78'
  const { band, text, arrow } = renderPrompt('#ffffff', '#1e1e1e', pale)
  // The heading's own ink would vanish here, so it is moved away from the band
  // rather than drawn at 2:1 — but only that far.
  expect(contrast(headingInk(pale), band)).toBeLessThan(4.5)
  expect(contrast(text, band)).toBeGreaterThanOrEqual(4.5)
  expect(text).not.toEqual(headingInk(pale))
  expect(arrow).toEqual(delimiter(text, from('#ffffff')))
})

test('a terminal that reports nothing falls back to the editor fallback theme', () => {
  const silent = renderPrompt(undefined, undefined)
  expect(silent).toEqual({
    band: headingBand('#1b1d23', '#ff9e64'),
    text: headingInk('#ff9e64'),
    arrow: delimiter(headingInk('#ff9e64'), from('#1b1d23')),
  })
})

test('reporting the page again restyles the prompt', () => {
  const first = renderPrompt('#1b1d23', '#e0e0e0', '#ff9e64')
  const second = renderPrompt('#000000', '#dddddd', '#ff9e64')
  expect(second.band).not.toEqual(first.band)
})
