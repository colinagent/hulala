import { readFile } from 'node:fs/promises'

const allowed = new Set(['HULALA_HOME', 'HULALA_WORKSPACE_ROOT', 'HULALA_PORT', 'HULALA_WORKBENCH_PORT', 'HULALA_REMOTE_PACKAGES', 'PATH'])
/** Native login jobs load only non-secret launch settings before CLI modules. */
export async function applyAutostartEnvironment(args: string[]): Promise<string[]> {
  if (args[0] !== '__autostart') return args
  if (args.length !== 2) throw new Error('Invalid login job invocation')
  const value = JSON.parse(await readFile(args[1]!, 'utf8'))
  if (value.format !== 1 || value.product !== 'hulala-autostart' || !value.environment || typeof value.environment !== 'object') throw new Error('Invalid login job settings')
  for (const [key, item] of Object.entries(value.environment)) {
    if (!allowed.has(key) || typeof item !== 'string' || item.length > 32768 || item.includes('\0')) throw new Error('Invalid login job environment')
  }
  for (const [key, item] of Object.entries(value.environment)) process.env[key] = item as string
  return ['--foreground', '--no-open']
}
