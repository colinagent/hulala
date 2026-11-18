/**
 * Output that cannot stop the loop which reads input, and that tells the truth
 * about what it delivered.
 *
 * A tty write is synchronous in Node, and a terminal stops draining its side of
 * the pty when it is busy — after a wake, while it relayouts, while the machine
 * is swapping. That blocks the event loop, and an event loop that is blocked does
 * not read stdin. The pty's input queue holds about a kilobyte, the terminal has
 * been writing mouse reports into it all along, and what it could not fit is
 * gone: the next read starts in the middle of a report. That chain is why the
 * parser learned to expect truncated sequences; this module removes its cause.
 *
 * A frame is queued here and written from the thread pool, so a stalled terminal
 * can only block a pool thread. Frames keep their order and are never cut, and a
 * queue that grows past its cap loses whole messages rather than bytes.
 *
 * The queue is also where "this frame reached the screen" stops being automatic.
 * pi-tui paints a differential frame against its own copy of the screen and
 * advances that copy as soon as `write()` returns — true for a synchronous sink,
 * false once a queue sits underneath. So every discarded message is reported
 * through {@link BufferedOptions.onLost}: the renderer throws its copy away and
 * repaints every row next time. A frame lost without a report leaves the renderer
 * diffing against content the terminal does not have, and nothing later repairs
 * those cells.
 *
 * Two exits matter more than the queue. A successor process inherits the
 * terminal, so the queue has to be drained *before* it starts — `drain` is that
 * promise. The exit sequence has to be the last thing the terminal sees, which is
 * why `flushSync` writes what is queued right then and gives up on a terminal
 * that will not take it: nothing may run after the restore. Those two paths
 * discard silently by design — the screen is being handed back, so a frame that
 * never arrived has nothing left to corrupt — which is why only the live paths
 * report.
 *
 * @module hulala-cli/tui/terminal/writer
 */

import { write as writeAsync, writeSync } from 'node:fs'

/** A stream the adapter can paint: the surface pi-tui's Terminal expects. */
export interface OutputSurface {
  write(data: string): void
  isTTY?: boolean
  columns?: number
  rows?: number
  on?: (event: string, listener: () => void) => void
  removeListener?: (event: string, listener: () => void) => void
}

/** The grid a frame was composed for. */
export interface FrameGeometry {
  readonly columns: number
  readonly rows: number
}

/**
 * Why a message the renderer counted as painted never reached the terminal.
 *
 * `cap` is the queue refusing a message because the terminal is not reading,
 * `error` is the descriptor refusing it for any other reason than a full pty, and
 * `geometry` is the message being composed for a grid the terminal no longer has.
 */
export type LostReason = 'cap' | 'error' | 'geometry'

/**
 * A bare control character a frame row carried.
 *
 * `row` is the 1-based terminal row the frame was positioning when the byte was
 * found; `code` is its code point. Together they name the exact cell whose
 * "impossible" content a reproduction is chasing.
 */
export interface FrameControl {
  readonly row: number
  readonly code: number
  readonly count: number
}

/** What the surface has done, for the diagnostic trace. */
export interface WriterStats {
  /** Frames handed to the queue, whether or not they were written. */
  readonly composed: number
  /** Frames whose last byte the sink took. */
  readonly committed: number
  /** Messages discarded, by reason. */
  readonly lost: Readonly<Record<LostReason, number>>
}

/** The surface a buffered writer paints through. */
export interface BufferedSurface extends OutputSurface {
  /** Write whatever is queued, synchronously, then forget it. */
  flushSync(): void
  /** Resolve once every queued message has reached the terminal. */
  drain(): Promise<void>
  /** Bytes waiting for the terminal; zero means the frame is on the wire. */
  pendingBytes(): number
  /** Counters for the diagnostic trace. */
  stats(): WriterStats
  /** Stop writing; a queue still holding messages is dropped. */
  dispose(): void
}

/**
 * Where queued bytes go.
 *
 * Injected so the queue can be tested without a terminal: `write` offers as much
 * of the chunk as the sink will take right now and reports how much that was,
 * which is what a pty does when its input queue is full.
 */
export interface WriterSink {
  write(chunk: Buffer, done: (error: NodeJS.ErrnoException | null, written: number) => void): void
  writeSync(chunk: Buffer): number
}

