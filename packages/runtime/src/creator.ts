/**
 * Creator mode: the opt-in that gives the agent a plugin-writing toolset.
 *
 * It is off until the user says otherwise, and the setting lives in a file of its
 * own under the state root's `config/` directory rather than inside the Harness
 * profile. Two reasons: the profile patch is the Harness settings document and
 * rewriting it is the Harness's business, and a capability this broad has to be
 * exactly as visible as the file that turns it on.
 *
 * The flag changes two things at boot, and both are recomputed on every start:
 * the Host half (`dsh-cordis-host-runner` plus the inspect providers) is part of
 * the Host composition only when it is on, and the agent preset gains or loses
 * its `tool-cordis` row. Turning it off therefore removes the capability from an
 * existing profile instead of leaving it behind.
 *
 * @module hulala-runtime/creator
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** File name under the state root's `config/` directory. */
const CREATOR_FILE = 'creator.json'

/** What the file holds. Unknown keys are ignored, so it can grow. */
interface CreatorDocument {
  readonly enabled?: unknown
}

/** Path of the Creator-mode setting for one configuration root. */
export function creatorModePath(configDir: string): string {
  return join(configDir, CREATOR_FILE)
}

/**
 * Read the setting.
 *
 * A missing, unreadable or corrupt file means **off**: the capability is opt-in,
 * and a truncated file must not be read as consent.
 * @param configDir - the state root's `config/` directory.
 * @returns whether the user turned Creator mode on.
 */
export function readCreatorMode(configDir: string): boolean {
  try {
    const parsed: unknown = JSON.parse(readFileSync(creatorModePath(configDir), 'utf8'))
    return (parsed as CreatorDocument | null)?.enabled === true
  } catch {
    return false
  }
}

/**
 * Record the setting.
 *
 * Written through a temporary file so a crash mid-write leaves the previous
 * value rather than an empty document that would read as "off".
 * @param configDir - the state root's `config/` directory.
 * @param enabled - the new value.
 */
export function writeCreatorMode(configDir: string, enabled: boolean): void {
  mkdirSync(configDir, { recursive: true, mode: 0o700 })
  const target = creatorModePath(configDir)
  const temporary = `${target}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify({ enabled }, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, target)
}

/** Remove the setting, which reads as "off". */
export function clearCreatorMode(configDir: string): void {
  rmSync(creatorModePath(configDir), { force: true })
}
