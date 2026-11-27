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
 * The crop has to reach the conversation's own column, not the terminal's first
 * one. 1.6.1 painted the cropped placement only while the viewport was the whole
 * terminal (`rect.x === 0 && rect.width >= totalWidth`), so a conversation beside
 * the session rail or the editor column drew the picture while its first row was
 * in view and dropped it the moment it scrolled — the exact frame the rail's
 * clients reported. These tests pin the composite as well as the crop.
 *
 * @module hulala-cli/tests/client/imageScroll
 */
import { afterEach, expect, test } from 'bun:test'
import { ScrollView, VStack, renderImage, resetCapabilitiesCache, setCapabilities, visibleWidth, type Component } from '@earendil-works/pi-tui'
import { renderLayoutFrame, type LayoutBox } from '@earendil-works/pi-tui/dist/layout.js'
import { LOGO_PNG_BASE64 } from '../../src/brand/logoPng.js'
import type { ToolImage, TranscriptItem } from '../../src/tui/data/viewModel.js'
import { buildRailTerminalLayout, buildSplitTerminalLayout } from '../../src/tui/view/layout.js'
import { createToolImagery } from '../../src/tui/view/toolImages.js'
import { Transcript } from '../../src/tui/view/transcript.js'

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

/** The durable reference the transcript's picture is read through. */
const RESULT_IMAGE: ToolImage = {
  attachmentId: 'sha256:image-scroll',
  mediaType: 'image/png',
  bytes: 4_021,
  width: 800,
  height: 600,
  name: 'shot.png',
}

/** A row a layout only needs for its columns: the label, then page background. */
function plainRow(label: string): Component {
  return { render: (width: number) => [label.padEnd(width)], invalidate: () => undefined }
}

/** A conversation with a call whose result is one picture, then prose to scroll past. */
function pictureItems(): TranscriptItem[] {
  return [
    { kind: 'user', text: 'what is in this picture?', time: 0 },
    {
      kind: 'tool',
      name: 'read_image',
      args: JSON.stringify({ file_path: '/work/shot.png' }),
      result: 'a picture',
      status: 'ok',
      time: 0,
      images: [RESULT_IMAGE],
    },
    { kind: 'assistant', text: 'A chart.', streaming: false, time: 0 },
  ]
}

/** Wait for the attachment read the transcript started to settle. */
const settled = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0) })

/** The layout box that owns one scroll view, wherever the frame put it. */
function scrollBox(root: LayoutBox, scroll: ScrollView): LayoutBox | undefined {
  if (root.scrollView === scroll) return root
  for (const child of root.children) {
    const found = scrollBox(child, scroll)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * One frame of a laid-out conversation, with the picture's own row located.
 *
 * The transcript's document is drawn at the conversation column's width, the
 * same one the frame gave the viewport, so the row indices the crop searches are
 * the ones the test scrolls to.
 * @param build - the layout under test, sharing the frame's transcript.
 * @param width - the terminal's columns.
 * @returns the viewport and the layout root to frame, the content row holding
 *   the placement, and the column that row is drawn in.
 */
async function pictureFrame(
  build: (transcript: Transcript) => { root: Component; transcriptScroll: ScrollView },
  width: number,
): Promise<{ scroll: ScrollView; root: Component; imageRow: number; column: number }> {
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
  const imagery = createToolImagery({
    read: async () => Uint8Array.from(Buffer.from(LOGO_PNG_BASE64, 'base64')),
    onChange: () => undefined,
    color: false,
  })
  const transcript = new Transcript(false, () => ({ cwd: '/work' }), undefined, imagery)
  transcript.setItems(pictureItems())
  const { root, transcriptScroll } = build(transcript)
  // The first frame asks for the bytes; the one after the read settles draws them.
  renderLayoutFrame(root, width, 14, () => undefined)
  await settled()
  const frame = renderLayoutFrame(root, width, 14, () => undefined)
  const box = scrollBox(frame.root, transcriptScroll)
  expect(box).toBeDefined()
  const imageRow = transcript.render(box!.rect.width).findIndex(line => line.includes('\x1b_G'))
  expect(imageRow).toBeGreaterThan(0)
  return { scroll: transcriptScroll, root, imageRow, column: box!.rect.x }
}

test('a picture keeps drawing beside the session rail once its first row scrolls out', async () => {
  const { scroll, root, imageRow, column } = await pictureFrame(transcript => buildRailTerminalLayout({
    transcript,
    pending: plainRow(''),
    editor: plainRow('composer'),
    statusBar: plainRow('status'),
    rail: plainRow('rail'),
    railWidth: 20,
    railDivider: plainRow('|'),
    conversationFocused: () => true,
    composerFocused: () => true,
    color: false,
  }), 100)
  expect(column).toBeGreaterThan(0)

  scroll.scrollTo(imageRow + 1)
  const frame = renderLayoutFrame(root, 100, 14, () => undefined)
  const drawn = frame.lines.find(line => line.includes('\x1b_G'))
  expect(drawn).toBeDefined()
  // Cropped to the rows still in view, and inside the conversation's columns:
  // the rail is still beside it.
  expect(drawn!).toContain('y=')
  expect(drawn!).toContain('rail')
  expect(visibleWidth(drawn!.replace(/\x1b_G[^\x1b]*\x1b\\/g, ''))).toBe(100)
})

test('a picture keeps drawing beside the editor column once its first row scrolls out', async () => {
  const { scroll, root, imageRow } = await pictureFrame(transcript => buildSplitTerminalLayout({
    transcript,
    pending: plainRow(''),
    editor: plainRow('composer'),
    statusBar: plainRow('status'),
    pane: plainRow('pane'),
    paneWidth: 40,
    divider: plainRow('|'),
    onConversationPointer: () => undefined,
    conversationFocused: () => true,
    composerFocused: () => true,
    color: false,
  }), 120)

  scroll.scrollTo(imageRow + 1)
  const frame = renderLayoutFrame(root, 120, 14, () => undefined)
  const drawn = frame.lines.find(line => line.includes('\x1b_G'))
  expect(drawn).toBeDefined()
  expect(drawn!).toContain('y=')
  expect(drawn!).toContain('pane')
  expect(visibleWidth(drawn!.replace(/\x1b_G[^\x1b]*\x1b\\/g, ''))).toBe(120)
})