/** Options for a buffered writer. */
export interface BufferedOptions {
  /**
   * How much output may wait for the terminal before messages are dropped.
   *
   * A screenful at 200 columns is about 40 KB, so this is a hundred frames: far
   * beyond any burst a frame loop produces, and small enough that a terminal that
   * stopped reading cannot grow the process without bound.
   */
  readonly capBytes?: number
  /**
   * Called once per discarded message, while the surface is live.
   *
   * The renderer's only way to know that its copy of the screen is wrong. Do not
   * swallow it: a report that is not made is a row that is never repainted.
   * @param reason - which path dropped it.
   */
  readonly onLost?: (reason: LostReason) => void
  /** How long `flushSync` keeps trying a terminal that will not take the bytes. */
  readonly flushDeadlineMs?: number
  /**
   * The terminal's size right now.
   *
   * A frame stamped with a different geometry is dropped instead of written: its
   * rows and columns are absolute, so applying it to another grid can wrap a row
   * (and, on the last row, scroll the screen) — a shift nothing on this side can
   * observe afterwards.
   */
  readonly size?: () => { readonly columns: number | undefined; readonly rows: number | undefined }
}

/** Options for the surface pi-tui paints through. */
export interface BufferedOutputOptions extends BufferedOptions {
  /**
   * Called once per frame that carried bare control characters, before they are
   * removed.
   *
   * The row and the codes are the diagnosis: a raw LF in row 13 says a
   * multi-line string reached a one-line component, not that a frame was lost.
   * @param controls - what was removed, grouped by row and code.
   */
  readonly onControl?: (controls: readonly FrameControl[]) => void
}

/** The writer the adapter paints through. */
export interface BufferedWriter {
  /**
   * Queue one message and return at once.
   * @param data - the bytes.
   * @param geometry - the grid this message was composed for, when it is a frame.
   */
  write(data: string, geometry?: FrameGeometry): void
  /** Write whatever is queued, synchronously. */
  flushSync(): void
  /** Resolve once everything queued has been written. */
  drain(): Promise<void>
  /** Bytes waiting for the terminal; zero means the frame is on the wire. */
  pendingBytes(): number
  /** Counters for the diagnostic trace. */
  stats(): WriterStats
  /** Stop writing; anything still queued is dropped. */
  dispose(): void
}

/** The cap a buffered writer starts with. */
const DEFAULT_CAP_BYTES = 4 * 1024 * 1024

/** How long the final flush may spin before it gives up on the terminal. */
const DEFAULT_FLUSH_DEADLINE_MS = 200

/** How long a blocking flush or a retry sleeps, in milliseconds. */
const POLL_MS = 2

/** One queued message: the text, how much of it went out, and its grid. */
interface Message {
  readonly bytes: Buffer
  offset: number
  readonly geometry: FrameGeometry | undefined
}

/**
 * Sleep without yielding to the event loop.
 *
 * `flushSync` runs where the loop is about to end, so a timer would never fire.
 * The wait is capped by the caller's deadline.
 * @param ms - milliseconds to wait.
 */
