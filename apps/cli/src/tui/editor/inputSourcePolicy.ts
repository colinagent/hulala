/**
 * Whether this window may take over the machine's keyboard input source.
 *
 * The helper behind `hulalaIme` selects a system input source, which is a
 * machine-wide side effect: it follows the user across applications, and a
 * third-party input method re-registers its own shortcuts every time it is
 * selected (Doubao IME answers with a "shortcut conflict" notice). That is
 * correct for the window a person is typing into and wrong for every window
 * nobody is looking at.
 *
 * Two rules follow:
 *
 * - A window whose state root is a temporary directory is an automated run: the
 *   end-to-end suites start a real client on a pty with a temp `HULALA_HOME`, and
 *   that client would otherwise switch the developer's keyboard dozens of times
 *   per test run. A test is not the user, so it never owns the input source.
 * - `HULALA_INPUT_SOURCE` overrides the rule explicitly: `0` never switch, `1`
 *   always allow (an operator checking the feature from a temp install). Absent,
 *   the temporary-root rule decides.
 *
 * @module hulala-cli/tui/editor/inputSourcePolicy
 */
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { sep } from 'node:path'

/** A state root resolved through any symlink, so `/var` and `/private/var` agree. */
function resolved(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    // A root that does not exist yet is still compared as written.
    return path
  }
}

/** Whether one spelling of a path is the other, or sits inside it. */
function under(root: string, base: string): boolean {
  const prefix = base.endsWith(sep) ? base : `${base}${sep}`
  return root === base || root.startsWith(prefix)
}

/**
 * Whether a state root lives under the operating system's temporary directory.
 *
 * Both spellings of each side are compared: macOS reports `TMPDIR` as
 * `/var/folders/…` while the same directory resolves to `/private/var/folders/…`,
 * and a state root that does not exist yet keeps the un-resolved spelling. One
 * mismatch would let an automated run switch the keyboard.
 * @param dataRoot - the root this window keeps its state in.
 * @param temporaryRoot - the OS temporary directory; injectable for tests.
 * @returns true for a temporary install, which never owns the input source.
 */
export function isTemporaryRoot(dataRoot: string, temporaryRoot: string = tmpdir()): boolean {
  for (const root of new Set([dataRoot, resolved(dataRoot)])) {
    for (const base of new Set([temporaryRoot, resolved(temporaryRoot)])) {
      if (under(root, base)) return true
    }
  }
  return false
}

/** What the decision reads besides the state root. */
export interface InputSourcePolicyOptions {
  /** The state root this window keeps its state in. */
  readonly dataRoot: string
  /** Process environment; injectable for tests. */
  readonly environment?: Record<string, string | undefined>
  /** The OS temporary directory; injectable for tests. */
  readonly temporaryRoot?: string
}

/**
 * Whether this window may select a system input source.
 * @param options - state root, environment, temporary directory.
 * @returns true when the window may switch, and `acquire`/`release` should run.
 */
export function inputSourceAllowed(options: InputSourcePolicyOptions): boolean {
  const environment = options.environment ?? process.env
  const override = environment.HULALA_INPUT_SOURCE
  // An explicit answer wins, including "yes" from an operator checking the
  // feature on a throwaway install.
  if (override === '0') return false
  if (override === '1') return true
  return !isTemporaryRoot(options.dataRoot, options.temporaryRoot ?? tmpdir())
}
