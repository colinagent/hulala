import { expect, test } from 'bun:test'
import { setCapabilities, stripTerminalSequences } from '@earendil-works/pi-tui'
import { brandBannerImageId, brandBannerLines } from '../src/tui/view/brandBanner.js'
import { LOGO_PNG_BASE64 } from '../src/brand/logoPng.js'
import { VERSION } from '../src/constants.js'

const png = Buffer.from(LOGO_PNG_BASE64, 'base64')
const strip = (line: string): string => line.replace(/\u001b\[[0-9;]*m/g, '')

test('the bundled logo is a real png', () => {
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  expect(png.readUInt32BE(16)).toBe(512)
  expect(png.readUInt32BE(20)).toBe(512)
})

test('the mark owns the first rows and the text starts beside it', () => {
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
  const lines = brandBannerLines(120)
  // The image row carries no visible text: the mark is placed there by the layout,
  // not by padding spaces onto the escape. Hand padding is what shifted every row
  // below it and pushed the composer off screen.
  expect(lines[0]).toContain('\u001b_G')
  expect(stripTerminalSequences(lines[0] ?? '').trim()).toBe('')
  expect(brandBannerImageId()).toBeGreaterThan(0)
})

test('the version and the key hints sit beside the mark', () => {
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
  const lines = brandBannerLines(120).map(strip)
  expect(lines.some((line) => line.includes(`hulala v${VERSION}`))).toBe(true)
  expect(lines.some((line) => line.includes('Esc') && line.includes('interrupt'))).toBe(true)
  expect(lines.some((line) => line.includes('Ctrl-T') && line.includes('terminal'))).toBe(true)
  expect(lines.some((line) => line.includes('Ctrl-D') && line.includes('editor'))).toBe(true)
  // Three hint rows beside the mark's cell box, plus the version row.
  expect(lines.length).toBe(6)
})

test('a narrow terminal gets the short hint line instead of a wrapped paragraph', () => {
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
  const wide = brandBannerLines(120).length
  const narrow = brandBannerLines(80).map(strip)
  expect(narrow.length).toBeLessThan(wide)
  expect(narrow.some((line) => line.includes('ctrl+g'))).toBe(false)
})

test('nothing is drawn without an image protocol', () => {
  setCapabilities({ images: null, trueColor: true, hyperlinks: false })
  expect(brandBannerLines(120)).toEqual([])
})

test('every width reuses one image id, so one delete removes the only copy', () => {
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: false })
  brandBannerLines(100)
  const first = brandBannerImageId()
  // The client renders at more than one width on startup (the terminal reports a
  // provisional size, then the real one). A fresh id per render would leave the
  // earlier mark on screen with no one tracking it - which is exactly the ghost
  // that survived shutdown.
  brandBannerLines(120)
  expect(brandBannerImageId()).toBe(first)
  expect(first).toBeGreaterThan(0)
})