function blockFor(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** The sink a terminal's descriptor gives: one thread-pool write at a time. */
function fdSink(fd: number): WriterSink {
  return {
    write: (chunk, done) => { writeAsync(fd, chunk, 0, chunk.length, null, done) },
    writeSync: chunk => writeSync(fd, chunk),
  }
}

/**
 * Build the queue over one sink.
 * @param sink - where the bytes go.
 * @param options - cap, geometry, loss report and flush deadline.
 * @returns the writer.
 */
export function createBufferedWriter(sink: WriterSink, options: BufferedOptions = {}): BufferedWriter {
  const cap = options.capBytes ?? DEFAULT_CAP_BYTES
  const deadline = options.flushDeadlineMs ?? DEFAULT_FLUSH_DEADLINE_MS
  const queue: Message[] = []
  /** The message the sink is writing, if any. */
  let inflight: Message | undefined
  let head = 0
  let queued = 0
  let busy = false
  /** True while {@link pump} is running: a report must never re-enter it. */
  let pumping = false
  let closed = false
  let composed = 0
  let committed = 0
  const lost: Record<LostReason, number> = { cap: 0, error: 0, geometry: 0 }
  /**
   * Reasons found since the last report.
   *
   * A set: a burst of a hundred refused frames is one repair, and the listener
   * that runs it may write again, so the same reason must not queue up a hundred
   * times behind it.
   */
  const notes = new Set<LostReason>()
  let reporting = false
  let retry: ReturnType<typeof setTimeout> | undefined
  const drained = Promise.withResolvers<void>()
  let waiting = false

  const settle = (): void => {
    if (!waiting) return
    // A disposed writer has abandoned whatever the sink still holds, so a drain
    // waiting on it has nothing left to wait for.
    if (!closed && (busy || queued > 0)) return
    waiting = false
    drained.resolve()
  }

  /**
   * Report whatever was discarded, once per reason.
   *
   * The listener is the renderer's "throw your copy of the screen away", which
   * may compose and queue a frame immediately — hence the flag. A nested
   * {@link pump} would take the same head message twice.
   */
  const report = (): void => {
    if (reporting || notes.size === 0) return
    reporting = true
    try {
      for (;;) {
        const next = notes.values().next()
        if (next.done === true) return
        notes.delete(next.value)
        options.onLost?.(next.value)
      }
    } finally {
      reporting = false
    }
  }

  /** Remember one discarded message, then report it. */
  const note = (reason: LostReason): void => {
    lost[reason] += 1
    notes.add(reason)
  }

  /** Take a message out of the queue, whatever happened to it. */
  const remove = (message: Message): void => {
    queued -= message.bytes.length
    head += 1
    if (head >= queue.length) {
      queue.length = 0
      head = 0
    }
  }

  /** Count what the sink took; a whole message is one committed frame. */
  const deliver = (message: Message, written: number): void => {
    message.offset += written
    if (message.offset < message.bytes.length) return
    if (message.geometry !== undefined) committed += 1
    remove(message)
  }

  /**
   * Whether the message may still be applied.
   *
   * A frame carries absolute rows and columns, so a message composed for another
   * grid is not "slightly off": it can wrap a row into the next one and, on the
   * last row, scroll the screen. Nothing on this side can see that happen, so the
   * frame is refused instead of written.
   */
  const stillFits = (message: Message): boolean => {
    const size = options.size
    if (message.geometry === undefined || size === undefined) return true
    const now = size()
    return now.columns === message.geometry.columns && now.rows === message.geometry.rows
  }

  /** Give up on everything still queued. */
  const dropAll = (reason: LostReason): void => {
    while (head < queue.length) {
      const message = queue[head]
      if (message === undefined) break
      note(reason)
      remove(message)
    }
    queue.length = 0
    head = 0
    queued = 0
    inflight = undefined
    busy = false
  }

  /**
   * Retry the message in flight after a pause.
   *
   * The message keeps the queue: nothing may start behind a frame the terminal
   * has not taken, and the sink may answer synchronously, so the retry — not the
   * pump loop — is what clears the flight.
   */
  const retrying = (): void => {
    if (retry !== undefined) return
    retry = setTimeout(() => {
      retry = undefined
      busy = false
      inflight = undefined
      pump()
    }, POLL_MS)
  }

  const onWritten = (message: Message, error: NodeJS.ErrnoException | null, written: number): void => {
    if (closed) {
      busy = false
      inflight = undefined
      return
    }
    if (error !== null) {
      // A terminal with no room answers EAGAIN instead of blocking this thread;
      // it will take the rest shortly, and the frame must not be cut.
      if (error.code === 'EAGAIN') {
        retrying()
        return
      }
      busy = false
      inflight = undefined
      // The descriptor refused the frame. The queue behind it goes too — nothing
      // owns the surface any more — and the renderer is told, because a screen
      // that is wrong is worth repairing the moment the terminal comes back.
      dropAll('error')
      report()
      settle()
      return
    }
    if (written === 0) {
      // A sink that took nothing and still answered "no error" is a descriptor
      // with no room left and nothing to say about it: retry on the clock, never
      // in a spin against a terminal that is not moving.
      retrying()
      return
    }
    busy = false
    inflight = undefined
    deliver(message, written)
    setImmediate(pump)
  }

  const pump = (): void => {
    if (pumping) return
    pumping = true
    try {
      while (!busy && !closed) {
        const message = queue[head]
        if (message === undefined) break
        if (!stillFits(message)) {
          note('geometry')
          remove(message)
          continue
        }
        busy = true
        inflight = message
        sink.write(message.bytes.subarray(message.offset), (error, written) => { onWritten(message, error, written) })
      }
    } finally {
      pumping = false
    }
    report()
    settle()
  }

  return {
    write: (data: string, geometry?: FrameGeometry): void => {
      if (data === '' || closed) return
      if (geometry !== undefined) composed += 1
      const bytes = Buffer.from(data, 'utf8')
      if (queued + bytes.length > cap) {
        // Whole messages only: a frame cut in half corrupts every row after the
        // cut, while a frame that never arrived can be repainted — and the
        // renderer is told, because a dropped frame it is not told about is a
        // screen it will never repair.
        note('cap')
        report()
        return
      }
      queue.push({ bytes, offset: 0, geometry })
      queued += bytes.length
      pump()
    },
    flushSync: (): void => {
      if (retry !== undefined) {
        clearTimeout(retry)
        retry = undefined
      }
      // The message in flight belongs to the sink: its remainder is not knowable
      // from here, and its callback cannot run once the loop is stopping. It is
      // dropped, which loses at most the frame being written; the queue behind it
      // is still written in order, and nothing is left to run afterwards.
      if (inflight !== undefined) {
        const dropped = queue.indexOf(inflight)
        if (dropped >= 0) {
          queued -= inflight.bytes.length
          queue.splice(dropped, 1)
          if (dropped < head) head -= 1
        }
        inflight = undefined
        busy = false
      }
      const until = Date.now() + deadline
      for (;;) {
        const message = queue[head]
        if (message === undefined) {
          queue.length = 0
          head = 0
          queued = 0
          settle()
          return
        }
        try {
          deliver(message, sink.writeSync(message.bytes.subarray(message.offset)))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EAGAIN' || Date.now() > until) {
            queue.length = 0
            head = 0
            queued = 0
            settle()
            return
          }
          blockFor(POLL_MS)
        }
      }
    },
    pendingBytes: () => queued,
    stats: () => ({ composed, committed, lost: { ...lost } }),
    drain: () => {
      if (!busy && queued === 0) return Promise.resolve()
      waiting = true
      pump()
      return drained.promise
    },
    dispose: () => {
      closed = true
      if (retry !== undefined) clearTimeout(retry)
      retry = undefined
      queue.length = 0
      head = 0
      queued = 0
      settle()
    },
  }
}

