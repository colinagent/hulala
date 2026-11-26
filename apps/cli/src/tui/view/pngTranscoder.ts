/**
 * PNG for the kitty graphics protocol.
 *
 * The protocol transmits one raster format — `f=100`, PNG — and nothing else, so
 * a JPEG screenshot or a WebP download has no placement until it is re-encoded.
 * pi-tui takes a registered transcoder for exactly this gap (its `Image` calls
 * it for any non-PNG source on kitty), and this module supplies one: photon, a
 * WebAssembly image library with no native build and no platform package, loaded
 * on first need and registered once.
 *
 * The load is deliberately lazy and asynchronous. Most windows never show a
 * non-PNG image, and the library is a megabyte of WebAssembly that a frame must
 * not wait on: a row asks for the state, draws nothing for that one frame while
 * `loading`, and is redrawn when the transcoder registers. A machine where the
 * library is missing or the WebAssembly refuses to instantiate settles at
 * `unavailable`, and the row keeps the reference line it already had.
 *
 * Orientation is this module's own work. The bytes a photo was shot in can carry
 * an EXIF orientation that every viewer applies, kitty does not, and the durable
 * reference's width/height are the *perceived* ones — so converting the stored
 * raster as-is would draw a portrait photo sideways. The tag is read from the
 * JPEG APP1 segment (or the WebP EXIF chunk) and the pixel grid is placed
 * accordingly; photon's own `rotate` is a general-angle resampler, while these
 * eight transpositions are exact.
 *
 * @module hulala-cli/tui/view/pngTranscoder
 */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setImageTranscoder } from '@earendil-works/pi-tui'
import type { PhotonImage } from '@silvia-odwyer/photon-node'

/** Photon's module surface, taken from the package's own declarations. */
type Photon = typeof import('@silvia-odwyer/photon-node')

/** Where the transcoder stands, as a row that must draw something now decides. */
export type PngTranscoderState = 'ready' | 'loading' | 'unavailable'

/** The kitty PNG converter, shared by every row in a window. */
export interface PngTranscoder {
  /**
   * Make sure a transcoder is registered, loading it on the first non-PNG image.
   * @param onSettled - called once the load settles, whichever way it went.
   * @returns the state a caller can draw with right now.
   */
  ensure(onSettled: () => void): PngTranscoderState
}

/** `createRequire` roots, closest first: this module, its package, the packaged runtime. */
function loadFrom(base: string): Photon | undefined {
  try {
    return createRequire(join(base, 'package.json'))('@silvia-odwyer/photon-node') as Photon
  } catch {
    // Not installed, or its WebAssembly would not instantiate: either way this
    // layout cannot convert, and the next one might.
    return undefined
  }
}

/**
 * Load photon from whichever layout this client runs in.
 *
 * The packaged archive installs its dependency tree under `runtime/node_modules`,
 * outside ESM's search path — the same three layouts `ws` and `node-pty` are
 * resolved through.
 */
function loadPhoton(): Photon | undefined {
  const here = dirname(fileURLToPath(import.meta.url))
  return loadFrom(here) ?? loadFrom(dirname(here)) ?? loadFrom(join(dirname(here), 'runtime'))
}

/** Whether a byte range carries TIFF's `Exif\0\0` introducer. */
function hasExifHeader(bytes: Uint8Array, offset: number): boolean {
  return bytes[offset] === 0x45 && bytes[offset + 1] === 0x78 && bytes[offset + 2] === 0x69
    && bytes[offset + 3] === 0x66 && bytes[offset + 4] === 0x00 && bytes[offset + 5] === 0x00
}

/**
 * Byte offset of the TIFF header inside a JPEG's APP1 `Exif` segment.
 * @param bytes - the encoded JPEG.
 * @returns the offset, or -1 when the file has no EXIF block.
 */
