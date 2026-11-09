/**
 * The macOS keyboard input source, and who owns it.
 *
 * A program in a pty cannot reach the input method: the source belongs to the
 * terminal application, not to the child. So the client owns it, and the rule is
 * the semantics of the surface that holds the keyboard:
 *
 * - a surface that reads keys as commands — Neovim in normal mode, the rail, a
 *   selector, a confirmation — types in English, or a Chinese input method eats
 *   `j`, `Enter` and `Esc` into a composition string;
 * - a surface that reads keys as text — the composer, a question's free-text
 *   answer, Neovim in insert mode — is left on the user's own source.
 *
 * Restoration is the part that has to be careful. The client gives back only the
 * change it made itself, and only while that change is still the source in
 * force. It never restores "Chinese": it restores the source it found. A user
 * whose own source is already English therefore costs nothing — the helper
 * reports "already" and no switch is attempted — and a user who switches by hand
 * inside a command surface is not fought.
 *
 * Calls are asynchronous on purpose: spawning the helper costs a few tens of
 * milliseconds and no keystroke should wait for that. They are also serialized,
 * because `acquire` followed immediately by `release` must give the source back
 * *after* the switch has landed, not before it.
 *
 * @module hulala-cli/tui/editor/inputSource
 */
import { spawn, spawnSync } from 'node:child_process'

/** What one helper call did; both ends of a switch, and how it went. */
export interface SwitchOutcome {
  /** Source in force before the call, when the helper could read one. */
  readonly previous: string | undefined
  /** Source in force after the call, when the helper could read one. */
  readonly selected: string | undefined
  /** The helper changed the source. */
  readonly changed: boolean
  /** macOS has no such source — for `english()`, no English layout at all. */
  readonly unavailable: boolean
  /** The helper could not perform the switch. */
  readonly failed: boolean
}

/** Narrow surface over the helper, so callers never spawn it directly. */
export interface InputSource {
  /** Id of the source that owns keyboard input right now, if macOS answers. */
  current(): Promise<string | undefined>
  /** Select the first available English layout. */
  english(): Promise<SwitchOutcome>
  /** Select one source by id. */
  select(id: string): Promise<SwitchOutcome>
  /** Id of the source in force, read synchronously; for the exit path only. */
  currentNow(): string | undefined
  /** Select a source synchronously; for the exit path only. */
  selectNow(id: string): void
}

/** Exit code the helper uses for "already on that source; nothing changed". */
const EXIT_ALREADY = 10
/** Exit code the helper uses for "no such source" / "no English layout". */
const EXIT_UNKNOWN_SOURCE = 3
/** Exit code the helper uses when macOS refused the switch. */
const EXIT_SELECT_FAILED = 4

/** One helper invocation: its exit code and the lines it printed. */
interface Call {
  readonly code: number
  readonly lines: readonly string[]
}

/** Spawn the helper and collect what it printed. */
function call(executable: string, args: readonly string[]): Promise<Call> {
  return new Promise<Call>(resolve => {
    const child = spawn(executable, [...args], { stdio: ['ignore', 'pipe', 'ignore'] })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { output += chunk })
    child.once('error', () => resolve({ code: -1, lines: [] }))
    child.once('close', code => resolve({
      code: code ?? -1,
      lines: output.split('\n').map(line => line.trim()),
    }))
  })
}

/** Turn one helper call into an outcome; `failed` covers spawn errors too. */
function outcome(result: Call): SwitchOutcome {
  const previous = result.lines[0] === undefined || result.lines[0] === '' ? undefined : result.lines[0]
  const selected = result.lines[1] === undefined || result.lines[1] === '' ? undefined : result.lines[1]
  return {
    previous,
    selected,
    changed: result.code === 0,
    unavailable: result.code === EXIT_UNKNOWN_SOURCE,
    failed: result.code !== 0 && result.code !== EXIT_ALREADY && result.code !== EXIT_UNKNOWN_SOURCE,
  }
}

/**
 * Wrap the `ime` helper.
 * @param executable - `<data>/bin/ime`, or undefined when it was not published.
 * @returns the helper, or undefined when there is nothing to call.
 */
