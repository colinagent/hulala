import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { classifyPin, collectDshPins, compareVersions, nodeLineMajor, parseNodeFloor } from '../scripts/release/dshPin'

test('a Node.js floor is read from the shapes DSH publishes', () => {
  expect(parseNodeFloor({ node: '>=24.9.0' })).toEqual([24, 9, 0])
  expect(parseNodeFloor({ node: '>=24.9' })).toEqual([24, 9, 0])
  expect(parseNodeFloor({ node: '^22.13.0' })).toEqual([22, 13, 0])
  expect(parseNodeFloor({ node: '>= 26.0.0-rc.1' })).toEqual([26, 0, 0])
  expect(parseNodeFloor({})).toBeUndefined()
  expect(parseNodeFloor(undefined)).toBeUndefined()
  expect(parseNodeFloor({ node: 'lts/*' })).toBeUndefined()
})

test('versions order like npm, prereleases below their release', () => {
  expect(compareVersions('0.2.2-rc.1', '0.2.2')).toBeLessThan(0)
  expect(compareVersions('0.2.2', '0.2.2-rc.1')).toBeGreaterThan(0)
  expect(compareVersions('0.2.1', '0.2.2-rc.1')).toBeLessThan(0)
  expect(compareVersions('0.2.2-rc.1', '0.2.2-rc.2')).toBeLessThan(0)
  expect(compareVersions('0.2.10', '0.2.9')).toBeGreaterThan(0)
  expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
})

test('the installer line names one major', () => {
  expect(nodeLineMajor('latest-v24.x')).toBe(24)
  expect(nodeLineMajor('latest')).toBeUndefined()
  expect(nodeLineMajor('latest-v22')).toBeUndefined()
})

test('every DSH package must share one exact release', () => {
  const consistent = collectDshPins([
    { name: 'runtime', dependencies: { '@deepseek-ai/dsh': '0.2.2-rc.1', '@deepseek-ai/dsh-fs': '0.2.2-rc.1', '@deepseek-ai/cordis': '4.1.0' } },
    { name: 'server', dependencies: { '@deepseek-ai/dsh-api-remotes': '0.2.2-rc.1', zod: '4.4.3' } },
  ])
  expect(consistent).toEqual({ version: '0.2.2-rc.1', mismatches: [] })

  const mixed = collectDshPins([
    { name: 'runtime', dependencies: { '@deepseek-ai/dsh': '0.2.2-rc.1' } },
    { name: 'server', dependencies: { '@deepseek-ai/dsh-fs': '0.2.1' } },
  ])
  expect(mixed.version).toBeUndefined()
  expect(mixed.mismatches.length).toBe(2)

  const ranged = collectDshPins([{ name: 'runtime', dependencies: { '@deepseek-ai/dsh': '^0.2.2' } }])
  expect(ranged.mismatches[0]).toContain('is not pinned')

  expect(collectDshPins([{ name: 'runtime', dependencies: {} }]).mismatches[0]).toContain('no @deepseek-ai/dsh dependency')
})

test('the gate passes on this checkout, offline', async () => {
  const root = join(import.meta.dirname, '..')
  const child = Bun.spawn(['bun', 'run', 'scripts/release/checkDsh.ts', '--offline', '--json'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const result = JSON.parse(stdout) as { ok: boolean, failures: unknown[], report: { dshVersion: string, nodeFloor: string, installerNodeLine: string, releaseCiNode: number } }
  expect(stderr).toBe('')
  expect(code).toBe(0)
  expect(result.ok).toBe(true)
  expect(result.failures).toEqual([])
  expect(result.report.dshVersion).toMatch(/^\d+\.\d+\.\d+/)
  expect(result.report.installerNodeLine).toBe('latest-v24.x')
  // The manifest floor and the release CI line both follow the installed DSH.
  expect(result.report.releaseCiNode).toBeGreaterThanOrEqual(Number(result.report.nodeFloor.split('.')[0]))
}, 60_000)

test("the stable channel is DSH's latest tag, never next or alpha", () => {
  const tags = { latest: '0.2.2-rc.1', next: '0.2.2-rc.1', alpha: '0.2.2-alpha.3' }
  // DSH publishes only prerelease versions, so a prerelease on `latest` is stable.
  expect(classifyPin('0.2.2-rc.1', tags)).toEqual({ kind: 'stable' })
  // An older pin is behind the stable channel and must be merged.
  expect(classifyPin('0.2.1-rc.5', tags)).toEqual({ kind: 'behind', latest: '0.2.2-rc.1' })
  // A version only the unstable tags point at is never an integration point, even
  // when it sorts above the stable one.
  expect(classifyPin('0.2.2-alpha.3', tags)).toEqual({ kind: 'unstable-channel', channels: ['alpha'], latest: '0.2.2-rc.1' })
  expect(classifyPin('0.2.3-rc.1', { latest: '0.2.2-rc.1', next: '0.2.3-rc.1' })).toEqual({ kind: 'unstable-channel', channels: ['next'], latest: '0.2.2-rc.1' })
  // Published but not tagged: still not the stable channel.
  expect(classifyPin('0.2.3-rc.1', tags)).toEqual({ kind: 'unknown', latest: '0.2.2-rc.1' })
  expect(classifyPin('0.2.2-rc.1', {})).toEqual({ kind: 'unknown', latest: '' })
})