function jpegTiffOffset(bytes: Uint8Array): number {
  let offset = 2
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1]!
    // A padding byte between segments is part of the marker.
    if (marker === 0xff) {
      offset += 1
      continue
    }
    // Start of scan: entropy-coded data, and no marker we can walk. End of
    // image: anything after it is a trailer (MPF, XMP), never the orientation.
    if (marker === 0xda || marker === 0xd9) return -1
    if (marker === 0xd8) {
      offset += 2
      continue
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!
    const start = offset + 4
    if (marker === 0xe1 && start + 6 <= bytes.length && hasExifHeader(bytes, start)) return start + 6
    // Entropy-coded data begins here: no EXIF segment can follow it.
    if (marker === 0xda) return -1
    offset = start + length
  }
  return -1
}

/**
 * Byte offset of the TIFF header inside a WebP's `EXIF` chunk.
 * @param bytes - the encoded WebP.
 * @returns the offset, or -1 when the file has no EXIF chunk.
 */
function webpTiffOffset(bytes: Uint8Array): number {
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!)
    const size = (bytes[offset + 4]! | (bytes[offset + 5]! << 8) | (bytes[offset + 6]! << 16) | (bytes[offset + 7]! << 24)) >>> 0
    const start = offset + 8
    if (id === 'EXIF') {
      if (start + size > bytes.length) return -1
      return size >= 6 && hasExifHeader(bytes, start) ? start + 6 : start
    }
    // RIFF chunks are padded to an even length.
    offset = start + size + (size % 2)
  }
  return -1
}

/**
 * The EXIF orientation of an encoded image, as its TIFF tag reports it.
 *
 * Only JPEG and WebP carry one in the formats an attachment may hold; PNG's
 * `eXIf` chunk is not written by any of the tools that produce one, and a PNG
 * whose pixels are already upright is the whole point of the format.
 *
 * @param bytes - the encoded image.
 * @returns `1`–`8`, defaulting to `1` (upright) for anything unreadable.
 */
export function exifOrientation(bytes: Uint8Array): number {
  let tiff = -1
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) tiff = jpegTiffOffset(bytes)
  else if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) tiff = webpTiffOffset(bytes)
  if (tiff === -1 || tiff + 8 > bytes.length) return 1

  const little = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49
  const read16 = (at: number): number => little
    ? bytes[at]! | (bytes[at + 1]! << 8)
    : (bytes[at]! << 8) | bytes[at + 1]!
  const read32 = (at: number): number => little
    ? (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0
    : ((bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!) >>> 0

  const directory = tiff + read32(tiff + 4)
  if (directory + 2 > bytes.length) return 1
  const entries = read16(directory)
  for (let index = 0; index < entries; index += 1) {
    const entry = directory + 2 + index * 12
    if (entry + 12 > bytes.length) return 1
    if (read16(entry) !== 0x0112) continue
    const value = read16(entry + 8)
    return value >= 1 && value <= 8 ? value : 1
  }
  return 1
}

/** One orientation's placement: whether it transposes, and where a pixel lands. */
interface Placement {
  /** Whether the destination is the source transposed (a quarter turn family). */
  readonly swap: boolean
  place(x: number, y: number, width: number, height: number): number
}

/**
 * Where each EXIF orientation puts a pixel, in destination row-major order.
 *
 * `1` is absent on purpose: an upright image needs no second buffer at all.
 */
const PLACEMENTS: Readonly<Record<number, Placement>> = {
  // Mirror horizontally: left and right swap, rows keep their order.
  2: { swap: false, place: (x, y, width) => y * width + (width - 1 - x) },
  // Rotate 180°.
  3: { swap: false, place: (x, y, width, height) => (height - 1 - y) * width + (width - 1 - x) },
  // Mirror vertically.
  4: { swap: false, place: (x, y, width, height) => (height - 1 - y) * width + x },
  // Transpose across the main diagonal.
  5: { swap: true, place: (x, y, _width, height) => x * height + y },
  // Rotate 90° clockwise.
  6: { swap: true, place: (x, y, _width, height) => x * height + (height - 1 - y) },
  // Transpose across the anti-diagonal.
  7: { swap: true, place: (x, y, width, height) => (width - 1 - x) * height + (height - 1 - y) },
  // Rotate 90° counter-clockwise.
  8: { swap: true, place: (x, y, width, height) => (width - 1 - x) * height + y },
}

/** One raster after an orientation has been applied. */
interface Oriented {
  readonly pixels: Uint8Array
  readonly width: number
  readonly height: number
}

/**
 * Apply an EXIF orientation to raw RGBA pixels.
 * @param pixels - source RGBA pixels, row-major.
 * @param width - source width in pixels.
 * @param height - source height in pixels.
 * @param orientation - EXIF orientation, `1`–`8`.
 * @returns the same pixels when upright, a transposed buffer otherwise.
 */
function transpose(pixels: Uint8Array, width: number, height: number, orientation: number): Oriented {
  const placement = PLACEMENTS[orientation]
  if (placement === undefined) return { pixels, width, height }
  const outWidth = placement.swap ? height : width
  const outHeight = placement.swap ? width : height
  const out = new Uint8Array(pixels.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4
      const to = placement.place(x, y, width, height) * 4
      out[to] = pixels[from]!
      out[to + 1] = pixels[from + 1]!
      out[to + 2] = pixels[from + 2]!
      out[to + 3] = pixels[from + 3]!
    }
  }
  return { pixels: out, width: outWidth, height: outHeight }
}

