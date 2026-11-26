import { afterEach, expect, test } from 'bun:test'
import { resetCapabilitiesCache, setCapabilities, setImageTranscoder } from '@earendil-works/pi-tui'
import { LOGO_PNG_BASE64 } from '../../src/brand/logoPng.js'
import type { ToolImage, TranscriptItem } from '../../src/tui/data/viewModel.js'
import { ViewModelReducer, imagesOf, resultText } from '../../src/tui/data/viewModel.js'
import type { PngTranscoder, PngTranscoderState } from '../../src/tui/view/pngTranscoder.js'
import { createToolImagery, type ToolImagery } from '../../src/tui/view/toolImages.js'
import { ToolRowView } from '../../src/tui/view/toolRow.js'
import { JPEG_BYTES } from './imageFixtures.js'

/** A durable image reference as `read_image` returns one. */
const IMAGE: ToolImage = {
  attachmentId: 'sha256:6f1c0a',
  mediaType: 'image/png',
  bytes: 4_021,
  width: 800,
  height: 600,
  name: 'shot.png',
}

const BYTES = Uint8Array.from(Buffer.from(LOGO_PNG_BASE64, 'base64'))

function kitty(): void {
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
}

function plain(): void {
  setCapabilities({ images: null, trueColor: true, hyperlinks: false })
}

/** The same durable reference, with a format kitty cannot transmit as-is. */
const JPEG: ToolImage = { ...IMAGE, mediaType: 'image/jpeg', name: 'photo.jpg' }

afterEach(() => {
  resetCapabilitiesCache()
  setImageTranscoder(undefined)
})

/** One settled `read_image` row, as the reducer stores it. */
function item(images: readonly ToolImage[] = [IMAGE]): TranscriptItem & { kind: 'tool' } {
  const entry: TranscriptItem = {
    kind: 'tool',
    name: 'read_image',
    args: JSON.stringify({ file_path: '/work/shot.png' }),
    result: 'image/png image, 800x600 px, 4021 bytes',
    status: 'ok',
    time: 0,
    images,
  }
  if (entry.kind !== 'tool') throw new Error('unreachable')
  return entry
}

function row(imagery: ToolImagery | undefined, images?: readonly ToolImage[]): ToolRowView {
  return new ToolRowView(item(images ?? [IMAGE]), () => ({ cwd: '/work' }), false, () => false, () => '  ', imagery)
}

/** Wait for the read promise the store started to settle. */
const settled = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0) })

test('narrows the well-formed image blocks of a result', () => {
  const content = [
    { type: 'text', text: 'a picture' },
    { type: 'image', attachment: IMAGE },
    { type: 'image', attachment: { ...IMAGE, attachmentId: '' } },
    { type: 'image', attachment: { ...IMAGE, mediaType: 'image/tiff' } },
    { type: 'image', attachment: { ...IMAGE, width: 0 } },
    { type: 'image', attachment: { ...IMAGE, bytes: '4' } },
    { type: 'image', attachment: { ...IMAGE, name: 12 } },
    { type: 'image' },
    'not a block',
  ]
  expect(imagesOf(content)).toEqual([IMAGE])
})

test('a result image is drawn, not printed as a reference', () => {
  const text = resultText([
    { type: 'text', text: 'image/png image, 800x600 px' },
    { type: 'image', attachment: IMAGE },
  ])
  expect(text).toBe('image/png image, 800x600 px')
  expect(text).not.toContain('attachmentId')
  // A block the client does not know stays visible as its JSON: nothing is hidden.
  expect(resultText([{ type: 'custom', value: 1 }])).toContain('"custom"')
})

test('a settled tool result keeps its durable images', () => {
  const reducer = new ViewModelReducer()
  reducer.applyEvent({ type: 'tool/call', seq: 1, time: 0, data: { callId: 'c1', name: 'read_image', arguments: '{}' } })
  reducer.applyEvent({
    type: 'tool/result',
    seq: 2,
    time: 0,
    data: { message: { toolCallId: 'c1', isError: false, content: [{ type: 'image', attachment: IMAGE }] } },
  })
  expect(reducer.items[0]).toMatchObject({ kind: 'tool', status: 'ok', result: '', images: [IMAGE] })
})

