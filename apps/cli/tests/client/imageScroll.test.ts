/**
 * A picture must keep drawing while part of it is still on screen.
 *
 * The conversation is a `ScrollView`, and a tool card paints its surface under
 * the placement: the rows below an image's first one are card fill — spaces with
 * SGR codes — not empty strings. pi-tui 1.4.0 searched upward from the viewport
 * top for the image line and stopped at the first row with any content, so once
 * an image's first row scrolled out, the lower half that was still visible was
 * dropped with it and the whole picture disappeared. 1.5.0 scans past those rows
 * and crops the placement to the rows left in view; these tests pin that floor.
 *
 * @module hulala-cli/tests/client/imageScroll
 */
import { afterEach, expect, test } from 'bun:test'
import { ScrollView, VStack, renderImage, resetCapabilitiesCache, setCapabilities, type Component } from '@earendil-works/pi-tui'
import { renderLayoutFrame } from '@earendil-works/pi-tui/dist/layout.js'

afterEach(() => {
  resetCapabilitiesCache()
})

/** Six rows tall, so scrolling by four still leaves its tail on screen. */
const IMAGE_ROWS = 6

/** A tool card's surface: a coloured, padded row, as `toolRow` fills it. */
const FILL = `\x1b[48;5;236m${' '.repeat(40)}\x1b[0m`

/**
 * A component drawing one image row, the card rows under it, then prose.
 * @param sequence - the placement `renderImage` produced.
 * @param prose - text rows after the card, so the image can also scroll away.
 * @returns the transcript stand-in.
 */
function cardedImage(sequence: string, prose: number): Component {
  return {
    render: () => [
      sequence,
      ...Array.from({ length: IMAGE_ROWS - 1 }, () => FILL),
      ...Array.from({ length: prose }, (_, index) => `line ${String(index)}`.padEnd(40)),
    ],
    invalidate: () => undefined,
  }
}

/**
 * Put a transcript stand-in under the frame's conversation viewport.
 * @param content - the transcript.
 * @returns the reusable viewport and the layout root that holds it.
 */
function viewport(content: Component): { scroll: ScrollView; root: Component } {
  const status: Component = { render: () => ['status'.padEnd(40)], invalidate: () => undefined }
  const scroll = new ScrollView(content, { follow: 'none', primary: true })
  const root = new VStack([{ component: scroll, basis: 0, grow: 1, shrink: 1, minSize: 1 }, { component: status, shrink: 1 }])
  return { scroll, root }
}

/**
 * One placement, six rows tall.
 * @param imageId - the kitty id this test owns.
 * @returns what `renderImage` drew for a 72×108 picture.
 */
function placedImage(imageId: number): string {
  const placed = renderImage(Buffer.from('x').toString('base64'), { widthPx: 72, heightPx: 108 }, {
    maxWidthCells: 8,
    maxHeightCells: IMAGE_ROWS,
    imageId,
    moveCursor: false,
  })
  expect(placed?.rows).toBe(IMAGE_ROWS)
  return placed!.sequence
}

test('a picture stays on screen once its first row scrolls out of the viewport', () => {
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
  const { scroll, root } = viewport(cardedImage(placedImage(41), 0))

  const first = renderLayoutFrame(root, 40, 4, () => undefined)
  expect(first.lines[0]).toContain('\x1b_G')

  scroll.scrollBy(4)
  // The image's first row is above the viewport, its tail is not: the old search
  // stopped at the card's fill rows and drew nothing at all.
  expect(scroll.scrollTop).toBeGreaterThan(0)
  expect(scroll.scrollTop).toBeLessThan(IMAGE_ROWS)
  const second = renderLayoutFrame(root, 40, 4, () => undefined)
  expect(second.lines[0]).toContain('\x1b_G')
  // Cropped to the rows still in view, not placed at its full height.
  expect(second.lines[0]).toContain('y=')
})

test('a picture scrolled entirely out of the viewport is not drawn', () => {
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
  const { scroll, root } = viewport(cardedImage(placedImage(42), 10))

  renderLayoutFrame(root, 40, 4, () => undefined)
  scroll.scrollBy(IMAGE_ROWS)
  expect(scroll.scrollTop).toBeGreaterThanOrEqual(IMAGE_ROWS)
  const frame = renderLayoutFrame(root, 40, 4, () => undefined)
  expect(frame.lines.some(line => line.includes('\x1b_G'))).toBe(false)
})
