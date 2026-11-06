import { expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Installation, launcherRoot } from '../src/distribution/install.js'

/** Install a command whose launcher runs an active version that needs no Node. */
async function installed(root: string, version = '1.0.0'): Promise<{ state: string, command: string }> {
  const state = join(root, 'state'), location = join(state, 'runtime/client')
  const installation = new Installation(location, state)
  const directory = join(location, 'versions', version)
  await mkdir(join(directory, 'bin'), { recursive: true })
  await writeFile(join(directory, 'bin/hulala'), `#!/bin/sh\necho "running ${version} $*"\n`)
  await chmod(join(directory, 'bin/hulala'), 0o755)
  await writeFile(join(location, 'active.json'), JSON.stringify({ format: 1, current: { id: version, version, manifestSha256: 'a'.repeat(64), dataFormat: 1 } }))
  const command = join(root, 'commands/hulala')
  await installation.installLauncher(command)
  return { state, command }
}

/** A runtime stand-in that answers the version probe and echoes what it started. */
function runtime(version: string): string {
  return `#!/bin/sh
case "$1" in
  --version) echo ${version} ;;
  *) echo "runtime ${version} $*" ;;
esac
`
}

async function place(path: string, contents: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, contents)
  await chmod(path, 0o755)
}

test('the launcher starts the Node the installer supplied inside the state root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala launcher node '))
  try {
    const { state, command } = await installed(root)
    const node = join(state, 'runtime/node/node-v24.9.0-test/bin/node')
    await place(node, runtime('v24.9.0'))
    await writeFile(join(state, 'runtime/node/CURRENT'), 'node-v24.9.0-test\n')
    const result = Bun.spawnSync([command, 'status'], { stdout: 'pipe', stderr: 'pipe' })
    expect(result.stderr.toString()).toBe('')
    expect(result.exitCode).toBe(0)
    // The supplied runtime wins over the machine's own, and it is handed the
    // JavaScript program instead of the version directory's shebang script.
    expect(result.stdout.toString()).toContain(`runtime v24.9.0 ${join(state, 'runtime/client/launcher.mjs')} status`)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('the launcher prefers the stable entry point beside CURRENT', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala launcher stable '))
  try {
    const { state, command } = await installed(root)
    // An older installer only wrote the version directory; the stable entry
    // point is preferred because its directory also holds the npm script the
    // release install needs.
    await place(join(state, 'runtime/node/node-v24.9.0-test/bin/node'), runtime('v24.9.0-version-dir'))
    await place(join(state, 'runtime/node/bin/node'), runtime('v24.9.0-stable'))
    await writeFile(join(state, 'runtime/node/CURRENT'), 'node-v24.9.0-test\n')
    const result = Bun.spawnSync([command], { stdout: 'pipe', stderr: 'pipe' })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain('runtime v24.9.0-stable')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('the launcher skips a runtime below the DSH floor and falls back to node on PATH', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala launcher stale '))
  try {
    const { state, command } = await installed(root)
    // 22.13 was the old floor; DeepSeek Harness needs 24.9, so it must be skipped.
    await place(join(state, 'runtime/node/node-v22.13.0-test/bin/node'), runtime('v22.13.0'))
    await writeFile(join(state, 'runtime/node/CURRENT'), 'node-v22.13.0-test\n')
    const result = Bun.spawnSync([command], { stdout: 'pipe', stderr: 'pipe' })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString().trim()).toBe('running 1.0.0')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('the launcher explains itself when no runtime can be found', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala launcher absent '))
  try {
    const { command } = await installed(root)
    // A PATH with everything the launcher itself uses, but no Node.
    const bin = join(root, 'limited-bin')
    await mkdir(bin, { recursive: true })
    for (const name of ['cat', 'dirname', 'readlink']) await symlink(join('/bin', name), join(bin, name))
    const result = Bun.spawnSync([command], { stdout: 'pipe', stderr: 'pipe', env: { PATH: bin, HOME: root } })
    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain('Hulala needs Node.js 24.9 or newer')
    expect(result.stderr.toString()).toContain('curl -fsSL https://hulala.ai/install.sh | sh')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('the command names its own root, and a 0.2.9 Node command is still recognized', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala launcher marker '))
  try {
    const { state, command } = await installed(root)
    const source = await readFile(command, 'utf8')
    expect(source).toStartWith('#!/bin/sh')
    expect(launcherRoot(source)).toBe(join(state, 'runtime/client'))
    expect(launcherRoot(`#!/usr/bin/env node\n// hulala-launcher {"format":1,"root":"${join(state, 'runtime/client')}"}\n`)).toBe(join(state, 'runtime/client'))
    expect(launcherRoot('// hulala-launcher {"format":1,"root":"relative/path"}\n')).toBeUndefined()
  } finally { await rm(root, { recursive: true, force: true }) }
})
