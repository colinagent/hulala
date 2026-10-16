import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { packageFiles, safePackagePath, verifyPackage, type PackageManifest } from './package-manifest'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture(): Promise<{ root: string; manifest: PackageManifest }> {
  const root = await mkdtemp(join(tmpdir(), 'hulala-package-'))
  roots.push(root)
  for (const directory of ['bin', 'web']) await mkdir(join(root, directory))
  for (const file of ['bin/hulala', 'web/index.html', 'web/drawing.html', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) await writeFile(join(root, file), file)
  const manifest: PackageManifest = { format: 1, product: 'hulala', stage: 'foundation', version: '0.1.4', target: 'darwin-arm64', entrypoint: 'bin/hulala', files: await packageFiles(root) }
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))
  return { root, manifest }
}
test('verifies all files in a relocated self-contained package', async () => {
  const { root, manifest } = await fixture()
  expect(await verifyPackage(root)).toEqual(manifest)
})
test('rejects tampered and unlisted package resources', async () => {
  const { root } = await fixture()
  await writeFile(join(root, 'web/index.html'), 'changed')
  await expect(verifyPackage(root)).rejects.toThrow('Integrity mismatch')
  await writeFile(join(root, 'unexpected'), 'extra')
  await expect(verifyPackage(root)).rejects.toThrow('Unexpected')
})
test('rejects traversal, absolute paths, duplicate files, and missing entrypoints', async () => {
  for (const path of ['../key', '/etc/passwd', 'C:/key', 'web\\key', 'web//key', 'web/./key', 'web/../key', 'x\u0000']) expect(safePackagePath(path)).toBe(false)
  const { root, manifest } = await fixture()
  manifest.files.push(manifest.files[0]!)
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))
  await expect(verifyPackage(root)).rejects.toThrow('Invalid package file')
  manifest.files.pop()
  manifest.entrypoint = 'bin/missing'
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))
  await expect(verifyPackage(root)).rejects.toThrow('missing bin/missing')
})
test('does not follow symlinks, including a symlinked manifest', async () => {
  const { root } = await fixture()
  await symlink(join(root, 'LICENSE'), join(root, 'web/link'))
  await expect(verifyPackage(root)).rejects.toThrow('symlinks')
  await rm(join(root, 'web/link'))
  await rm(join(root, 'manifest.json'))
  await symlink(join(root, 'LICENSE'), join(root, 'manifest.json'))
  await expect(verifyPackage(root)).rejects.toThrow('Manifest may not')
})
