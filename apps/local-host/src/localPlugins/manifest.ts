import { z } from 'zod'
import { lstat, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
export const pluginIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)
export const entrySchema = z.string().min(1).max(240).refine(value => !isAbsolute(value) && !value.includes('\\') && !value.split('/').some(p => p === '..' || p === '.' || p === ''), 'entry must be a relative package path')
export const pluginManifestSchema = z.object({
  id: pluginIdSchema, name: z.string().min(1).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
  apiVersion: z.literal(1), description: z.string().max(1000).optional(),
  backend: entrySchema.refine(v => v.endsWith('.js')),
  ui: entrySchema.refine(v => v.endsWith('.js')),
  styles: z.array(entrySchema.refine(v => v.endsWith('.css'))).max(10).optional(),
}).strict().refine(value => value.backend !== value.ui, 'backend and browser UI must be separate built modules')
export async function packageFile(root: string, path: string): Promise<string> {
  entrySchema.parse(path)
  const base = await realpath(root)
  const target = resolve(base, path)
  const diff = relative(base, await realpath(target))
  if (!diff || diff.startsWith('..' + sep) || diff === '..' || isAbsolute(diff)) throw new Error('plugin path escapes its package')
  if (!(await lstat(target)).isFile()) throw new Error('plugin entry must be a file')
  return target
}
/** Installation packages contain built assets only, without links or source maps. */
export async function validatePackage(root: string): Promise<string[]> {
  const files: string[] = []
  let size = 0
  async function visit(path = ''): Promise<void> {
    if (path.split('/').length > 12) throw new Error('plugin package nesting is too deep')
    for (const entry of await readdir(resolve(root, path), { withFileTypes: true })) {
      const name = path ? path + '/' + entry.name : entry.name
      if (entry.isSymbolicLink()) throw new Error('plugin packages cannot contain symbolic links')
      if (entry.isDirectory()) await visit(name)
      else {
        if (!entry.isFile() || !/\.(js|css|json|svg|png|jpg|jpeg|webp|woff2?|txt)$/.test(name)) throw new Error('unsupported plugin asset: ' + name)
        size += (await lstat(resolve(root, name))).size
        files.push(name)
        if (size > 50 * 1024 * 1024 || files.length > 2000) throw new Error('plugin package is too large')
      }
    }
  }
  await visit()
  return files
}
