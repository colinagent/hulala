/**
 * The terminal modes this client uses, refuses, and restores — one table.
 *
 * A terminal mode is the client's promise to consume what it asks for. pi-tui
 * owns a generic TUI's needs and enables mouse + focus reporting on start; this
 * client uses button-motion mouse reports (its own UI) but consumes neither bare
 * motion (`?1003`) nor focus reports (`?1004`). Every unused mode is another
 * sequence that can be cut by a read and typed as text, so the adapter filters
 * the enable sequences out of everything written and clears them once at start.
 *
 * Enable, disable and restore live here so a mode cannot be switched on in one
 * place and forgotten in another. `RESTORE_TERMINAL` is the single sequence the
 * guard writes; it also covers modes the renderer never names (synchronized
 * output, the cursor shape a column's program chose).
 *
 * @module hulala-cli/tui/terminal/modes
 */

/** Push the Kitty keyboard protocol's disambiguate mode, keeping older flags. */
export const PUSH_DISAMBIGUATE = '\u001b[>1u'

/** Pop it again, restoring whatever the terminal had before the client started. */
export const POP_KEYBOARD_PROTOCOL = '\u001b[<u'

/**
 * Modes the client consumes.
 *
 * Button motion (`?1002`) keeps clicks, drags, selections and the wheel while a
 * trackpad no longer reports every bare movement. SGR (`?1006`) is the report
 * encoding the renderer parses.
 */
const USED_MODES = [
  { name: 'button-motion', enable: '\u001b[?1002h', disable: '\u001b[?1002l' },
  { name: 'sgr-mouse', enable: '\u001b[?1006h', disable: '\u001b[?1006l' },
] as const

/**
 * Modes the client refuses.
 *
 * All-motion tracking (`?1003`) makes every pointer movement a report — hundreds
 * a second on a trackpad, each one a chance to be split by a read. Focus
 * reporting (`?1004`) fires on every window focus change (a screenshot, a click
 * elsewhere) and nothing in the frame needs it. pi-tui enables both on a terminal
 * it does not recognise as a multiplexer, so the adapter strips the enables and
 * writes the disables itself.
 */
const UNUSED_MODES = [
  { name: 'all-motion', enable: '\u001b[?1003h', disable: '\u001b[?1003l' },
  { name: 'focus', enable: '\u001b[?1004h', disable: '\u001b[?1004l' },
] as const

/** Turn bare-motion reporting off; also clears a previous program's state. */
export const MOTION_OFF = UNUSED_MODES[0].disable

/** Turn focus reporting off; also clears a previous program's state. */
export const FOCUS_OFF = UNUSED_MODES[1].disable

/** The mouse modes the client keeps on, for the frame and for tests. */
export const KEPT_MODE_SEQUENCES: readonly string[] = USED_MODES.map(mode => mode.enable)

/**
 * Every enable sequence the adapter refuses to write.
 *
 * Only the enable direction is stripped: a disable must always get through, or a
 * mode left on by an older client could not be cleared. The pattern mirrors
 * {@link UNUSED_MODES}; `modes.test.ts` asserts the two agree.
 */
const UNUSED_ENABLE = /\u001b\[\?(?:1003|1004)h/gu

/**
 * Remove the enable sequences of modes this client does not consume.
 *
 * Applied to every write, because the renderer writes the group itself and a
 * future renderer may write it again. A partial sequence split across two writes
 * cannot be filtered here; the explicit disables in {@link MOTION_OFF} and
 * {@link FOCUS_OFF} at start cover that case.
 * @param text - bytes bound for the outer terminal.
 * @returns the same bytes without the refused enables.
 */
export function filterUnusedModes(text: string): string {
  return text.replace(UNUSED_ENABLE, '')
}

/** The mode numbers a terminal must be put back to on the way out. */
const RESTORE_MODES = [1049, 1006, 1004, 1003, 1002, 1000, 2004, 2026, 25, 7] as const

/**
 * Give the terminal back, whatever happened.
 *
 * A client that dies without this leaves the terminal in the alternate screen
 * with mouse reporting on: the shell then receives the reports, echoes them as
 * text, and no amount of typing can be read. `?2026l` ends a synchronized frame
 * the renderer may have been in the middle of, and `ESC[0 q` gives the cursor
 * shape back after a column's program chose a bar. Writing it synchronously on
 * the way out is the only version that survives `process.exit` and an uncaught
 * error.
 */
export const RESTORE_TERMINAL = [
  ...RESTORE_MODES.map(mode => `\u001b[?${String(mode)}${mode === 25 || mode === 7 ? 'h' : 'l'}`),
  '\u001b[0 q',
  POP_KEYBOARD_PROTOCOL,
].join('')
