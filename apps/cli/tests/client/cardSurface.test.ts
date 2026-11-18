/**
 * The tool card is a surface, so it has to be placed against the page it is
 * drawn on: a fixed slab is invisible on a theme whose background is lighter than
 * it. These tests pin the derivation, not an exact colour, so the card may be
 * retuned without rewriting them.
 */
import { afterEach, expect, test } from 'bun:test'
import { setTerminalPage } from '../../src/tui/view/theme.js'
import { Transcript } from '../../src/tui/view/transcript.js'

/** Card surface and body ink of one rendered tool card. */
interface Render {
  /** The card's background. */
  card: [number, number, number]
  /** The command line's ink, i.e. the card's body text. */
  body: [number, number, number]
}

const reported = (hex: string): { r: number; g: number; b: number } => ({
  r: Number.parseInt(hex.slice(1, 3), 16),
  g: Number.parseInt(hex.slice(3, 5), 16),
  b: Number.parseInt(hex.slice(5, 7), 16),
})

const luminance = ([r, g, b]: readonly number[]): number => {
  const channel = (value: number): number => {
    const s = value / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!)
}

const contrast = (a: readonly number[], b: readonly number[]): number => {
  const [light, dark] = luminance(a) >= luminance(b) ? [a, b] : [b, a]
  return (luminance(light!) + 0.05) / (luminance(dark!) + 0.05)
}

const triple = (parts: ArrayLike<string | undefined> | undefined): [number, number, number] => [
  Number(parts?.[0]),
  Number(parts?.[1]),
  Number(parts?.[2]),
]

/** Draw one command card at the page the terminal reported. */
function renderCard(
  background: string | undefined,
  foreground: string | undefined,
  status: 'ok' | 'error' | 'running' | 'stopped' = 'ok',
): Render {
  const colorterm = process.env.COLORTERM
  process.env.COLORTERM = 'truecolor'
  try {
    setTerminalPage(background === undefined || foreground === undefined
      ? undefined
      : { background: reported(background), foreground: reported(foreground) })
    const transcript = new Transcript(true, () => ({ cwd: '/work/hulala' }))
    transcript.setItems([{
      kind: 'tool',
      name: 'bash',
      args: JSON.stringify({ command: 'bun test tests', description: 'Run the suite' }),
      result: 'pass 49\n[exit code: 0]',
      status,
      time: 0,
      durationMs: 120,
    }])
    const rows = transcript.render(64)
    const card = triple(/\u001b\[48;2;(\d+);(\d+);(\d+)m/u.exec(rows[1] ?? '')?.slice(1))
    // The command row re-opens the surface, then prints its text in body ink.
    const inks = [...(rows[2] ?? '').matchAll(/38;2;(\d+);(\d+);(\d+)/gu)]
    const body = triple(inks.at(-1)?.slice(1))
    return { card, body }
  } finally {
    if (colorterm === undefined) delete process.env.COLORTERM
    else process.env.COLORTERM = colorterm
  }
}

afterEach(() => {
  setTerminalPage(undefined)
})

test('on a dark page the card sits one soft step above it', () => {
  const page = [0x1e, 0x1e, 0x1e] as const
  const { card } = renderCard('#1e1e1e', '#e0e0e0')
  // Lighter than the page, and enough to read as a slab rather than a seam.
  expect(card.every(channel => channel > 0x1e)).toBe(true)
  expect(contrast(card, page)).toBeGreaterThanOrEqual(1.25)
  // Still a card, not a pale grey room: its own text has to stay well clear.
  expect(contrast([0xe0, 0xe0, 0xe0], card)).toBeGreaterThanOrEqual(7)
})

test('a page with no room above it, and no page at all, share one derived chip', () => {
  const light = renderCard('#ffffff', '#1e1e1e')
  const silent = renderCard(undefined, undefined)
  // A light page has nothing above it to step to, so it gets the same chip a
  // silent terminal does — derived once from the client's palette, not a literal.
  expect(light.card).toEqual(silent.card)
})

test('each state leans its own way, all at one weight', () => {
  const quiet = renderCard('#282c34', '#cdd0d4', 'ok').card
  const failed = renderCard('#282c34', '#cdd0d4', 'error').card
  const running = renderCard('#282c34', '#cdd0d4', 'running').card
  const stopped = renderCard('#282c34', '#cdd0d4', 'stopped').card

  // Landed leans green, failed leans red, running and stopped lean sand.
  expect(quiet[1]).toBeGreaterThan(quiet[0])
  expect(failed[0]).toBeGreaterThan(failed[1])
  expect(running[0]).toBeGreaterThan(running[2])
  expect(stopped[0]).toBeGreaterThan(stopped[1])

  // The tints are a suggestion, not a signal board: all four sit within a
  // hair of one lightness, and none of them is a saturated block.
  const lightness = (card: readonly number[]): number => Math.max(...card) + Math.min(...card)
  const weights = [quiet, failed, running, stopped].map(lightness)
  expect(Math.max(...weights) - Math.min(...weights)).toBeLessThanOrEqual(10)
  for (const card of [quiet, failed, running, stopped]) {
    expect(Math.max(...card) - Math.min(...card)).toBeLessThanOrEqual(16)
  }
})

test('the body ink follows the surface instead of a guess', () => {
  const { card, body } = renderCard('#1e1e1e', '#e0e0e0')
  expect(contrast(body, card)).toBeGreaterThanOrEqual(4.4)
})

test('reporting the page again restyles the card', () => {
  const first = renderCard('#1e1e1e', '#e0e0e0')
  const second = renderCard('#000000', '#dddddd')
  expect(second.card).not.toEqual(first.card)
})
