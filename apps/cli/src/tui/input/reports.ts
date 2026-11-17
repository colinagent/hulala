/**
 * Replies a terminal sends on its own, which are never keys a person pressed.
 *
 * pi-tui asks for the terminal's palette once at startup (OSC 10, OSC 11, the
 * sixteen OSC 4 entries, and a DA1 request to mark the end). It consumes those
 * replies only while that one query is pending, and only if they arrive before
 * the renderer gives up on them. A terminal can hold a reply in the tty's
 * canonical buffer — no newline, so the line discipline never hands it on — and
 * release the whole burst at the next raw-mode switch, long after the query is
 * over. Those replies then reach the input pipeline unmatched: from there they
 * are typed into the composer as `62`, `22t`, `52c`, and into the shell as
 * `command not found` once the client has stopped reading stdin.
 *
 * The input pipeline is the right place to stop them. pi-tui's own reply
 * consumers run *before* the client's input listeners, so anything that reaches
 * this check was already left unclaimed by a pending color query; consuming it
 * here costs the theme nothing. The one exception is `CSI 6;height;width t`,
 * which pi-tui consumes *after* the listeners to size image cells — that one
 * stays on the wire.
 *
 * @module hulala-cli/tui/input/reports
 */

/**
 * An OSC color reply, as answered to a `?` query.
 *
 * Both BEL and ST terminate an OSC string. The body is deliberately narrow:
 * `rgb:` answers from the palette query and the `?` echo some terminals send.
 * An OSC title the client writes itself never arrives on stdin.
 */
const OSC_COLOR_REPLY = /^\u001b\](?:10|11|4;\d+);(?:rgb:[0-9a-fA-F/]+|\?)(?:\u0007|\u001b\\)$/u

/**
 * Device attributes, the DA1 reply that ends a palette query (`?`) and the
 * secondary form some terminals volunteer (`>`).
 */
const DEVICE_ATTRIBUTES = /^\u001b\[[?>][\d;]*c$/u

/**
 * Cursor-position and device-status reports.
 *
 * A CSI whose final byte is `c`, `R` or `n` is a report, not a key: modified
 * keys use `A`–`H`, `P`–`S`, `~` or the Kitty `u` form, never these finals.
 */
const CSI_REPORT = /^\u001b\[\??[\d;]*[cnR]$/u

/**
 * Window-ops reports other than the cell-size one pi-tui consumes.
 *
 * `CSI 6;height;width t` is handled by the renderer after the input listeners;
 * swallowing it here would lose the cell dimensions images need. Other `t`
 * reports (window position, size in characters) have no consumer at all.
 */
const WINDOW_REPORT = /^\u001b\[(?!6;)\d+(?:;\d+)*t$/u

/**
 * A mouse report that lost its introducer.
 *
 * The terminal writes a report in one `write`, and a pty input queue with no
 * room takes only part of it: the rest is gone, so the next read can start at
 * the button digits (`60;39M`) or at a coordinate group. No key press produces
 * two coordinate groups and the report's terminator, so this is never typing —
 * but it does not look like a sequence to the renderer either, which is how it
 * reaches the composer and the shell in the first place.
 *
 * A *whole* SGR report (`ESC[<…M`) is deliberately not listed: pi-tui dispatches
 * mouse events after these listeners, so consuming one here would take the
 * pointer away from the frame.
 */
const DAMAGED_MOUSE = /^\d{1,4}(?:;\d{1,4}){1,2}[Mm]$/u

/**
 * Whether one delivered piece is a terminal report that nobody claimed.
 * @param data - one complete piece from {@link InputParser}.
 * @returns true when the frame must swallow it instead of typing it.
 */
export function isStrayTerminalReport(data: string): boolean {
  return OSC_COLOR_REPLY.test(data)
    || DEVICE_ATTRIBUTES.test(data)
    || CSI_REPORT.test(data)
    || WINDOW_REPORT.test(data)
    || DAMAGED_MOUSE.test(data)
}
