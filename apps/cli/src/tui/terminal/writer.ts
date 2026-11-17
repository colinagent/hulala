/**
 * Output that cannot stop the loop which reads input.
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
 * queue that grows past its cap loses whole messages rather than bytes: the frame
 * it loses can be repainted once the queue drains, while the order it lost could
 * not be recovered.
 *
 * Two exits matter more than the queue. A successor process inherits the
 * terminal, so the queue has to be drained *before* it starts — `drain` is that
 * promise. The exit sequence has to be the last thing the terminal sees, which is
 * why `flushSync` writes what is queued right then and gives up on a terminal
 * that will not take it: nothing may run after the restore.
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

/** The surface a buffered writer paints through. */
export interface BufferedSurface extends OutputSurface {
  /** Write whatever is queued, synchronously, then forget it. */
  flushSync(): void
  /** Resolve once every queued message has reached the terminal. */
  drain(): Promise<void>
  /** Bytes waiting for the terminal; zero means the frame is on the wire. */
  pendingBytes(): number
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
  /** Called once per cap, after the queue has drained again. */
  readonly onOverflow?: () => void
  /** How long `flushSync` keeps trying a terminal that will not take the bytes. */
  readonly flushDeadlineMs?: number
}

/** The writer the adapter paints through. */
export interface BufferedWriter {
  /** Queue one message and return at once. */
  write(data: string): void
  /** Write whatever is queued, synchronously. */
  flushSync(): void
  /** Resolve once everything queued has been written. */
  drain(): Promise<void>
  /** Bytes waiting for the terminal. */
  pendingBytes(): number
  /** Stop writing; anything still queued is dropped. */
  dispose(): void
}

/** The cap a buffered writer starts with. */
const DEFAULT_CAP_BYTES = 4 * 1024 * 1024

/** How long the final flush may spin before it gives up on the terminal. */
const DEFAULT_FLUSH_DEADLINE_MS = 200

/** How long a blocking flush or a retry sleeps, in milliseconds. */
const POLL_MS = 2

/** One queued message: the text, and how much of it has been written. */
interface Message {
  readonly bytes: Buffer
  offset: number
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
 * @param options - cap, overflow notice and flush deadline.
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
  let closed = false
  let overflowed = false
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

  const reportOverflow = (): void => {
    if (!overflowed || queued > 0) return
    overflowed = false
    options.onOverflow?.()
  }

  const advance = (message: Message, written: number): void => {
    message.offset += written
    if (message.offset < message.bytes.length) return
    head += 1
    queued -= message.bytes.length
    if (head >= queue.length) {
      queue.length = 0
      head = 0
    }
  }

  const pump = (): void => {
    if (busy || closed) return
    const message = queue[head]
    if (message === undefined) {
      reportOverflow()
      settle()
      return
    }
    busy = true
    inflight = message
    sink.write(message.bytes.subarray(message.offset), (error, written) => {
      busy = false
      inflight = undefined
      if (closed) return
      if (error !== null) {
        // A terminal with no room answers EAGAIN instead of blocking this
        // thread; it will take the rest shortly, and the frame must not be cut.
        if (error.code === 'EAGAIN') {
          retry = setTimeout(() => { retry = undefined; pump() }, POLL_MS)
          return
        }
        // Nothing owns the surface any more. Dropping the queue keeps the
        // process alive long enough to restore the terminal.
        queue.length = 0
        head = 0
        queued = 0
        settle()
        return
      }
      advance(message, written)
      reportOverflow()
      settle()
      setImmediate(pump)
    })
  }

  return {
    write: (data: string): void => {
      if (data === '' || closed) return
      const bytes = Buffer.from(data, 'utf8')
      if (queued + bytes.length > cap) {
        // Whole messages only: a frame cut in half corrupts every row after the
        // cut, while a frame that never arrived can be repainted.
        overflowed = true
        reportOverflow()
        return
      }
      queue.push({ bytes, offset: 0 })
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
        const lost = queue.indexOf(inflight)
        if (lost >= 0) {
          queued -= inflight.bytes.length - inflight.offset
          queue.splice(lost, 1)
          if (lost < head) head -= 1
        }
        inflight = undefined
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
          advance(message, sink.writeSync(message.bytes.subarray(message.offset)))
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

/**
 * Wrap a terminal surface so that a write cannot block the event loop.
 *
 * The caller paints through the returned surface; the real stream is read for its
 * size and its resize events, and for the descriptor the queue writes to.
 * @param output - the surface the frame would have painted directly.
 * @param options - cap, overflow notice and flush deadline.
 * @returns the buffered surface.
 */
export function createBufferedOutput(
  output: OutputSurface & { fd?: number },
  options: BufferedOptions = {},
): BufferedSurface {
  const fd = output.fd
  if (typeof fd !== 'number') throw new Error('a buffered surface needs a file descriptor')
  const writer = createBufferedWriter(fdSink(fd), options)
  const surface: BufferedSurface = {
    ...writer,
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
