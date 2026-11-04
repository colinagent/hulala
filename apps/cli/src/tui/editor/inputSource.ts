/**
 * The macOS keyboard input source, through the packaged `ime` helper.
 *
 * Neovim inside the TUI cannot reach the input method: the switch belongs to
 * the terminal application, not to the pty child. So the client does it when
 * the editor column takes focus and puts the previous source back when focus
 * returns to the composer — including when `Ctrl-F` only hides the pane and
 * Neovim keeps running.
 *
 * Calls are asynchronous on purpose: spawning the helper costs a few tens of
 * milliseconds and no keystroke should wait for that.
 *
 * @module hulala-cli/tui/editor/inputSource
 */
import { spawn } from 'node:child_process'

/** The plain English layout Hulala switches to when the editor takes focus. */
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
