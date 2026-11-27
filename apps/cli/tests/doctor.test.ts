import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { diagnose } from '../src/doctor.ts'

/** Run one check against an injected state root, restoring the environment. */
async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'hulala-doctor-'))
  const previous = process.env.HULALA_HOME
  process.env.HULALA_HOME = root
  try {
    await run(root)
  } finally {
    if (previous === undefined) delete process.env.HULALA_HOME
    else process.env.HULALA_HOME = previous
    await rm(root, { recursive: true, force: true })
  }
}

/** Write one Host profile manifest. */
async function writeProfile(root: string, dependencies: Record<string, string>): Promise<void> {
  const profile = join(root, 'harness', 'profiles', 'tui')
  await mkdir(profile, { recursive: true })
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    name: 'hulala-profile',
    private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
    dependencies,
  }, null, 2))
}

test('names a profile link whose runtime version was pruned', async () => {
  await withRoot(async root => {
    const live = join(root, 'runtime', 'client', 'versions', 'live', 'runtime', 'node_modules', '@colinagent', 'dsh-mcp')
    await mkdir(live, { recursive: true })
    const pruned = join(root, 'runtime', 'client', 'versions', 'pruned', 'runtime', 'node_modules', '@colinagent', 'dsh-mcp')
    await writeProfile(root, {
      '@colinagent/dsh-mcp': `link:${live}`,
      '@colinagent/hulala-bot': `link:${pruned}`,
    })
    const { problems, warnings } = await diagnose(root)
    assert.equal(problems.length, 1)
    assert.equal(warnings.length, 0)
    assert.equal(problems[0]?.check, 'profile-link')
    // The detail has to name the package and the path: "a link is broken" is
    // not enough to find the row that a `hulala plugin add` wrote.
    assert.match(problems[0]?.detail ?? '', /@colinagent\/hulala-bot/)
    assert.match(problems[0]?.detail ?? '', /pruned/u)
  })
})

test('a healthy profile with no Host running has nothing to report', async () => {
  await withRoot(async root => {
    const live = join(root, 'runtime', 'client', 'versions', 'live', 'runtime', 'node_modules', '@colinagent', 'dsh-mcp')
    await mkdir(live, { recursive: true })
    await writeProfile(root, { '@colinagent/dsh-mcp': `link:${live}`, 'plain-package': '^1.0.0' })
    // No Host is running in this test, so the check reports nothing broken and
    // nothing it could not prove: `hulala doctor` prints "ok" and exits 0.
    assert.deepEqual(await diagnose(root), { problems: [], warnings: [] })
  })
})
