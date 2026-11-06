/**
 * Release gate: Hulala must ship the latest stable DeepSeek Harness, and the
 * Node.js floor plus the Node.js line the installer downloads must follow what
 * DSH declares.
 *
 * DSH is the only Agent Runtime and the Host boots it in process, so "our"
 * versions are never independent of it: a release that skips a DSH release, or
 * that keeps a Node.js floor DSH has already raised, ships a Host nobody upstream
 * supports. Run this before bumping the version (see the release skill).
 *
 *   bun run check:dsh             # local facts + the published stable tag
 *   bun run check:dsh --offline   # local facts only (no network)
 *
 * @module hulala/release/check-dsh
 */
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { classifyPin, collectDshPins, compareVersions, nodeLineMajor, parseNodeFloor, type NodeFloor } from './dshPin.ts'
import { DEFAULT_NODE_LINE } from './installScriptTemplate.ts'

const root = resolve(import.meta.dirname, '../..')
const offline = process.argv.includes('--offline')
const json = process.argv.includes('--json')
const failures: string[] = []
const warnings: string[] = []
const report: Record<string, unknown> = {}

const readJson = async (path: string): Promise<any> => JSON.parse(await readFile(join(root, path), 'utf8'))
const manifest = (path: string) => join(root, path)

const runtime = await readJson('packages/runtime/package.json')
const server = await readJson('apps/server/package.json')
const cli = await readJson('apps/cli/package.json')

// 1. One exact DSH release across the manifests that install it.
const pins = collectDshPins([
  { name: 'packages/runtime/package.json', dependencies: runtime.dependencies },
  { name: 'apps/server/package.json', dependencies: server.dependencies },
])
for (const mismatch of pins.mismatches) failures.push(mismatch)
const dshVersion = pins.version
report.dshVersion = dshVersion ?? null

// 2. Our declared floor is DSH's floor, not something looser we invented.
const ours: NodeFloor | undefined = parseNodeFloor(cli.engines)
report.nodeFloor = ours === undefined ? null : ours.join('.')
report.installerNodeLine = DEFAULT_NODE_LINE
if (ours === undefined) failures.push('apps/cli/package.json declares no readable engines.node floor')

