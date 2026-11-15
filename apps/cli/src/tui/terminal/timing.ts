/**
 * The three time windows the terminal adapter owns.
 *
 * A lone escape is a timing question, not a parsing one: the terminal decides
 * whether `ESC` starts a sequence or is the Escape key, and every program that
 * reads a terminal picks a window for that decision (Vim/Neovim's `ttimeoutlen`
 * is 50 ms, tmux's `escape-time` is 10 ms). This client reads stdin on the same
 * event loop that paints, so a frame can be busy between the two halves; its
 * window is deliberately longer than theirs.
 *
 * Three different questions, three named answers. They are not one knob:
 *
 * - `escapeTimeoutMs` — how long a prefix that could still grow waits for its
 *   remainder before it is delivered as keys.
 * - `reportTimeoutMs` — how long a report's head waits for its tail. A report is
 *   one gesture; half of it is never typing.
 * - `orphanWindowMs` — after a bare Escape has already been delivered as a key,
 *   how long a tail that lost its escape can still be recognised and rejoined.
 *
 * The clock is passed to the parser by the adapter, so the input layer never
 * reads wall time on its own.
 *
 * @module hulala-cli/tui/terminal/timing
 */

/** How long an incomplete sequence waits for its remainder. */
export const DEFAULT_ESCAPE_TIMEOUT_MS = 100

/** How long a report's head waits for its tail. */
export const DEFAULT_REPORT_TIMEOUT_MS = 1_000

/** How long after a delivered Escape its stripped tail can still be rejoined. */
export const DEFAULT_ORPHAN_WINDOW_MS = 1_000