test('a terminal with no graphics protocol is never asked for the bytes', async () => {
  plain()
  const reads: string[] = []
  const imagery = createToolImagery({
    read: async (image) => { reads.push(image.attachmentId); return BYTES },
    onChange: () => {},
    color: false,
  })
  const lines = row(imagery).render(80).join('\n')
  await settled()
  expect(reads).toEqual([])
  expect(lines).toContain('[Image: shot.png [image/png] 800x600]')
  expect(lines).not.toContain('\x1b_G')
})

test('a read image is placed on the frame that follows its bytes', async () => {
  kitty()
  let changes = 0
  const reads: string[] = []
  const imagery = createToolImagery({
    read: async (image) => { reads.push(image.attachmentId); return BYTES },
    onChange: () => { changes += 1 },
    color: false,
  })
  const view = row(imagery)

  // Rendering starts the one read and draws the title alone until it lands.
  const pending = view.render(80)
  expect(reads).toEqual(['sha256:6f1c0a'])
  expect(pending.join('\n')).not.toContain('\x1b_G')

  await settled()
  expect(changes).toBe(1)
  expect(imagery.revision(IMAGE)).toBe(1)
  const drawn = view.render(80)
  expect(drawn.join('\n')).toContain('\x1b_G')
  expect(drawn.length).toBeGreaterThan(pending.length)

  // One attachment, one read: a repaint re-uses the placement, it does not ask again.
  expect(view.render(80)).toBe(drawn)
  expect(reads).toEqual(['sha256:6f1c0a'])
})

test('a JPEG waits for the converter instead of flashing its reference line', async () => {
  kitty()
  let state: PngTranscoderState = 'loading'
  let onSettled: (() => void) | undefined
  let requested = 0
  const transcoder: PngTranscoder = {
    ensure(listener) {
      requested += 1
      onSettled = listener
      return state
    },
  }
  const imagery = createToolImagery({
    read: async () => BYTES,
    onChange: () => {},
    color: false,
    transcoder,
  })
  const view = row(imagery, [JPEG])
  // The read starts here; there is nothing to draw yet.
  expect(view.render(80).join('\n')).not.toContain('[Image:')
  await settled()
  // The bytes are here and the converter is still loading. A reference line
  // now would be replaced a frame later, which reads as a flicker.
  expect(view.render(80).join('\n')).not.toContain('[Image:')
  expect(requested).toBe(1)

  // The library registers its converter and reports back, and the row is redrawn.
  setImageTranscoder(() => LOGO_PNG_BASE64)
  state = 'ready'
  onSettled?.()
  expect(view.render(80).join('\n')).toContain('\u001b_G')
})

test('clearing the cache forgets the bytes the last Session drew', async () => {
  kitty()
  const reads: string[] = []
  const imagery = createToolImagery({
    read: async (image) => { reads.push(image.attachmentId); return BYTES },
    onChange: () => {},
    color: false,
    transcoder: { ensure: () => 'ready' },
  })
  const view = row(imagery)
  view.render(80)
  await settled()
  expect(reads).toEqual(['sha256:6f1c0a'])
  expect(imagery.revision(IMAGE)).toBe(1)

  // A Session switch drops the picture with the rows it was drawn for.
  imagery.clear()
  expect(imagery.revision(IMAGE)).toBe(0)
  const rebuilt = row(imagery)
  rebuilt.render(80)
  await settled()
  expect(reads).toEqual(['sha256:6f1c0a', 'sha256:6f1c0a'])
  expect(rebuilt.render(80).join('\n')).toContain('\u001b_G')
})

test('a read that lands after a clear is not drawn', async () => {
  kitty()
  let release: (() => void) | undefined
  let changes = 0
  const imagery = createToolImagery({
    read: async () => await new Promise<Uint8Array>((resolve) => { release = () => { resolve(BYTES) } }),
    onChange: () => { changes += 1 },
    color: false,
    transcoder: { ensure: () => 'ready' },
  })
  const view = row(imagery)
  view.render(80)
  // The Session changed while the bytes were still on their way.
  imagery.clear()
  release?.()
  await settled()
  expect(changes).toBe(0)
  expect(imagery.revision(IMAGE)).toBe(0)
})

