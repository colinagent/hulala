/**
 * The output queue: what a stalled terminal may cost, and what it may not.
 *
 * The bug this guards against was measured before the queue existed: with the
 * terminal no longer draining its pty, a 30-byte write blocked the event loop for
 * 3.4 seconds, and stdin was not read for the whole of it — which is how a pty
 * ends up dropping the middle of a mouse report. So the properties here are
 * "a sink that does not answer cannot stop the caller", "order and message
 * boundaries survive partial writes", and "the two exits are never reordered":
 * a successor process and the restore sequence must see the queue already gone.
 */
import { expect, test } from 'bun:test'
import { createBufferedWriter, type WriterSink } from '../../src/tui/terminal/writer.ts'

/** A sink that takes what it is given, with a record of what it took. */
function recordingSink(options: { perWrite?: number } = {}): WriterSink & { text(): string; pending(): number } {
  let text = ''
  let pending = 0
  return {
    write: (chunk, done) => {
      pending += 1
      const take = Math.min(options.perWrite ?? chunk.length, chunk.length)
      text += chunk.subarray(0, take).toString('utf8')
      setTimeout(() => { pending -= 1; done(null, take) }, 0)
    },
    writeSync: chunk => { text += chunk.toString('utf8'); return chunk.length },
    text: () => text,
    pending: () => pending,
  }
}

test('a sink that never answers does not stop the caller', async () => {
  let calls = 0
  const sink: WriterSink = {
    write: () => { calls += 1 },
    writeSync: () => 0,
  }
  const writer = createBufferedWriter(sink)
  const started = performance.now()
  for (let i = 0; i < 500; i += 1) writer.write(`frame ${String(i)}\n`)
  const spent = performance.now() - started
  // The first message is handed to the sink; the rest wait in memory. Nothing
  // here may block, which is what keeps stdin being read.
  expect(calls).toBe(1)
  expect(writer.pendingBytes()).toBeGreaterThan(0)
  expect(spent).toBeLessThan(100)
  // A drain waits for the terminal, and a terminal that never answers is exactly
  // what the caller must not depend on: the promise stays pending until the
  // surface is disposed.
  const drained = writer.drain()
  let done = false
  void drained.then(() => { done = true })
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(done).toBe(false)
  writer.dispose()
  await drained
  expect(done).toBe(true)
})

test('a partial write keeps the message and the order', async () => {
  const sink = recordingSink({ perWrite: 3 })
  const writer = createBufferedWriter(sink)
  writer.write('aaa')
  writer.write('bbbb')
  writer.write('cc')
  await writer.drain()
  expect(sink.text()).toBe('aaabbbbcc')
  expect(writer.pendingBytes()).toBe(0)
})

test('a message is never cut, however the sink takes it', async () => {
  const sink = recordingSink({ perWrite: 1 })
  const writer = createBufferedWriter(sink)
  const frames = Array.from({ length: 5 }, (_, i) => `<frame ${String(i)}>`)
  for (const frame of frames) writer.write(frame)
  await writer.drain()
  expect(sink.text()).toBe(frames.join(''))
})

test('a full terminal is retried, not dropped', async () => {
  const written: string[] = []
  let attempts = 0
  const sink: WriterSink = {
    write: (chunk, done) => {
      attempts += 1
      if (attempts === 1) {
        const error = Object.assign(new Error('EAGAIN'), { code: 'EAGAIN' }) as NodeJS.ErrnoException
        done(error, 0)
        return
      }
      written.push(chunk.toString('utf8'))
      done(null, chunk.length)
    },
    writeSync: chunk => { written.push(chunk.toString('utf8')); return chunk.length },
  }
  const writer = createBufferedWriter(sink)
  writer.write('a frame')
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(written).toEqual(['a frame'])
  expect(attempts).toBeGreaterThan(1)
  writer.dispose()
})

test('a queue past its cap drops whole messages and says so once it drains', async () => {
  const sink = recordingSink()
  let overflows = 0
  const writer = createBufferedWriter(sink, { capBytes: 16, onOverflow: () => { overflows += 1 } })
  writer.write('x'.repeat(10))
  writer.write('y'.repeat(10)) // over the cap: dropped whole
  await writer.drain()
  expect(sink.text()).toBe('x'.repeat(10))
  expect(overflows).toBe(1)
})

test('a flush writes what is queued, in order, and abandons the message in flight', async () => {
  // The exit path: the sink has one message in its hands when the process ends.
  // Its remainder is unknowable from here, so it is lost — but everything behind
  // it is written synchronously so the restore sequence can be the last write.
  const flushed: string[] = []
  const sink: WriterSink = {
    write: () => { /* never answers: a terminal that stopped reading */ },
    writeSync: chunk => { flushed.push(chunk.toString('utf8')); return chunk.length },
  }
  const writer = createBufferedWriter(sink)
  writer.write('in flight')
  writer.write('queued')
  writer.flushSync()
  expect(flushed).toEqual(['queued'])
  expect(writer.pendingBytes()).toBe(0)
})

test('a flushed queue survives a terminal that refuses a write', () => {
  const sink: WriterSink = {
    write: () => { /* never answers */ },
    writeSync: () => {
      const error = Object.assign(new Error('EAGAIN'), { code: 'EAGAIN' }) as NodeJS.ErrnoException
      throw error
    },
  }
  const writer = createBufferedWriter(sink, { flushDeadlineMs: 5 })
  writer.write('one')
  writer.write('two')
  const started = performance.now()
  writer.flushSync()
  // The deadline is what keeps a dead terminal from holding the window open.
  expect(performance.now() - started).toBeLessThan(500)
  expect(writer.pendingBytes()).toBe(0)
})
