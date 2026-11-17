/**
 * The paste route's own rules.
 *
 * The client sends bytes for a file the model must be able to open, so what
 * matters here is that the Host accepts only a canonical, bounded payload and
 * that the name it is stored under can never describe a path of its own.
 */
import { expect, test } from 'bun:test'
import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_PASTE_BYTES, parsePaste, pastePath, writePaste } from '../src/plugins/apiPaste.ts'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02])
const body = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ data: PNG.toString('base64'), ...extra })

test('a canonical base64 image is decoded with its declared type', () => {
  const parsed = parsePaste(body({ mediaType: 'image/png' }))!
  expect(Buffer.from(parsed.bytes)).toEqual(PNG)
  expect(parsed.extension).toBe('png')
  expect(parsed.name).toBeUndefined()
})

test('a copied file keeps its own name and extension', () => {
  const parsed = parsePaste(body({ name: 'Screenshot 2026-11-17 at 12.00.png' }))!
  expect(parsed.name).toBe('Screenshot_2026-11-17_at_12.00.png')
  expect(parsed.extension).toBe('png')
})

test('a name can never describe another directory', () => {
  for (const name of ['../../etc/passwd', '/etc/shadow', '.hidden', '..', '']) {
    const parsed = parsePaste(body({ name }))
    expect(parsed?.name === undefined || !parsed.name.includes('/')).toBe(true)
    expect(parsed?.name === undefined || !parsed.name.startsWith('.')).toBe(true)
  }
  expect(parsePaste(body({ name: '../../etc/passwd' }))?.name).toBe('passwd')
})

test('a payload the route would have to guess at is refused', () => {
  expect(parsePaste(body({ data: 'not base64!!' }))).toBeUndefined()
  expect(parsePaste(body({ data: '' }))).toBeUndefined()
  expect(parsePaste(body({ data: 'AAA' }))).toBeUndefined() // not a whole number of quadlets
  expect(parsePaste(body({ data: 'A===' }))).toBeUndefined()
  expect(parsePaste(body({ data: 12 }))).toBeUndefined()
  expect(parsePaste(undefined)).toBeUndefined()
  expect(parsePaste({ data: Buffer.alloc(MAX_PASTE_BYTES + 1).toString('base64') })).toBeUndefined()
})

test('the stored path is stamped, named and unique', () => {
  const parsed = parsePaste(body({ name: 'shot.png' }))!
  const path = pastePath('/state/transfers', parsed, { now: new Date('2026-11-17T12:34:56.789Z'), random: 'abcd1234' })
  expect(path).toBe('/state/transfers/paste-20261117-123456-abcd1234-shot.png')
  const anonymous = parsePaste(body({ mediaType: 'image/png' }))!
  expect(pastePath('/state/transfers', anonymous, { now: new Date('2026-11-17T12:34:56.789Z'), random: 'abcd1234' }))
    .toBe('/state/transfers/paste-20261117-123456-abcd1234.png')
})

test('the file lands owner-only, byte for byte, with no staging left behind', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-paste-'))
  try {
    const transfers = join(root, 'transfers')
    const parsed = parsePaste(body({ name: 'shot.png' }))!
    const path = await writePaste(transfers, parsed, { now: new Date('2026-11-17T12:34:56.789Z'), random: 'abcd1234' })
    expect(await readFile(path)).toEqual(PNG)
    const mode = (await stat(path)).mode & 0o777
    expect(mode).toBe(0o600)
    expect((await stat(transfers)).mode & 0o777).toBe(0o700)
  } finally {
    await chmod(root, 0o700).catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})
