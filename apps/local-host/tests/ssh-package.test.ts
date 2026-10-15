import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { remoteCommand, verifyRemotePackage } from '../src/ssh/package'

test('remote package verification rejects traversal, replacement, unlisted files and symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hulala-remote-integrity-'))
  try {
    const names = ['host/worker.js', 'host/remote-entry.js', 'runtime/host.js', 'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'bin/bun']
    const bytes = Buffer.from('synthetic package fixture')
    for (const name of names) { await mkdir(dirname(join(root, name)), { recursive: true }); await writeFile(join(root, name), bytes) }
    const files = names.map(path => ({ path, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }))
    const manifest = { format: 1, product: 'hulala-remote-host', version: '0.1.4', target: 'darwin-arm64', files }
    const save = (value: unknown) => writeFile(join(root, 'remote-manifest.json'), JSON.stringify(value))
    await save(manifest)
    const verified = await verifyRemotePackage(root)
    await expect(verifyRemotePackage(root, '0'.repeat(64))).rejects.toThrow('manifest integrity')
    await writeFile(join(root, 'host/worker.js'), 'tampered')
    await expect(verifyRemotePackage(root, verified.hash)).rejects.toThrow('size mismatch')
    await writeFile(join(root, 'host/worker.js'), bytes)
    await writeFile(join(root, 'unexpected.txt'), 'unlisted')
    await expect(verifyRemotePackage(root)).rejects.toThrow('unexpected files')
    await rm(join(root, 'unexpected.txt'))
    await save({ ...manifest, files: [...files, { ...files[0], path: '../escape' }] })
    await expect(verifyRemotePackage(root)).rejects.toThrow()
    await save({ ...manifest, files: [...files, files[0]] })
    await expect(verifyRemotePackage(root)).rejects.toThrow('Duplicate')
    await save(manifest)
    await rm(join(root, 'host/worker.js')); await symlink('../LICENSE', join(root, 'host/worker.js'))
    await expect(verifyRemotePackage(root)).rejects.toThrow('symlink')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('remote command quoting preserves untrusted path arguments literally', () => {
  const argument = "space ' $HOME $(printf injected); Unicode 项目"
  const command = remoteCommand(process.platform, process.execPath, '--eval', 'process.stdout.write(process.argv[1])', argument)
  const output = Bun.spawnSync(process.platform === 'win32' ? command.split(' ') : ['/bin/sh', '-c', command])
  expect(output.exitCode).toBe(0)
  expect(output.stdout.toString()).toBe(argument)
  const windows = remoteCommand('win32', "C:/Program Files/O'Brien/bun.exe", argument)
  const script = Buffer.from(windows.split(' ').at(-1)!, 'base64').toString('utf16le')
  expect(script).toContain("O''Brien")
  expect(script).toContain("'space '' $HOME $(printf injected); Unicode 项目'")
  expect(() => remoteCommand('linux', 'newline\ncommand')).toThrow('Invalid')
}, 30000)
