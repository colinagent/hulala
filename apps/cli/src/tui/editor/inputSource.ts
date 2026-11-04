/**
 * The macOS keyboard input source, through the packaged `ime` helper.
 *
 * A program in a pty cannot reach the input method: the source belongs to the
 * terminal application, not to the child. So the client owns it, and the rule is
 * one line: a panel that takes the keyboard selects English, and the client never
 * selects anything else. That means the Session rail (with its filter box),
 * Neovim and the shell column type in English because they read keys as program
 * input, while the composer is left exactly as the user left it. Panels keep
 * running while another surface holds the keyboard, so the switch cannot be tied
 * to a process lifecycle.
 *
 * Calls are asynchronous on purpose: spawning the helper costs a few tens of
 * milliseconds and no keystroke should wait for that.
 *
 * @module hulala-cli/tui/editor/inputSource
 */
import { spawn } from 'node:child_process'

/** The plain English layout Hulala switches to while a panel owns the keyboard. */
export const ENGLISH_INPUT_SOURCE = 'com.apple.keylayout.ABC'

/** Narrow surface over the helper, so callers never spawn it directly. */
export interface InputSource {
  /** Id of the source that owns keyboard input right now, if macOS answers. */
  current(): Promise<string | undefined>
  /** Select one source; macOS ignores ids that are not enabled. */
  select(id: string): void
}

/**
 * Wrap the `ime` helper.
 * @param executable - `<data>/bin/ime`, or undefined when it was not published.
 * @returns the helper, or undefined when there is nothing to call.
 */
export function inputSource(executable: string | undefined): InputSource | undefined {
  if (executable === undefined || executable === '') return undefined
  return {
    current: () => new Promise<string | undefined>(resolve => {
      const child = spawn(executable, [], { stdio: ['ignore', 'pipe', 'ignore'] })
      let output = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', chunk => { output += chunk })
      child.once('error', () => resolve(undefined))
      child.once('close', code => resolve(code === 0 && output.trim() !== '' ? output.trim() : undefined))
    }),
    select: (id: string) => {
      const child = spawn(executable, [id], { stdio: 'ignore' })
      child.once('error', () => {})
      child.unref()
    },
  }
}

/**
 * Keeps the client's panels in English.
 *
 * Only a panel asks for this. The composer is never switched — not to English,
 * not back to what it had — so whatever the user selects there by hand stays
 * until a panel takes the keyboard. Remembering and restoring the composer's
 * source made the client fight the user: switching to English and returning to
 * the composer reverted it to Chinese.
 */
export interface InputSourceSwitch {
  /** Select English unless it already is the source. */
  ensure(): void
}

/**
 * Build a switch over the helper.
 *
 * The helper is resolved on every call, never captured: a source checkout builds
 * `bin/ime` at start, and a window that began without one must pick it up on the
 * next call rather than stay deaf for the rest of its life.
 *
 * A helper that answers nothing still gets English selected: the default is the
 * rule, not a translation of what the read said.
 * @param resolve - the helper to call, or undefined when there is none at all.
 * @returns the switch, safe to call from any focus callback.
 */
export function inputSourceSwitch(resolve: () => InputSource | undefined): InputSourceSwitch {
  return {
    ensure: () => {
      const source = resolve()
      if (source === undefined) return
      void source.current().then(id => {
        if (id !== ENGLISH_INPUT_SOURCE) source.select(ENGLISH_INPUT_SOURCE)
      })
    },
  }
}