/**
 * Decode one encoded image and re-encode it as an upright PNG.
 * @param photon - the loaded library.
 * @param base64 - the image as the attachment store returned it.
 * @returns base64 PNG, or null when the bytes do not decode.
 */
function toPng(photon: Photon, base64: string): string | null {
  try {
    const bytes = Uint8Array.from(Buffer.from(base64, 'base64'))
    const decoded: PhotonImage = photon.PhotonImage.new_from_byteslice(bytes)
    let pixels: Uint8Array
    let width: number
    let height: number
    try {
      pixels = decoded.get_raw_pixels()
      width = decoded.get_width()
      height = decoded.get_height()
    } finally {
      decoded.free()
    }
    const oriented = transpose(pixels, width, height, exifOrientation(bytes))
    const image: PhotonImage = new photon.PhotonImage(oriented.pixels, oriented.width, oriented.height)
    try {
      return Buffer.from(image.get_bytes()).toString('base64')
    } finally {
      image.free()
    }
  } catch {
    // A corrupt or unsupported image is the caller's fallback to draw, not an
    // error to raise: pi-tui shows the reference line when the answer is null.
    return null
  }
}

/**
 * Build the window's transcoder.
 * @param load - photon loader, injected by tests; the module's own by default.
 * @returns the shared transcoder a row asks for before drawing a non-PNG image.
 */
export function createPngTranscoder(load: () => Photon | undefined = loadPhoton): PngTranscoder {
  let state: 'idle' | PngTranscoderState = 'idle'
  const waiting = new Set<() => void>()
  /** Notify the rows that asked, whichever way the load went. */
  const settle = (next: 'ready' | 'unavailable'): void => {
    state = next
    for (const listener of [...waiting]) listener()
    waiting.clear()
  }
  return {
    ensure(onSettled) {
      if (state === 'ready' || state === 'unavailable') return state
      waiting.add(onSettled)
      if (state === 'idle') {
        state = 'loading'
        // Outside the frame that asked: instantiating the WebAssembly takes
        // milliseconds, and the frame is already late when it reaches here.
        setTimeout(() => {
          const photon = load()
          if (photon === undefined) {
            settle('unavailable')
            return
          }
          setImageTranscoder((base64) => toPng(photon, base64))
          settle('ready')
        }, 0)
      }
      return 'loading'
    },
  }
}
