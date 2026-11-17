/**
 * The four time windows the terminal adapter owns.
 *
 * A lone escape is a timing question, not a parsing one: the terminal decides
 * whether `ESC` starts a sequence or is the Escape key, and every program that
 * reads a terminal picks a window for that decision (Vim/Neovim's `ttimeoutlen`
 * is 50 ms, tmux's `escape-time` is 10 ms). This client reads stdin on the same
 * event loop that paints, so a frame can be busy between the two halves; its
 * window is deliberately longer than theirs.
 *
 * Four named answers, because they are four questions. They are not one knob:
 *
 * - `escapeTimeoutMs` — how long a prefix that could still grow waits for its
 *   remainder before it is delivered as keys.
 * - `reportTimeoutMs` — how long a report's head waits for its tail. A report is
 *   one gesture; half of it is never typing.
 * - `orphanWindowMs` — after a bare Escape has already been delivered as a key,
 *   how long a tail that lost its escape can still be recognised and rejoined.
 * - `reportRunMs` — how long after a report arrived whole the stream is still
 *   report traffic, which is what tells a damaged tail from ordinary typing.
 *
 * The clock is passed to the parser by the adapter, so the input layer never
 * reads wall time on its own.
 *
 * Two more numbers are not windows but thresholds: `SLOW_WRITE_MS` and
 * `LAG_INTERVAL_MS` exist only for the trace. They say nothing about parsing;
 * they date a stall, which is the one thing a rendered frame cannot show.
 *
 * @module hulala-cli/tui/terminal/timing
 */

/** How long an incomplete sequence waits for its remainder. */
export const DEFAULT_ESCAPE_TIMEOUT_MS = 100

/** How long a report's head waits for its tail. */
export const DEFAULT_REPORT_TIMEOUT_MS = 1_000

/** How long after a delivered Escape its stripped tail can still be rejoined. */
export const DEFAULT_ORPHAN_WINDOW_MS = 1_000

/**
 * How long after a delivered report the stream is still report traffic.
 *
 * A report that lost its introducer carries no timestamp of its own, so the only
 * anchor is the last report that arrived whole. It is the same order as the
 * orphan window because it answers the same kind of question — which side of a
 * cut these bytes belong to — and a burst of reports a second apart is still one
 * gesture to the person producing it.
 */
export const DEFAULT_REPORT_RUN_MS = 1_000

/**
 * How long a write may take before it is treated as a stall.
 *
 * A tty write is synchronous, so this is also how long the loop stopped reading
 * input. Neovim's `ttimeoutlen` and a frame at 60 Hz are both far below it; the
 * figure only has to be small enough to catch a terminal that stopped draining
 * its output, which is measured in hundreds of milliseconds.
 */
export const SLOW_WRITE_MS = 50

/** How often the trace-only loop-delay probe checks the clock. */
export const LAG_INTERVAL_MS = 500

/**
 * How long input may stop before the gap is worth recording.
 *
 * Every frame is followed by a read, so a gap this long is not the frame being
 * busy — it is the loop, the machine or the transport. Tracing it is how a wake
 * gets a timestamp instead of an anecdote.
 */
export const READ_GAP_MS = 1_000
