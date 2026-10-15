import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { builtinModules } from 'node:module'
import { homedir } from 'node:os'

const root = join(import.meta.dir, '../..')
const roots = ['apps/workbench', 'apps/local-host', 'packages/workbench-contracts', 'packages/plugin-sdk', 'packages/distribution']
const forbidden: Array<readonly [string, RegExp]> = [
  ['private source import', /(?:from\s*|import\s*\()['"][^'"]*-dev\//],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['credential', /\b(?:sk-[A-Za-z0-9]{24,}|gh[pousr]_[A-Za-z0-9]{30,})\b/],
  ['Electron dependency', /(?:from\s*|import\s*\()['"]electron(?:[-/][^'"]*)?['"]/],
]
const home = homedir().replace(/\\+/g, '/')
if (!['/root', '/home/runner'].includes(home)) forbidden.push(['machine home path', new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')])
// A maintainer can supply organization-specific names from a private file;
// those identifiers do not need to be committed into the public checker.
if (process.env.HULALA_BOUNDARY_PATTERNS) {
  try {
    const values: unknown = JSON.parse(await readFile(process.env.HULALA_BOUNDARY_PATTERNS, 'utf8'))
    if (!Array.isArray(values)) throw new Error()
    for (const value of values) {
      if (!value || typeof value.label !== 'string' || typeof value.pattern !== 'string') throw new Error()
      forbidden.push([value.label, new RegExp(value.pattern, 'i')])
    }
  } catch { throw new Error('Invalid private boundary-pattern configuration') }
}
const failures: string[] = []
async function visit(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist'].includes(entry.name)) continue
    const file = join(directory, entry.name)
    const display = relative(root, file)
    if (entry.isSymbolicLink()) { failures.push(`${display}: source symlink`); continue }
    if (entry.isDirectory()) { await visit(file); continue }
    if (!/\.(?:tsx?|jsonc?|html|css|md)$/.test(file)) continue
    const source = await readFile(file, 'utf8')
    for (const [label, pattern] of forbidden) if (pattern.test(source)) failures.push(`${display}: ${label}`)
    if (file.endsWith('/package.json')) {
      const pkg = JSON.parse(source)
      if (pkg.license !== 'Apache-2.0' || pkg.private !== true) failures.push(`${display}: package license/publication boundary`)
      for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
        if (name.startsWith('electron')) failures.push(`${display}: Electron package`)
      }
    }
    if (display.startsWith('apps/workbench/src/') && /\.tsx?$/.test(display) && !/\.test\./.test(display)) {
      const transpiler = new Bun.Transpiler({ loader: file.endsWith('.tsx') ? 'tsx' : 'ts' })
      for (const { path: specifier } of transpiler.scanImports(source)) {
        if (specifier && (specifier.startsWith('node:') || builtinModules.includes(specifier))) failures.push(`${display}: browser imports a Node capability`)
      }
    }
  }
}
for (const directory of roots) await visit(join(root, directory))
if (failures.length) throw new Error(failures.join('\n'))
console.log('Workbench source boundary: passed (automated checks; manual review is still required).')
