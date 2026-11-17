/**
 * Where a paste lands: a path on the Host, or text.
 *
 * The two cases that matter are the crossing ones. A local Host already has the
 * files the clipboard names, so nothing is copied; another machine has none of
 * them, so the bytes are sent once and the stored path is what the draft gets.
 * A screenshot is always stored, because pixels have no path of their own.
 */
import { expect, test } from 'bun:test'
import { draftFromClipboard, type LocalFileInfo, type PasteTarget } from '../../src/tui/paste.js'
import type { ClipboardPaste } from '../../src/tui/clipboard.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47])

interface Calls {
  readonly saved: { data: Uint8Array; mediaType?: string; name?: string }[]
  readonly read: string[]
  readonly stats: string[]
}

function target(
  local: boolean,
  options: { readonly fail?: boolean; readonly info?: LocalFileInfo } = {},
): { target: PasteTarget; calls: Calls } {
  const calls: Calls = { saved: [], read: [], stats: [] }
  return {
    calls,
    target: {
      local,
      async save(file) {
        if (options.fail === true) throw new Error('the Host could not store the paste')
        calls.saved.push(file)
        return `/tmp/hulala-pastes/paste-${String(calls.saved.length)}.${file.name === undefined ? 'png' : 'bin'}`
      },
      async read(path) {
        calls.read.push(path)
        return Buffer.from(`bytes of ${path}`)
      },
      async inspect(path) {
        calls.stats.push(path)
        return options.info ?? { size: 1_024, regular: true }
      },
    },
  }
}

const image: ClipboardPaste = { kind: 'image', image: { data: PNG.toString('base64'), mediaType: 'image/png', bytes: PNG.length } }

test('a screenshot becomes a path the Host wrote', async () => {
  const fake = target(false)
  const draft = await draftFromClipboard(image, fake.target)
  expect(draft).toEqual({ kind: 'paths', paths: ['/tmp/hulala-pastes/paste-1.png'] })
  expect(fake.calls.saved).toHaveLength(1)
  expect(Buffer.from(fake.calls.saved[0]!.data)).toEqual(PNG)
  expect(fake.calls.saved[0]!.mediaType).toBe('image/png')
})

test('a local Host keeps the paths the clipboard named', async () => {
  const fake = target(true)
  const pasted: ClipboardPaste = { kind: 'files', paths: ['/Users/me/shot.png', '/Users/me/notes.txt'] }
  const draft = await draftFromClipboard(pasted, fake.target)
  expect(draft).toEqual({ kind: 'paths', paths: ['/Users/me/shot.png', '/Users/me/notes.txt'] })
  expect(fake.calls.saved).toEqual([])
  expect(fake.calls.read).toEqual([])
})

test('another machine gets the bytes, in the order the clipboard named them', async () => {
  const fake = target(false)
  const pasted: ClipboardPaste = { kind: 'files', paths: ['/Users/me/a.png', '/Users/me/b.png'] }
  const draft = await draftFromClipboard(pasted, fake.target)
  expect(draft).toEqual({ kind: 'paths', paths: ['/tmp/hulala-pastes/paste-1.bin', '/tmp/hulala-pastes/paste-2.bin'] })
  expect(fake.calls.read).toEqual(['/Users/me/a.png', '/Users/me/b.png'])
  expect(fake.calls.saved.map(file => file.name)).toEqual(['a.png', 'b.png'])
  expect(Buffer.from(fake.calls.saved[0]!.data).toString()).toBe('bytes of /Users/me/a.png')
})

test('text is pasted as text, and an empty clipboard keeps its reason', async () => {
  const fake = target(false)
  expect(await draftFromClipboard({ kind: 'text', text: 'hello' }, fake.target)).toEqual({ kind: 'text', text: 'hello' })
  expect(await draftFromClipboard({ kind: 'empty', reason: 'no-reader' }, fake.target)).toEqual({ kind: 'refused', reason: 'no-reader' })
  expect(fake.calls.saved).toEqual([])
})

test('a copied file past the paste limit is refused, not uploaded', async () => {
  const saved: unknown[] = []
  const pasted: ClipboardPaste = { kind: 'files', paths: ['/Users/me/huge.bin'] }
  const draft = await draftFromClipboard(pasted, {
    local: false,
    async save(file) { saved.push(file); return '/tmp/hulala-pastes/huge.bin' },
    async read() { return new Uint8Array(10 * 1024 * 1024 + 1) },
  })
  expect(draft).toEqual({ kind: 'refused', reason: 'too-large' })
  expect(saved).toEqual([])
})

test('a Host that refuses the write fails the paste instead of half-inserting it', async () => {
  const fake = target(false, { fail: true })
  await expect(draftFromClipboard(image, fake.target)).rejects.toThrow('could not store the paste')
})

test('a copied folder is refused before anything is read', async () => {
  const fake = target(false, { info: { size: 4_096, regular: false } })
  const pasted: ClipboardPaste = { kind: 'files', paths: ['/Users/me/Desktop'] }
  expect(await draftFromClipboard(pasted, fake.target)).toEqual({ kind: 'refused', reason: 'not-a-file' })
  expect(fake.calls.read).toEqual([])
  expect(fake.calls.saved).toEqual([])
})

test('a copied file past the limit is refused from its size, never read', async () => {
  const fake = target(false, { info: { size: 2 * 1024 * 1024 * 1024, regular: true } })
  const pasted: ClipboardPaste = { kind: 'files', paths: ['/Users/me/video.mov'] }
  expect(await draftFromClipboard(pasted, fake.target)).toEqual({ kind: 'refused', reason: 'too-large' })
  expect(fake.calls.stats).toEqual(['/Users/me/video.mov'])
  expect(fake.calls.read).toEqual([])
})