test('the window draws a JPEG through its own converter', async () => {
  kitty()
  const imagery = createToolImagery({
    read: async () => JPEG_BYTES,
    onChange: () => {},
    color: false,
  })
  const view = row(imagery, [JPEG])
  // The read starts, then the converter loads; both settle asynchronously, and
  // no frame in between shows the reference line: the picture is on its way.
  let lines = view.render(80).join('\n')
  for (let attempt = 0; attempt < 100 && !lines.includes('\u001b_G'); attempt += 1) {
    expect(lines).not.toContain('[Image:')
    await settled()
    lines = view.render(80).join('\n')
  }
  expect(lines).toContain('\u001b_G')
})

test('an image settling redraws its own row, not every picture', async () => {
  kitty()
  const other: ToolImage = { ...IMAGE, attachmentId: 'sha256:other', name: 'other.png' }
  /** Reads that resolve only when this test says so, in draw order. */
  const releases: Array<() => void> = []
  const imagery = createToolImagery({
    read: async () => await new Promise<Uint8Array>((resolve) => {
      releases.push(() => { resolve(BYTES) })
    }),
    onChange: () => {},
    color: false,
    transcoder: { ensure: () => 'ready' },
  })
  const first = row(imagery, [IMAGE])
  const second = row(imagery, [other])
  first.render(80)
  second.render(80)
  expect(releases).toHaveLength(2)

  // The second row's picture arrives and is drawn; that is now its cached frame.
  releases[1]?.()
  await settled()
  const drawn = second.render(80)
  expect(drawn.join('\n')).toContain('\u001b_G')

  // The first row's picture arrives afterwards. Its own redraw must not touch
  // the other row: same array, no re-encode, no re-upload.
  releases[0]?.()
  await settled()
  first.render(80)
  expect(second.render(80)).toBe(drawn)
})

test('a JPEG with no converter keeps the reference line', async () => {
  kitty()
  const imagery = createToolImagery({
    read: async () => BYTES,
    onChange: () => {},
    color: false,
    transcoder: { ensure: () => 'unavailable' },
  })
  const view = row(imagery, [JPEG])
  view.render(80)
  await settled()
  const lines = view.render(80).join('\n')
  expect(lines).toContain('[Image: photo.jpg [image/jpeg] 800x600]')
  expect(lines).not.toContain('\u001b_G')
})

test('a PNG never asks for a converter', async () => {
  kitty()
  let requested = 0
  const imagery = createToolImagery({
    read: async () => BYTES,
    onChange: () => {},
    color: false,
    transcoder: { ensure: () => { requested += 1; return 'ready' } },
  })
  const view = row(imagery)
  view.render(80)
  await settled()
  expect(view.render(80).join('\n')).toContain('\u001b_G')
  expect(requested).toBe(0)
})

test('the same image in a second row shares the one read', async () => {
  kitty()
  let reads = 0
  const imagery = createToolImagery({
    read: async () => { reads += 1; return BYTES },
    onChange: () => {},
    color: false,
  })
  row(imagery).render(80)
  await settled()
  expect(row(imagery).render(80).join('\n')).toContain('\x1b_G')
  expect(reads).toBe(1)
})

test('a refused read leaves the reference line instead of a picture', async () => {
  kitty()
  const imagery = createToolImagery({
    read: async () => { throw new Error('attachment not found') },
    onChange: () => {},
    color: false,
  })
  const view = row(imagery)
  expect(view.render(80).join('\n')).not.toContain('\x1b_G')
  await settled()
  const lines = view.render(80).join('\n')
  expect(lines).toContain('[Image: shot.png [image/png] 800x600]')
  expect(lines).not.toContain('\x1b_G')
})

test('a row without a read route draws its text alone', () => {
  kitty()
  const lines = row(undefined).render(80).join('\n')
  expect(lines).toContain('Read image')
  expect(lines).not.toContain('[Image:')
  expect(lines).not.toContain('\x1b_G')
})
