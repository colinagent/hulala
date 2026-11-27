/**
 * `hulala doctor` — what this installation would fail on, before it fails.
 *
 * Two failures motivated this check and neither was visible from the outside:
 * a profile `link:` into a runtime version tree that an upgrade had pruned
 * (`@colinagent/dsh-mcp` stayed inactive for eight days while the Host kept
 * booting), and a Host running a plugin version older than the profile because
 * nobody restarted it after an install. Both are decidable from files and from
 * the Host's own health document, so neither needs a human to notice a warning
 * line.
 *
 * @module hulala-cli/doctor
 */
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { resolveRuntimePaths } from '@hulala/runtime'
import { PROFILE_NAME } from '@hulala/runtime/host'
import { inspectHost } from './hostAttach.ts'

/** One thing this installation would fail on. */
export interface Problem {
  readonly check: 'profile-link' | 'host-degraded' | 'host-composition'
  readonly detail: string
}

/** What one doctor run found. */
export interface Diagnosis {
  /** Things that are broken now; a non-zero exit is about these. */
  readonly problems: readonly Problem[]
  /** Things that limit what this command can prove, but are not broken. */
  readonly warnings: readonly Problem[]
}

/**
 * Check the profile on disk and the Host that is actually running.
 * @param data - the Hulala state root.
 * @returns broken links and inactive entries as problems, and anything that
 * keeps the check from being conclusive as a warning.
 */
export async function diagnose(data: string): Promise<Diagnosis> {
  const problems: Problem[] = profileLinks(resolveRuntimePaths({ root: data }))
    .map(detail => ({ check: 'profile-link', detail }))
  const warnings: Problem[] = []
  const inspected = await inspectHost()
  if (inspected.state !== 'running') return { problems, warnings }
  const { health } = inspected
  if (health.plugins === undefined) {
    // An older Host cannot report, which is not the same news as a broken one:
    // it is a reason this run proves less, not a reason to fail an install.
    warnings.push({
      check: 'host-composition',
      detail: `the running Host (pid ${String(inspected.record.pid)}) predates this check, so nothing confirms what it loaded; restart it after the next update`,
    })
  }
  for (const row of health.degraded ?? []) {
    problems.push({
      check: 'host-degraded',
      detail: `${row.module}@${row.version} is ${row.state} in the running Host (pid ${String(inspected.record.pid)})`,
    })
  }
  return { problems, warnings }
}

/**
 * Every `link:` dependency of the Host profile that does not resolve.
 *
 * A link whose target was pruned is dangling, so `existsSync` follows it and
 * answers false — which is exactly the state the Host cannot repair on its own.
 * @param paths - resolved runtime paths.
 * @returns one line per broken link.
 */
function profileLinks(paths: ReturnType<typeof resolveRuntimePaths>): string[] {
  const profileDir = join(paths.harnessDir, 'profiles', PROFILE_NAME)
  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) return []
  let dependencies: Record<string, string> = {}
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { dependencies?: Record<string, string> }
    dependencies = manifest.dependencies ?? {}
  } catch {
    return [`${manifestPath} is not readable JSON`]
  }
  const broken: string[] = []
  for (const [name, spec] of Object.entries(dependencies)) {
    if (!spec.startsWith('link:')) continue
    const target = spec.slice('link:'.length)
    const path = isAbsolute(target) ? target : resolve(profileDir, target)
    if (!existsSync(path)) broken.push(`${name} links ${path}, which no longer exists (starting the Host once repairs it)`)
  }
  return broken
}
