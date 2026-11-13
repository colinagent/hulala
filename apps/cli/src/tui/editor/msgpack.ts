/**
 * The msgpack subset Neovim's channel actually uses.
 *
 * This is deliberately not a general implementation: it encodes requests the
 * client sends (arrays, maps, strings, integers) and decodes what Neovim sends
 * back (the same, plus binary blobs and floats in style tables). Keeping it here
 * rather than adding a dependency is the same call the rest of the client makes
 * for small protocols, and it keeps the channel testable byte for byte.
 *
 * @module hulala-cli/tui/editor/msgpack
 */

/** One msgpack value as this client models it. */
export type Msgpack = null | boolean | number | string | Uint8Array | Msgpack[] | { [key: string]: Msgpack }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Growable byte sink, so one value needs no intermediate arrays. */
class Writer {
  private bytes = new Uint8Array(1024)
  private length = 0

  push(...values: number[]): void {
    for (const byte of values) {
      if (this.length === this.bytes.length) {
        const next = new Uint8Array(this.bytes.length * 2)
        next.set(this.bytes)
        this.bytes = next
      }
      this.bytes[this.length++] = byte
    }
  }

  raw(values: Uint8Array): void {
    for (const byte of values) this.push(byte)
  }

  finish(): Uint8Array {
    return this.bytes.slice(0, this.length)
  }
}

