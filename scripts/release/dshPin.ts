/**
 * Pin facts the release gate compares against DeepSeek Harness.
 *
 * DSH is the only Agent Runtime and the Host boots it in process, so Hulala's
 * dependency pins, its Node.js floor and the Node.js line the installer downloads
 * all have to follow what DSH publishes. This module keeps those comparisons
 * pure so the gate can be tested without the registry.
 *
 * @module hulala/release/dsh-pin
 */

/** A comparable Node.js version floor, e.g. `>=24.9.0` → `[24, 9, 0]`. */
export type NodeFloor = readonly [number, number, number]

/** Package names that belong to one DSH release and therefore share its version. */
const DSH_PACKAGE = /^@deepseek-ai\/dsh(?:-|$)/

/**
 * Read an `engines.node` range as a floor.
 * Only the shapes DSH publishes are understood: `>=X.Y.Z` with an optional
 * suffix, and `^X.Y.Z` / `>=X.Y` as a fallback. Anything else is a fact the gate
 * cannot check, which is a failure, not a pass.
 * @param engines - the `engines` object of a package manifest.
 * @returns the floor, or `undefined` when the value is absent or unreadable.
 */
export function parseNodeFloor(engines: unknown): NodeFloor | undefined {
  const value = (engines as { node?: unknown } | undefined)?.node
  if (typeof value !== 'string') return undefined
  const match = /^(?:>=|\^|~)?\s*v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(value.trim())
  if (match === null) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? '0')]
}

/**
 * Compare two release versions the way npm orders them, including prereleases.
 * @param left - first version, e.g. `0.2.2-rc.1`.
 * @param right - second version.
 * @returns negative when `left` is older, zero when equal, positive when newer.
 */
export function compareVersions(left: string, right: string): number {
  const [leftCore, leftPre] = split(left)
  const [rightCore, rightPre] = split(right)
  for (let index = 0; index < Math.max(leftCore.length, rightCore.length); index += 1) {
    const difference = (leftCore[index] ?? 0) - (rightCore[index] ?? 0)
    if (difference !== 0) return difference
  }
  // A release outranks its own prereleases: 0.2.2 > 0.2.2-rc.1.
  if (leftPre === undefined && rightPre === undefined) return 0
  if (leftPre === undefined) return 1
  if (rightPre === undefined) return -1
  for (let index = 0; index < Math.max(leftPre.length, rightPre.length); index += 1) {
    const leftPart = leftPre[index], rightPart = rightPre[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const leftNumber = /^\d+$/.test(leftPart), rightNumber = /^\d+$/.test(rightPart)
    if (leftNumber && rightNumber) {
      const difference = Number(leftPart) - Number(rightPart)
      if (difference !== 0) return difference
    } else if (leftPart !== rightPart) return leftNumber ? -1 : rightNumber ? 1 : leftPart < rightPart ? -1 : 1
  }
  return 0
}

function split(version: string): [number[], string[] | undefined] {
  const [core, prerelease] = version.split('-', 2) as [string, string | undefined]
  const numbers = core.split('.').map(part => Number(part))
  return [numbers, prerelease === undefined ? undefined : prerelease.split('.')]
}

/**
 * Read the major version of a `nodejs.org/dist` release line.
 * @param line - e.g. `latest-v24.x`.
 * @returns the major, or `undefined` when the line is not understood.
 */
export function nodeLineMajor(line: string): number | undefined {
  const match = /^latest-v(\d+)\.x$/.exec(line)
  return match === null ? undefined : Number(match[1])
}

/** One workspace manifest and its dependency pins. */
export interface ManifestPins {
  /** Manifest path, used in messages. */
  readonly name: string
  /** `dependencies` (and `optionalDependencies`) of that manifest. */
  readonly dependencies?: Readonly<Record<string, string>>
}

/** What the gate found in the manifests. */
export interface DshPins {
  /** The single DSH release every DSH package is pinned to, when consistent. */
  readonly version?: string
  /** One line per pin that disagrees with the others or is not exact. */
  readonly mismatches: readonly string[]
}

/**
 * Collect the DSH release every manifest agrees on.
 * @param manifests - workspace manifests that depend on DSH.
 * @returns the agreed version and every disagreement.
 */
export function collectDshPins(manifests: readonly ManifestPins[]): DshPins {
  const seen = new Map<string, string[]>()
  const mismatches: string[] = []
  for (const manifest of manifests) {
    for (const [name, version] of Object.entries({ ...manifest.dependencies })) {
      if (!DSH_PACKAGE.test(name)) continue
      if (/^[\^~><=*]|\s/.test(version) || version.includes('||')) {
        mismatches.push(`${manifest.name}: ${name} is not pinned (${version})`)
        continue
      }
      seen.set(version, [...(seen.get(version) ?? []), `${manifest.name}: ${name}@${version}`])
    }
  }
  if (seen.size === 0) {
    mismatches.push('no @deepseek-ai/dsh dependency is declared')
    return { mismatches }
  }
  if (seen.size > 1) {
    for (const [version, where] of seen) mismatches.push(`DSH ${version} is used by ${where.join(', ')}`)
    return { version: undefined, mismatches }
  }
  return { version: [...seen.keys()][0], mismatches }
}

/**
 * Channels DSH publishes that are not the stable one.
 * `latest` is the stable channel even when its version is a release candidate:
 * DSH has never published a version without a prerelease suffix, so "stable" can
 * only mean "the release their `latest` tag points at". `next`, `alpha`, `beta`,
 * `canary` and `dev` are the unstable ones and must never be pinned.
 */
const UNSTABLE_CHANNELS = ['next', 'alpha', 'beta', 'canary', 'dev'] as const

/** What the gate concluded about one pinned DSH version. */
export type ChannelVerdict =
  | { readonly kind: 'stable' }
  | { readonly kind: 'behind', readonly latest: string }
  | { readonly kind: 'unstable-channel', readonly channels: readonly string[], readonly latest: string }
  | { readonly kind: 'unknown', readonly latest: string }

/**
 * Decide whether a pin sits on DSH's stable channel.
 * @param pin - the version Hulala pins, e.g. `0.2.2-rc.1`.
 * @param tags - the package's `dist-tags`, e.g. `{ latest: '0.2.2-rc.1', next: '...' }`.
 * @returns the verdict, with the stable version to move to when there is one.
 */
export function classifyPin(pin: string, tags: Readonly<Record<string, string>>): ChannelVerdict {
  const latest = tags.latest
  if (latest === undefined) return { kind: 'unknown', latest: '' }
  if (pin === latest) return { kind: 'stable' }
  const unstable = UNSTABLE_CHANNELS.filter(channel => tags[channel] === pin)
  // A pin that only an unstable tag points at was never released as stable, even
  // when it sorts above the stable version.
  if (unstable.length > 0) return { kind: 'unstable-channel', channels: unstable, latest }
  if (compareVersions(pin, latest) < 0) return { kind: 'behind', latest }
  return { kind: 'unknown', latest }
}