let published: { version: string, floor: NodeFloor | undefined, engines: unknown } | undefined
if (dshVersion !== undefined && !offline) {
  const response = await fetch('https://registry.npmjs.org/@deepseek-ai%2Fdsh').catch((error: unknown) => {
    failures.push(`cannot reach the npm registry for @deepseek-ai/dsh: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  })
  if (response !== undefined) {
    if (!response.ok) failures.push(`the npm registry answered ${response.status} for @deepseek-ai/dsh`)
    else {
      const metadata = await response.json() as { 'dist-tags'?: Record<string, string>, versions?: Record<string, { engines?: unknown }> }
      const tags = metadata['dist-tags'] ?? {}
      const latest = tags.latest
      if (latest === undefined) failures.push('@deepseek-ai/dsh publishes no latest dist-tag')
      else {
        published = { version: latest, floor: parseNodeFloor(metadata.versions?.[latest]?.engines), engines: metadata.versions?.[latest]?.engines }
        report.stableChannel = latest
        report.channelTags = tags
        report.publishedFloor = published.floor?.join('.') ?? null
        // DSH publishes only prerelease versions, so its stable channel is the
        // `latest` tag; `next`/`alpha` are never integration points.
        const verdict = classifyPin(dshVersion, tags)
        if (verdict.kind === 'behind')
          failures.push(`DeepSeek Harness ${latest} is the stable channel but Hulala pins ${dshVersion}; merge it before releasing`)
        else if (verdict.kind === 'unstable-channel')
          failures.push(`Hulala pins ${dshVersion}, which only the unstable channel(s) ${verdict.channels.join('/')} point at; integrate the stable channel ${latest} instead`)
        else if (verdict.kind === 'unknown')
          failures.push(`Hulala pins ${dshVersion}, which is not the published stable channel (${latest}); integrate ${latest}`)
      }
    }
  }
}

// 3. The floor, the installer line and the release CI line must all still fit.
const floor = published?.floor ?? ours
if (floor !== undefined) {
  if (ours !== undefined && (ours[0] !== floor[0] || ours[1] !== floor[1] || ours[2] !== floor[2]))
    failures.push(`apps/cli declares node >=${ours.join('.')} but DeepSeek Harness declares >=${floor.join('.')}; set engines.node to >=${floor.join('.')}`)
  const line = nodeLineMajor(DEFAULT_NODE_LINE)
  if (line === undefined) failures.push(`DEFAULT_NODE_LINE is not a latest-vX.x line: ${DEFAULT_NODE_LINE}`)
  else if (line < floor[0]) failures.push(`the installer downloads Node.js ${line}.x but the floor is ${floor.join('.')}`)
}

const releaseWorkflow = await readFile(manifest('.github/workflows/release.yml'), 'utf8')
const ciVersion = /node-version:\s*'?(\d+)/.exec(releaseWorkflow)?.[1]
report.releaseCiNode = ciVersion === undefined ? null : Number(ciVersion)
if (ciVersion === undefined) warnings.push('the release workflow declares no node-version')
else if (floor !== undefined && Number(ciVersion) < floor[0])
  failures.push(`the release workflow builds on Node.js ${ciVersion} but DeepSeek Harness requires >=${floor.join('.')}`)

// 4. The installed tree must agree with the manifests, so a stale node_modules
// does not silently test the previous DSH.
try {
  const installed = await readJson('node_modules/@deepseek-ai/dsh/package.json')
  report.installedDsh = installed.version
  report.installedFloor = parseNodeFloor(installed.engines)?.join('.') ?? null
  if (dshVersion !== undefined && installed.version !== dshVersion)
    failures.push(`node_modules has DeepSeek Harness ${installed.version} but the manifests pin ${dshVersion}; run bun install --frozen-lockfile`)
  const installedFloor = parseNodeFloor(installed.engines)
  if (installedFloor !== undefined && ours !== undefined && installedFloor.join('.') !== ours.join('.'))
    failures.push(`the installed DeepSeek Harness requires node >=${installedFloor.join('.')} but apps/cli declares >=${ours.join('.')}`)
} catch {
  warnings.push('node_modules/@deepseek-ai/dsh is not installed; run bun install to let the gate check the installed tree')
}

// 5. A native dependency DSH pins exactly must be pinned to the same version
// here, or npm installs a second copy: the release lock then carries an older
// `sharp` (a native binary tree) that a security-gated registry can refuse, and
// the install fails on the archive the next release publishes.
const sharp = runtime.dependencies?.sharp
report.runtimeSharp = typeof sharp === 'string' ? sharp : null
if (typeof sharp !== 'string')
  failures.push("packages/runtime/package.json declares no sharp pin; the Host installs DSH's attachment plugin, which needs one")
else {
  try {
    const attachment = await readJson('node_modules/@deepseek-ai/dsh-attachment-local/package.json')
    const required: unknown = attachment.dependencies?.sharp
    report.dshSharp = typeof required === 'string' ? required : null
    if (typeof required === 'string' && !/^[\^~><=*]|\s/.test(required) && required !== sharp)
      failures.push(`packages/runtime/package.json pins sharp ${sharp} but @deepseek-ai/dsh-attachment-local@${attachment.version} requires exactly ${required}; pin the same version so the release lock installs one native copy`)
  } catch {
    warnings.push('node_modules/@deepseek-ai/dsh-attachment-local is not installed; run bun install to let the gate check the sharp pin')
  }
}

if (json) console.log(JSON.stringify({ ok: failures.length === 0, failures, warnings, report }, null, 2))
else {
  for (const [key, value] of Object.entries(report))
    console.log(`${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
  for (const warning of warnings) console.error(`warning: ${warning}`)
  for (const failure of failures) console.error(`error: ${failure}`)
  if (failures.length === 0) console.log('DeepSeek Harness gate: ok')
  else {
    console.error(`
DeepSeek Harness gate: ${failures.length} problem(s).
A release cannot ship behind DSH's stable channel, cannot pin a version that only
an unstable DSH channel (next/alpha/beta/canary) points at, cannot fall behind
the Node.js floor DSH declares, and cannot pin a native dependency (sharp) to a
version other than the one DSH's attachment plugin requires.
Merge it first: bump the @deepseek-ai/dsh* pins in packages/runtime and
apps/server together, run bun install, bun run test and bun run build, then set
engines.node, DEFAULT_NODE_LINE (scripts/release/installScriptTemplate.ts) and the
release workflow's node-version to what DSH declares.`)
  }
}
if (failures.length > 0) process.exit(1)
