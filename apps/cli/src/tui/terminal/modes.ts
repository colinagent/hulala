/**
 * The terminal modes this client uses, refuses, and restores — one table.
 *
 * A terminal mode is the client's promise to consume what it asks for. pi-tui
 * owns a generic TUI's needs and enables mouse + focus reporting on start; this
 * client keeps button-motion mouse reports (its own UI) and focus reports (which
 * surface is in front, so a background window can leave the machine's input
 * source alone) and refuses only bare motion (`?1003`). Every unused mode is
 * another sequence that can be cut by a read and typed as text, so the adapter
 * filters the refused enable out of everything written and writes its disable
 * before the renderer asks for the ones it keeps.
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
 * encoding the renderer parses. Focus (`?1004`) is the only way a terminal
 * program can learn that its window lost the keyboard: the two reports are
 * consumed by the input pipeline (`../input/reports.ts`), never typed, and the
 * input-source ownership asks them before it touches the machine.
 */
const USED_MODES = [
  { name: 'button-motion', enable: '\u001b[?1002h', disable: '\u001b[?1002l' },
  { name: 'sgr-mouse', enable: '\u001b[?1006h', disable: '\u001b[?1006l' },
  { name: 'focus', enable: '\u001b[?1004h', disable: '\u001b[?1004l' },
] as const

/**
 * Modes the client refuses.
 *
 * All-motion tracking (`?1003`) makes every pointer movement a report — hundreds
 * a second on a trackpad, each one a chance to be split by a read. pi-tui enables
 * it on a terminal it does not recognise as a multiplexer, so the adapter strips
 * the enable and writes the disable itself — see {@link MOTION_OFF} for why the
 * order of those two writes is part of the contract.
 */
const UNUSED_MODES = [
  { name: 'all-motion', enable: '\u001b[?1003h', disable: '\u001b[?1003l' },
] as const

/**
 * Turn bare-motion reporting off; also clears a previous program's state.
 *
 * Written before the renderer's own mouse enable, never after. A terminal that
 * keeps mouse reporting in one flag (Ghostty) turns the whole group off on any
 * one mode's reset: `?1003l` after `?1002h` leaves no mouse at all, and a
 * trackpad's scroll becomes Up/Down keys. The enable is what has the last word.
 */
export const MOTION_OFF = UNUSED_MODES[0].disable

/**
 * Turn focus reporting on before the renderer starts.
 *
 * The client writes this itself rather than waiting for pi-tui's group: the two
 * reports are what tell a background window to leave the input source alone, and
 * a mode that only some renderers enable would silently take that ability away.
 * Written after {@link MOTION_OFF} and before `ui.start()`, so no mouse reset of
 * a previous program can clear it afterwards.
 */
export const FOCUS_ON = USED_MODES[2].enable

/** The mouse modes the client keeps on, for the frame and for tests. */
export const KEPT_MODE_SEQUENCES: readonly string[] = USED_MODES.map(mode => mode.enable)

/**
 * Every enable sequence the adapter refuses to write.
 *
 * Only the enable direction is stripped: a disable must always get through, or a
 * mode left on by an older client could not be cleared. The pattern mirrors
 * {@link UNUSED_MODES}; `modes.test.ts` asserts the two agree.
 */
const UNUSED_ENABLE = /\u001b\[\?1003h/gu

/**
 * Remove the enable sequences of modes this client does not consume.
 *
 * Applied to every write, because the renderer writes the group itself and a
 * future renderer may write it again. A partial sequence split across two writes
 * cannot be filtered here; the explicit disable in {@link MOTION_OFF} at start
 * covers that case.
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
