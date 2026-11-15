import { expect, test } from 'bun:test'
import {
  FOCUS_OFF,
  filterUnusedModes,
  KEPT_MODE_SEQUENCES,
  MOTION_OFF,
  RESTORE_TERMINAL,
} from '../../src/tui/terminal/modes.js'

/** The exact group pi-tui writes when it starts on a non-multiplexer terminal. */
const RENDERER_START = '\u001b[?1000h\u001b[?1002h\u001b[?1003h\u001b[?1004h\u001b[?1006h'

test('the renderer cannot switch on a mode the client does not consume', () => {
  const filtered = filterUnusedModes(RENDERER_START)
  // The modes the frame actually reads survive.
  expect(filtered).toContain('\u001b[?1000h')
  expect(filtered).toContain('\u001b[?1002h')
  expect(filtered).toContain('\u001b[?1006h')
  // All-motion and focus reporting are refused, not enabled-then-disabled.
  expect(filtered).not.toContain('\u001b[?1003h')
  expect(filtered).not.toContain('\u001b[?1004h')
})

test('the filter never eats a disable or ordinary output', () => {
  // A disable has to get through, otherwise a stale mode could never be cleared.
  expect(filterUnusedModes('\u001b[?1003l\u001b[?1004l')).toBe('\u001b[?1003l\u001b[?1004l')
  expect(filterUnusedModes('hello \u001b[?1003h world')).toBe('hello  world')
  expect(filterUnusedModes('\u001b[?1002h\u001b[?1006h')).toBe('\u001b[?1002h\u001b[?1006h')
})

test('the used modes are exactly the sequences the filter leaves', () => {
  expect(filterUnusedModes(KEPT_MODE_SEQUENCES.join(''))).toBe(KEPT_MODE_SEQUENCES.join(''))
  expect(KEPT_MODE_SEQUENCES.join('')).not.toContain('1003')
  expect(KEPT_MODE_SEQUENCES.join('')).not.toContain('1004')
})

test('the neutralizers are the disables of the refused modes', () => {
  expect(MOTION_OFF).toBe('\u001b[?1003l')
  expect(FOCUS_OFF).toBe('\u001b[?1004l')
})

test('one restore sequence covers every mode the renderer can ask for', () => {
  for (const mode of [1049, 1006, 1004, 1003, 1002, 1000, 2004, 2026]) {
    expect(RESTORE_TERMINAL).toContain(`\u001b[?${String(mode)}l`)
  }
  // Autowrap and the cursor come back on; a column's DECSCUSR shape and the
  // Kitty keyboard protocol are handed back too.
  expect(RESTORE_TERMINAL).toContain('\u001b[?7h')
  expect(RESTORE_TERMINAL).toContain('\u001b[?25h')
  expect(RESTORE_TERMINAL).toContain('\u001b[0 q')
  expect(RESTORE_TERMINAL).toContain('\u001b[<u')
})