export function inputSource(executable: string | undefined): InputSource | undefined {
  if (executable === undefined || executable === '') return undefined
  return {
    current: async () => {
      const result = await call(executable, [])
      const id = result.lines[0]
      return result.code === 0 && id !== undefined && id !== '' ? id : undefined
    },
    english: async () => outcome(await call(executable, ['--english'])),
    select: async (id: string) => outcome(await call(executable, [id])),
    currentNow: () => {
      // The window is closing: nothing here can await, so the helper runs to
      // completion inline. It costs one process spawn on the way out.
      const result = spawnSync(executable, [], { encoding: 'utf8' })
      const id = result.status === 0 ? result.stdout.trim() : ''
      return id === '' ? undefined : id
    },
    selectNow: (id: string) => {
      spawnSync(executable, [id], { stdio: 'ignore' })
    },
  }
}

/** How the ownership reports a machine where English cannot be selected. */
export interface InputSourceOwnershipOptions {
  /**
   * Called once, the first time English cannot be selected.
   *
   * The client degrades to leaving the user's source alone, which looks exactly
   * like a broken switch; this is what lets the window say so.
   */
  readonly onUnavailable?: () => void
}

/** The client's claim on the input source while a command surface holds keys. */
export interface InputSourceOwnership {
  /** Take the keyboard for a command surface: switch to English. */
  acquire(): void
  /** Give the keyboard back to a text surface: restore once, if still ours. */
  release(): void
  /**
   * Give the source back on the way out of the process.
   *
   * The asynchronous queue cannot be awaited during shutdown, so this reads and
   * switches synchronously. The same rule applies as in {@link release}: a source
   * the user chose by hand while a command surface held the keyboard is theirs.
   *
   * A switch still in flight is not visible here — quitting inside the one spawn
   * an acquire takes leaves the source where it is. Waiting for
   * {@link InputSourceOwnership.idle} first is what closes that.
   */
  restoreNow(): void
  /** Resolve once every queued acquire/release has finished. */
  idle(): Promise<void>
}

/** One claim: what we found, what we set, and how many surfaces want it. */
interface Claim {
  previous: string | undefined
  selected: string | undefined
  changed: boolean
  depth: number
}

/**
 * Build the ownership over the helper.
 *
 * The helper is resolved on every call, never captured: a source checkout builds
 * `bin/ime` at start, and a window that began without one must pick it up on the
 * next call rather than stay deaf for the rest of its life.
 * @param resolve - the helper to call, or undefined when there is none at all.
 * @param options - what to do when English cannot be selected.
 * @returns the ownership, safe to call from any focus callback.
 */
export function inputSourceOwnership(
  resolve: () => InputSource | undefined,
  options: InputSourceOwnershipOptions = {},
): InputSourceOwnership {
  /** The live claim, or undefined when the user's own source is in force. */
  let claim: Claim | undefined
  /** Every call runs after the one before it, so a fast back-and-forth lands in order. */
  let queue: Promise<void> = Promise.resolve()
  /** The missing-English notice is worth saying once per window, not per focus. */
  let warned = false

  const enqueue = (step: () => Promise<void>): void => {
    queue = queue.then(step).catch(() => {})
  }

  return {
    acquire: () => enqueue(async () => {
      if (claim !== undefined) {
        claim.depth += 1
        return
      }
      const source = resolve()
      if (source === undefined) return
      const result = await source.english()
      if (result.unavailable || result.failed) {
        if (!warned) {
          warned = true
          options.onUnavailable?.()
        }
        return
      }
      claim = { previous: result.previous, selected: result.selected, changed: result.changed, depth: 1 }
    }),
    release: () => enqueue(async () => {
      if (claim === undefined) return
      claim.depth -= 1
      if (claim.depth > 0) return
      const finished = claim
      claim = undefined
      // Nothing was changed, or the helper never named the source it set: there
      // is nothing this call could safely give back.
      if (!finished.changed || finished.previous === undefined || finished.selected === undefined) return
      const source = resolve()
      if (source === undefined) return
      // Give back only the client's own change. A source the user picked by hand
      // while a command surface held the keyboard is theirs, and wins.
      if (await source.current() !== finished.selected) return
      await source.select(finished.previous)
    }),
    idle: () => queue,
    restoreNow: () => {
      const finished = claim
      claim = undefined
      if (finished === undefined || !finished.changed) return
      if (finished.previous === undefined || finished.selected === undefined) return
      const source = resolve()
      if (source === undefined) return
      if (source.currentNow() !== finished.selected) return
      source.selectNow(finished.previous)
    },
  }
}
