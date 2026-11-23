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

test('a queue past its cap drops whole messages and says so at once', async () => {
  const sink = recordingSink()
  const lost: string[] = []
  const writer = createBufferedWriter(sink, { capBytes: 16, onLost: reason => lost.push(reason) })
  writer.write('x'.repeat(10))
  writer.write('y'.repeat(10)) // over the cap: dropped whole
  await writer.drain()
  expect(sink.text()).toBe('x'.repeat(10))
  // Reported while the terminal is still not reading, not once it drains: the
  // renderer has to throw its copy of the screen away either way, and waiting
  // only delays the repair.
  expect(lost).toEqual(['cap'])
  expect(writer.stats().lost.cap).toBe(1)
})

test('a refused descriptor loses the frame and says so', async () => {
  let attempts = 0
  const sink: WriterSink = {
    write: (_chunk, done) => {
      attempts += 1
      const error = Object.assign(new Error('EIO'), { code: 'EIO' }) as NodeJS.ErrnoException
      setTimeout(() => { done(error, 0) }, 0)
    },
    writeSync: () => 0,
  }
  const lost: string[] = []
  const writer = createBufferedWriter(sink, { onLost: reason => lost.push(reason) })
  // Both are in the queue when the descriptor refuses: the one being written and
  // the one behind it. Nothing owns the surface any more, so both are lost.
  writer.write('frame one')
  writer.write('frame two')
  await new Promise(resolve => setTimeout(resolve, 20))
  // One report per distinct reason however many messages went with it: the
  // repair is one full repaint, not one per dropped frame.
  expect(lost).toEqual(['error'])
  expect(writer.stats().lost.error).toBe(2)
  expect(writer.pendingBytes()).toBe(0)
  expect(attempts).toBe(1)
  writer.dispose()
})

test('a sink that takes nothing does not spin the loop', async () => {
  let attempts = 0
  const sink: WriterSink = {
    write: (_chunk, done) => { attempts += 1; done(null, 0) },
    writeSync: () => 0,
  }
  const writer = createBufferedWriter(sink)
  writer.write('a frame')
  await new Promise(resolve => setTimeout(resolve, 30))
  // Two milliseconds apart, not thousands of turns of the loop: a descriptor
  // with no room must cost waiting, never CPU.
  expect(attempts).toBeLessThan(20)
  expect(writer.pendingBytes()).toBeGreaterThan(0)
  writer.dispose()
})

test('a frame composed for another grid is never written', async () => {
  const sink = recordingSink()
  const lost: string[] = []
  let size = { columns: 80, rows: 24 }
  const writer = createBufferedWriter(sink, { onLost: reason => lost.push(reason), size: () => size })
  // The first frame starts writing, so the second one is still queued when the
  // window changes size: its absolute rows and columns no longer address this
  // grid, and applying it could wrap a row (and scroll the screen).
  writer.write('frame one', { columns: 80, rows: 24 })
  writer.write('frame two', { columns: 80, rows: 24 })
  size = { columns: 70, rows: 20 }
  await writer.drain()
  expect(sink.text()).toBe('frame one')
  expect(lost).toEqual(['geometry'])
  expect(writer.stats()).toEqual({ composed: 2, committed: 1, lost: { cap: 0, error: 0, geometry: 1 } })
})

test('a control write is not tied to the grid', async () => {
  const sink = recordingSink()
  const lost: string[] = []
  let size = { columns: 80, rows: 24 }
  const writer = createBufferedWriter(sink, { onLost: reason => lost.push(reason), size: () => size })
  writer.write('frame', { columns: 80, rows: 24 })
  writer.write('\u001b]0;title\u0007') // no geometry: a title, not a frame
  size = { columns: 70, rows: 20 }
  await writer.drain()
  expect(sink.text()).toBe('frame\u001b]0;title\u0007')
  expect(lost).toEqual([])
  expect(writer.stats().committed).toBe(1)
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

test('a flush whose sink answers afterwards does not lose what follows', async () => {
  // A flush is not only the exit path: the terminal's own stop flushes mid-life,
  // and the loop keeps running, so the message it abandoned still gets an answer.
  // That answer is not a delivery of the message now at the head of the queue —
  // counting it as one steps `head` past a message nobody wrote. The exit path
  // depends on this: the banner's delete is queued behind the document that
  // re-places it, and the document must not be the reason it disappears.
  let text = ''
  const answers: Array<() => void> = []
  const sink: WriterSink = {
    write: (chunk, done) => { answers.push(() => { text += chunk.toString('utf8'); done(null, chunk.length) }) },
    writeSync: chunk => { text += chunk.toString('utf8'); return chunk.length },
  }
  const writer = createBufferedWriter(sink)
  writer.write('first') // in flight when the flush runs
  writer.flushSync() // abandons it, with nothing behind it yet
  writer.write('second') // queued after the flush
  const abandoned = answers.shift()
  const queued = answers.shift()
  abandoned?.()
  queued?.()
  writer.write('third')
  for (let turn = 0; turn < 10 && writer.pendingBytes() > 0; turn += 1) {
    while (answers.length > 0) answers.shift()?.()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  expect(text).toBe('firstsecondthird')
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