/** The marker pi-tui wraps every frame in: synchronized output. */
const FRAME_START = '\x1b[?2026h'

/** `CSI row;1H`: the row a frame is about to paint into. */
const ROW_MOVE = /^\x1b\[(\d+);(\d+)H$/u

/**
 * Strip bare control characters out of a frame.
 *
 * A frame is a grid of absolute rows: pi-tui writes `CSI row;1H CSI 2K` and
 * then that row's text. Every byte between those markers is *cells*, never a
 * terminal instruction. A raw LF in a row therefore moves the cursor down into
 * the next row, and a raw CR rewrites the row from column one; the layout
 * counted both as zero-width, so the next differential frame sees the rows they
 * spilled into as unchanged and never clears them. A multi-line shell command
 * truncated into one preview row is enough to leave permanent ghost text in the
 * composer — with no lost frame, no resize and no mismatch to explain it.
 *
 * Escape sequences are not touched: CSI, OSC, APC, DCS, PM and SOS sequences
 * are copied whole, including BEL- and ST-terminated ones (OSC 8 hyperlinks,
 * the cursor marker, Kitty graphics). Only bare C0/DEL bytes outside a sequence
 * are dropped, which is width-neutral: `visibleWidth` already counted them as
 * zero, so the model and the bytes stay in step.
 *
 * @param data - one complete frame, including its synchronized-output markers.
 * @returns the frame to write, and the controls that were removed from it.
 */
export function sanitizeFrame(data: string): { text: string; controls: FrameControl[] } {
  const counts = new Map<string, { row: number; code: number; count: number }>()
  const note = (row: number, code: number): void => {
    const key = `${String(row)}:${String(code)}`
    const entry = counts.get(key)
    if (entry === undefined) counts.set(key, { row, code, count: 1 })
    else entry.count += 1
  }
  let text = ''
  /** 1-based terminal row, read from the last absolute cursor move. */
  let row = 0
  let i = 0
  while (i < data.length) {
    const code = data.charCodeAt(i)
    if (code === 0x1b) {
      const next = data.charCodeAt(i + 1)
      if (next === 0x5b) { // CSI: parameters/intermediates, then one final byte
        let end = i + 2
        while (end < data.length && data.charCodeAt(end) >= 0x20 && data.charCodeAt(end) <= 0x3f) end += 1
        if (end < data.length && data.charCodeAt(end) >= 0x40 && data.charCodeAt(end) <= 0x7e) end += 1
        const sequence = data.slice(i, end)
        const move = ROW_MOVE.exec(sequence)
        if (move !== null) row = Number(move[1])
        text += sequence
        i = end
        continue
      }
      // OSC `]`, APC `_`, DCS `P`, PM `^`, SOS `X`: BEL or ST terminates.
      if (next === 0x5d || next === 0x5f || next === 0x50 || next === 0x5e || next === 0x58) {
        let end = i + 2
        let terminated = false
        while (end < data.length) {
          const at = data.charCodeAt(end)
          if (at === 0x07) { end += 1; terminated = true; break }
          if (at === 0x1b && data.charCodeAt(end + 1) === 0x5c) { end += 2; terminated = true; break }
          end += 1
        }
        if (terminated) {
          text += data.slice(i, end)
          i = end
        } else {
          // An unterminated OSC would eat the rest of the frame in the real
          // terminal. Dropping the escape leaves its payload as plain cells.
          note(row, code)
          i += 1
        }
        continue
      }
      if (next >= 0x30 && next <= 0x7e) { // a two-byte escape sequence
        text += data.slice(i, i + 2)
        i += 2
        continue
      }
      // A lone escape with nothing behind it can only be data pretending to be
      // a control sequence; drop it rather than let the terminal eat the next
      // printable character.
      note(row, code)
      i += 1
      continue
    }
    if (code < 0x20 || code === 0x7f) {
      note(row, code)
      i += 1
      continue
    }
    text += data[i]
    i += 1
  }
  return { text, controls: [...counts.values()] }
}

/**
 * Wrap a terminal surface so that a write cannot block the event loop.
 *
 * The caller paints through the returned surface; the real stream is read for its
 * size and its resize events, and for the descriptor the queue writes to. Each
 * frame pi-tui paints is one synchronized-output pair, so this is also the one
 * place that can stamp a frame with the grid it was composed for.
 * @param output - the surface the frame would have painted directly.
 * @param options - cap, loss report and flush deadline.
 * @returns the surface to paint through.
 */
export function createBufferedOutput(
  output: OutputSurface & { fd?: number },
  options: BufferedOutputOptions = {},
): BufferedSurface {
  const fd = output.fd
  if (typeof fd !== 'number') throw new Error('a buffered surface needs a file descriptor')
  const writer = createBufferedWriter(fdSink(fd), {
    ...options,
    // Read per message, not once: a window resized while the frame was being
    // composed must not be painted at the old width.
    size: () => ({ columns: output.columns, rows: output.rows }),
  })
  const surface: BufferedSurface = {
    write: (data: string): void => {
      const columns = output.columns
      const rows = output.rows
      // Only a frame is a grid of cells, so only a frame has its bare control
      // characters removed. A title, a progress report or a clipboard write is
      // not tied to the grid, and dropping one because the window moved would
      // lose it for nothing. A frame still gets sanitized when the size is not
      // known yet: its rows are cells whether or not they can be stamped.
      const isFrame = data.startsWith(FRAME_START)
      const cleaned = isFrame ? sanitizeFrame(data) : undefined
      if (cleaned !== undefined && cleaned.controls.length > 0) options.onControl?.(cleaned.controls)
      writer.write(
        cleaned === undefined ? data : cleaned.text,
        isFrame && columns !== undefined && rows !== undefined ? { columns, rows } : undefined,
      )
    },
    flushSync: writer.flushSync,
    drain: writer.drain,
    pendingBytes: writer.pendingBytes,
    stats: writer.stats,
    dispose: writer.dispose,
    ...(output.isTTY === undefined ? {} : { isTTY: output.isTTY }),
    ...(output.on === undefined ? {} : { on: (event: string, listener: () => void) => { output.on?.(event, listener) } }),
    ...(output.removeListener === undefined
      ? {}
      : { removeListener: (event: string, listener: () => void) => { output.removeListener?.(event, listener) } }),
  }
  // The size is read per frame, not once: a window resized while the frame was
  // being composed must not paint at the old width.
  Object.defineProperty(surface, 'columns', { get: () => output.columns, enumerable: true })
  Object.defineProperty(surface, 'rows', { get: () => output.rows, enumerable: true })
  return surface
}
