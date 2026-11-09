/**
 * `installedRelease` — the one fact a stale client needs to know.
 *
 * Two failures matter more than the happy path: a launcher belonging to another
 * installation (a source checkout next to an installed release), and a process
 * that was not started by a launcher at all. Both must read as "unknown", or a
 * checkout would offer to downgrade itself onto whatever release shares the
 * state root.
 */
import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installedRelease, launcherPath } from '../src/distribution/installedRelease.js'

const DIGEST = 'a'.repeat(64)

function installation(): { home: string; root: string; version: string } {
  const home = mkdtempSync(join(tmpdir(), 'hulala-installed-'))
  const root = join(home, 'runtime', 'tui')
  mkdirSync(join(home, 'bin'), { recursive: true })
  mkdirSync(join(root, 'versions', '0.2.27-e4dce47'), { recursive: true })
  writeFileSync(launcherPath(home), [
    '#!/bin/sh',
    `# hulala-launcher {"format":1,"root":${JSON.stringify(root)},"state":${JSON.stringify(home)}}`,
    'set -eu',
    '',
  ].join('\n'))
  writeFileSync(join(root, 'active.json'), JSON.stringify({
    format: 1,
    current: { id: '0.2.27-e4dce47', version: '0.2.27', manifestSha256: DIGEST, dataFormat: 1 },
  }))
  return { home, root, version: '0.2.27' }
}

test('the launcher marker and active.json name the installed release', async () => {
  const { home, root, version } = installation()
  const installed = await installedRelease(home, { HULALA_INSTALL_ROOT: root })
  expect(installed?.version).toBe(version)
  expect(installed?.launcher).toBe(launcherPath(home))
  expect(installed?.root).toBe(root)
})

test('a process the launcher did not start is not an installation', async () => {
  const { home, root } = installation()
  // A source checkout sharing the state root: the launcher belongs to the
  // release, and reading it here would offer a downgrade.
  expect(await installedRelease(home, {})).toBeUndefined()
  expect(await installedRelease(home, { HULALA_INSTALL_ROOT: join(home, 'elsewhere') })).toBeUndefined()
  // The launcher's own root still works after the guard.
  expect((await installedRelease(home, { HULALA_INSTALL_ROOT: root }))?.version).toBeDefined()
})

test('a missing or unreadable installation reads as unknown', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hulala-installed-empty-'))
  expect(await installedRelease(home, { HULALA_INSTALL_ROOT: join(home, 'runtime', 'tui') })).toBeUndefined()
  // A launcher that names a root whose `active.json` is mid-write reads as
  // unknown rather than throwing into the caller.
  const root = join(home, 'runtime', 'tui')
  mkdirSync(join(home, 'bin'), { recursive: true })
  mkdirSync(root, { recursive: true })
  writeFileSync(launcherPath(home), `#!/bin/sh\n# hulala-launcher {"format":1,"root":${JSON.stringify(root)},"state":${JSON.stringify(home)}}\n`)
  writeFileSync(join(root, 'active.json'), '{"format":1,"current":{"id":"half"}}')
  expect(await installedRelease(home, { HULALA_INSTALL_ROOT: root })).toBeUndefined()
})
