/**
 * `config/client.json`: the terminal client's own preferences for one state root.
 *
 * Preferences are per window and per state root, not Host settings, so they live
 * beside each other in one small file: the interface language, and the last
 * release whose changelog this state root has already shown. One file means a
 * writer must merge instead of truncate — saving the language cannot forget the
 * changelog marker, and vice versa — so every write goes through
 * {@link updateClientPreferences}.
 *
 * The file is written atomically with user-only permissions. It holds no
 * secrets, but one small file cannot leak a token and a crash between truncate
 * and write must not leave a half document.
 *
 * @module hulala-cli/clientPreferences
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const FILE = 'client.json'

/** Path of the client preferences file for one state root. */
export function clientConfigPath(dataRoot: string): string {
  return join(dataRoot, 'config', FILE)
}

/** What the file held, or why it could not be read. */
export interface ClientPreferences {
  /** Whether a preferences file exists at all. */
  readonly present: boolean
  /** The parsed document; empty when there is no file or it cannot be read. */
  readonly values: Record<string, unknown>
  /** Why an existing file could not be used. */
  readonly problem?: string
}

/**
 * Read the preferences without throwing.
 * @param dataRoot - the Hulala state root.
 * @returns the document, whether it exists, and why it could not be read.
 */
export function readClientPreferences(dataRoot: string): ClientPreferences {
  let text: string
  try {
    text = readFileSync(clientConfigPath(dataRoot), 'utf8')
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === 'ENOENT') return { present: false, values: {} }
    return { present: true, values: {}, problem: caught instanceof Error ? caught.message : String(caught) }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (caught) {
    return { present: true, values: {}, problem: caught instanceof Error ? caught.message : String(caught) }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { present: true, values: {}, problem: 'client.json is not an object' }
  }
  return { present: true, values: parsed as Record<string, unknown> }
}

/**
 * Merge one change into the preferences atomically.
 *
 * A file that cannot be read is replaced rather than merged: the user asked for
 * this preference, and refusing to save it would strand a window with no way to
 * record the choice.
 * @param dataRoot - the Hulala state root.
 * @param patch - the keys to set.
 */
export function updateClientPreferences(dataRoot: string, patch: Record<string, unknown>): void {
  const target = clientConfigPath(dataRoot)
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
  const temporary = `${target}.${process.pid}.tmp`
  const merged = { ...readClientPreferences(dataRoot).values, ...patch }
  try {
    writeFileSync(temporary, `${JSON.stringify(merged)}\n`, { mode: 0o600 })
    renameSync(temporary, target)
  } finally {
    rmSync(temporary, { force: true })
  }
}
