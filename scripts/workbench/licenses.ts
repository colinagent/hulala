import { createRequire } from 'node:module'
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export async function copyCliLicenses(repository: string, output: string): Promise<void> {
  const root = join(repository, 'apps/cli'), visited = new Set<string>()
  const inventory: Array<{ name: string; version: string; license: string; files: string[] }> = []
  async function visit(name: string, parent: string) {
    if (name.startsWith('@hulala/')) return
    const require = createRequire(join(parent, 'package.json'))
    let directory = dirname(require.resolve(name)), metadata: any
    while (directory !== dirname(directory)) {
      try { const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')); if (pkg.name === name) { metadata = pkg; break } } catch {}
      directory = dirname(directory)
    }
    if (!metadata) throw new Error('Missing license metadata for ' + name)
    const id = metadata.name + '@' + metadata.version
    if (visited.has(id)) return
    visited.add(id)
    const folder = id.replaceAll('/', '_'), files = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && /^(?:licen[sc]e|copying|notice)(?:[.-].*)?$/i.test(entry.name)).map(entry => entry.name)
    if (!files.length) throw new Error('Missing license file for ' + id)
    await mkdir(join(output, folder), { recursive: true })
    for (const file of files) await cp(join(directory, file), join(output, folder, file))
    inventory.push({ name: metadata.name, version: metadata.version, license: typeof metadata.license === 'string' ? metadata.license : 'See included license', files: files.map(file => folder + '/' + file) })
    for (const dependency of Object.keys(metadata.dependencies || {})) await visit(dependency, directory)
  }
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  for (const dependency of Object.keys(metadata.dependencies || {})) await visit(dependency, root)
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'inventory.json'), JSON.stringify(inventory.sort((a, b) => a.name.localeCompare(b.name)), null, 2) + '\n')
}
