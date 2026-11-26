import { afterEach, expect, test } from 'bun:test'
import { Image, resetCapabilitiesCache, setCapabilities, setImageTranscoder } from '@earendil-works/pi-tui'
import { createPngTranscoder, exifOrientation } from '../../src/tui/view/pngTranscoder.js'
import { JPEG_BYTES as JPEG } from './imageFixtures.js'

/** A kitty placement's payload: the base64 the terminal will decode. */
const KITTY_PAYLOAD = /\x1b_G[^;]*;([^\x1b]*)\x1b\\/u

afterEach(() => {
  resetCapabilitiesCache()
  setImageTranscoder(undefined)
})

/** One big-endian or little-endian TIFF block holding a single orientation tag. */
function tiff(orientation: number, little = true): number[] {
  const u16 = (value: number): number[] => little ? [value & 0xff, value >> 8] : [value >> 8, value & 0xff]
  const u32 = (value: number): number[] => little
    ? [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff]
    : [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
  return [
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42),
    ...u32(8), // IFD0 follows the header
    ...u16(1), // one entry
    ...u16(0x0112), // Orientation
    ...u16(3), // SHORT
    ...u32(1), // one value
    ...u16(orientation),
    ...u16(0), // value padded to four bytes
    ...u32(0), // no next directory
  ]
}

/** The JPEG fixture with an APP1 EXIF segment spliced in after its SOI marker. */
function jpegWith(orientation: number, little = true): Uint8Array {
  const body = tiff(orientation, little)
  const segment = [0xff, 0xe1, 0, 0, ...Buffer.from('Exif\0\0', 'latin1'), ...body]
  const length = segment.length - 2
  segment[2] = (length >> 8) & 0xff
  segment[3] = length & 0xff
  return Uint8Array.from([...JPEG.slice(0, 2), ...segment, ...JPEG.slice(2)])
}

/** The JPEG fixture wrapped as a WebP-shaped container with an EXIF chunk. */
function webpWith(orientation: number): Uint8Array {
  const body = tiff(orientation)
  const chunk = [...Buffer.from('EXIF', 'latin1'), body.length & 0xff, (body.length >> 8) & 0xff, 0, 0, ...body]
  const size = 4 + chunk.length
  return Uint8Array.from([
    ...Buffer.from('RIFF', 'latin1'), size & 0xff, (size >> 8) & 0xff, 0, 0,
    ...Buffer.from('WEBP', 'latin1'), ...chunk,
  ])
}

/** Width and height from a PNG's own IHDR. */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/** Register the window's transcoder and wait for the library to settle. */
async function ready(): Promise<void> {
  const transcoder = createPngTranscoder()
  const settled = new Promise<void>((resolve) => { transcoder.ensure(resolve) })
  expect(transcoder.ensure(() => {})).toBe('loading')
  await settled
  expect(transcoder.ensure(() => {})).toBe('ready')
}

/** Draw one image through pi-tui and decode the PNG the placement carries. */
function placedPng(base64: string, mimeType: string): Uint8Array | undefined {
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
  const image = new Image(base64, mimeType, { fallbackColor: (text: string) => text }, { maxWidthCells: 20 })
  const payload = KITTY_PAYLOAD.exec(image.render(60).join('\n'))?.[1]
  return payload === undefined ? undefined : new Uint8Array(Buffer.from(payload, 'base64'))
}

test('the orientation tag is read from JPEG, either byte order, and WebP', () => {
  expect(exifOrientation(JPEG)).toBe(1)
  expect(exifOrientation(jpegWith(6))).toBe(6)
  expect(exifOrientation(jpegWith(8, false))).toBe(8)
  expect(exifOrientation(webpWith(5))).toBe(5)
  // A tag outside the specification's range is not an orientation.
  expect(exifOrientation(jpegWith(9))).toBe(1)
  // Bytes that stop in the middle of the segment are unreadable, not a crash.
  expect(exifOrientation(jpegWith(6).slice(0, 12))).toBe(1)
})

test('a JPEG is converted to PNG for the kitty protocol', async () => {
  // Before the library loads, pi-tui has no transcoder and prints the reference.
  expect(placedPng(Buffer.from(JPEG).toString('base64'), 'image/jpeg')).toBeUndefined()

  await ready()
  const png = placedPng(Buffer.from(JPEG).toString('base64'), 'image/jpeg')
  expect(png?.slice(0, 8)).toEqual(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  expect(pngSize(png!)).toEqual({ width: 8, height: 4 })
})

test('a rotated photo is converted upright, so the placement keeps its aspect', async () => {
  await ready()
  const png = placedPng(Buffer.from(jpegWith(6)).toString('base64'), 'image/jpeg')
  // Orientation 6 is a quarter turn clockwise: the stored 8×4 raster is shown 4×8.
  expect(pngSize(png!)).toEqual({ width: 4, height: 8 })
})

test('a layout with no photon settles unavailable and keeps the reference line', async () => {
  const transcoder = createPngTranscoder(() => undefined)
  const settled = new Promise<void>((resolve) => { transcoder.ensure(resolve) })
  expect(transcoder.ensure(() => {})).toBe('loading')
  await settled
  expect(transcoder.ensure(() => {})).toBe('unavailable')
  expect(placedPng(Buffer.from(JPEG).toString('base64'), 'image/jpeg')).toBeUndefined()
})

test('an image that will not decode converts to nothing instead of throwing', async () => {
  await ready()
  const garbage = Buffer.from('not an image at all').toString('base64')
  expect(placedPng(garbage, 'image/jpeg')).toBeUndefined()
})