function writeInteger(out: Writer, value: number): void {
  if (!Number.isInteger(value)) throw new Error(`msgpack: ${value} is not an integer`)
  if (value >= 0 && value < 0x80) { out.push(value); return }
  if (value < 0 && value >= -32) { out.push(0xe0 | (value + 32)); return }
  if (value >= 0 && value < 0x100) { out.push(0xcc, value); return }
  if (value >= 0 && value < 0x10000) { out.push(0xcd, value >> 8, value & 0xff); return }
  if (value >= 0 && value < 0x100000000) {
    out.push(0xce, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff)
    return
  }
  if (value < 0 && value >= -0x80000000) {
    out.push(0xd2, (value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff)
    return
  }
  throw new Error(`msgpack: ${value} is outside the supported integer range`)
}

function writeString(out: Writer, value: string): void {
  const bytes = encoder.encode(value)
  const length = bytes.length
  if (length < 32) out.push(0xa0 | length)
  else if (length < 0x100) out.push(0xd9, length)
  else if (length < 0x10000) out.push(0xda, length >> 8, length & 0xff)
  else out.push(0xdb, (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff)
  out.raw(bytes)
}

function writeValue(out: Writer, value: Msgpack): void {
  if (value === null) { out.push(0xc0); return }
  if (value === true) { out.push(0xc3); return }
  if (value === false) { out.push(0xc2); return }
  if (typeof value === 'number') { writeInteger(out, value); return }
  if (typeof value === 'string') { writeString(out, value); return }
  if (value instanceof Uint8Array) {
    const length = value.length
    if (length < 0x100) out.push(0xc4, length)
    else if (length < 0x10000) out.push(0xc5, length >> 8, length & 0xff)
    else out.push(0xc6, (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff)
    out.raw(value)
    return
  }
  if (Array.isArray(value)) {
    const length = value.length
    if (length < 16) out.push(0x90 | length)
    else if (length < 0x10000) out.push(0xdc, length >> 8, length & 0xff)
    else out.push(0xdd, (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff)
    for (const item of value) writeValue(out, item)
    return
  }
  const entries = Object.entries(value)
  if (entries.length < 16) out.push(0x80 | entries.length)
  else if (entries.length < 0x10000) out.push(0xde, entries.length >> 8, entries.length & 0xff)
  else out.push(0xdf, (entries.length >>> 24) & 0xff, (entries.length >>> 16) & 0xff, (entries.length >>> 8) & 0xff, entries.length & 0xff)
  for (const [key, item] of entries) { writeString(out, key); writeValue(out, item) }
}

/**
 * Encode one value.
 * @param value - the value to encode.
 * @returns its msgpack bytes.
 */
export function encodeMsgpack(value: Msgpack): Uint8Array {
  const out = new Writer()
  writeValue(out, value)
  return out.finish()
}

/** The decoder ran out of bytes: more of the message is still on the wire. */
export class IncompleteMessage extends Error {
  constructor() {
    super('msgpack: incomplete message')
    this.name = 'IncompleteMessage'
  }
}

/** Reads one value from a buffer, remembering where it stopped. */
class Reader {
  private at = 0

  constructor(private readonly buffer: Uint8Array) {}

  get offset(): number { return this.at }

  private byte(): number {
    if (this.at >= this.buffer.length) throw new IncompleteMessage()
    return this.buffer[this.at++]!
  }

  private take(length: number): Uint8Array {
    if (this.at + length > this.buffer.length) throw new IncompleteMessage()
    const slice = this.buffer.subarray(this.at, this.at + length)
    this.at += length
    return slice
  }

  private u16(): number { return (this.byte() << 8) | this.byte() }
  private u32(): number { return ((this.byte() << 24) >>> 0) + (this.byte() << 16) + (this.byte() << 8) + this.byte() }
  private u64(): number {
    // Neovim sends small values; the high word is read but not rebuilt.
    const high = this.u32()
    const low = this.u32()
    return high * 0x100000000 + low
  }

  private string(length: number): string { return decoder.decode(this.take(length)) }

  /** One extension value: its signed type byte and raw payload. */
  private extension(length: number): Msgpack {
    const type = this.byte()
    return { type: type > 0x7f ? type - 0x100 : type, data: this.take(length).slice() }
  }

  value(): Msgpack {
    const tag = this.byte()
    if (tag < 0x80) return tag
    if (tag < 0x90) {
      const map: Record<string, Msgpack> = {}
      for (let index = 0; index < (tag & 0x0f); index += 1) {
        const key = this.value()
        map[typeof key === 'string' ? key : String(key)] = this.value()
      }
      return map
    }
    if (tag < 0xa0) {
      const array: Msgpack[] = []
      for (let index = 0; index < (tag & 0x0f); index += 1) array.push(this.value())
      return array
    }
    if (tag < 0xc0) return this.string(tag & 0x1f)
    // Negative fixint: -32..-1, the one family with no tag bit to branch on.
    if (tag >= 0xe0) return tag - 0x100
    switch (tag) {
      case 0xc0: return null
      case 0xc2: return false
      case 0xc3: return true
      case 0xc4: return this.take(this.byte())
      case 0xc5: return this.take(this.u16())
      case 0xc6: return this.take(this.u32())
      case 0xca: { this.take(4); return 0 }
      case 0xcb: {
        const bytes = this.take(8)
        return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0)
      }
      case 0xcc: return this.byte()
      case 0xcd: return this.u16()
      case 0xce: return this.u32()
      case 0xcf: return this.u64()
      case 0xd0: { const value = this.byte(); return value > 0x7f ? value - 0x100 : value }
      case 0xd1: { const value = this.u16(); return value > 0x7fff ? value - 0x10000 : value }
      case 0xd2: { const value = this.u32(); return value > 0x7fffffff ? value - 0x100000000 : value }
      case 0xd3: { const value = this.u64(); return value }
      // Extension values: Neovim uses them for window ids and metadata. A UI
      // never interprets one, so they decode to their type and payload instead
      // of being dropped, which would desync the rest of the message.
      case 0xd4: return this.extension(1)
      case 0xd5: return this.extension(2)
      case 0xd6: return this.extension(4)
      case 0xd7: return this.extension(8)
      case 0xd8: return this.extension(16)
      case 0xc7: return this.extension(this.byte())
      case 0xc8: return this.extension(this.u16())
      case 0xc9: return this.extension(this.u32())
      case 0xd9: return this.string(this.byte())
      case 0xda: return this.string(this.u16())
      case 0xdb: return this.string(this.u32())
      case 0xdc: {
        const array: Msgpack[] = []
        for (let index = 0, size = this.u16(); index < size; index += 1) array.push(this.value())
        return array
      }
      case 0xdd: {
        const array: Msgpack[] = []
        for (let index = 0, size = this.u32(); index < size; index += 1) array.push(this.value())
        return array
      }
      case 0xde: {
        const map: Record<string, Msgpack> = {}
        for (let index = 0, size = this.u16(); index < size; index += 1) map[String(this.value())] = this.value()
        return map
      }
      case 0xdf: {
        const map: Record<string, Msgpack> = {}
        for (let index = 0, size = this.u32(); index < size; index += 1) map[String(this.value())] = this.value()
        return map
      }
      default:
        throw new Error(`msgpack: unsupported tag 0x${tag.toString(16)}`)
    }
  }
}

/**
 * Decode every complete message in a buffer.
 *
 * A channel chunk may end mid-message, so the leftover byte count comes back
 * with the values: the caller keeps those bytes and prepends them to the next
 * chunk instead of dropping a partially delivered frame.
 * @param buffer - bytes received so far.
 * @returns the complete values and how many trailing bytes were incomplete.
 */
export function decodeMsgpack(buffer: Uint8Array): { values: Msgpack[]; consumed: number } {
  const reader = new Reader(buffer)
  const values: Msgpack[] = []
  for (;;) {
    const start = reader.offset
    try {
      values.push(reader.value())
    } catch (error) {
      if (!(error instanceof IncompleteMessage)) throw error
      return { values, consumed: start }
    }
  }
}
