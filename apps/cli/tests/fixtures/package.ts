import { chmod, mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { packageFiles, type PackageManifest } from "@hulala/distribution/manifest"

export async function fixture(root: string, version: string) {
  const dir = join(root, 'package-' + version), executable = 'bin/' + (process.platform === 'win32' ? 'hulala.exe' : 'hulala')
  const files = [executable, 'web/index.html', 'web/drawing.html', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'runtime/bin/' + (process.platform === 'win32' ? 'bun.exe' : 'bun'),
    'runtime/runtime/host.js', 'runtime/host/browser.js', 'runtime/host/worker.js', 'runtime/host/remote-entry.js', 'runtime/remote-manifest.json', 'settings/ui.jsonc', 'settings/system.jsonc']
  for (const file of files) { await mkdir(dirname(join(dir, file)), { recursive: true }); await writeFile(join(dir, file), version + ':' + file) }
  await chmod(join(dir, executable), 0o755)
  const manifest: PackageManifest = { format: 1, product: 'hulala', stage: 'workbench', version, target: `${process.platform}-${process.arch}`, protocol: 1, dataFormat: 1, lockSha256: '0'.repeat(64), entrypoint: executable, files: await packageFiles(dir) }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest))
  return dir
}
