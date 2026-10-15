import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { SshHost } from '@hulala/workbench-contracts/ssh'
import { HttpError } from '../http'

function words(value: string): string[] { return [...value.matchAll(/"([^"]*)"|'([^']*)'|([^\s#]+)/g)].map(match => match[1] ?? match[2] ?? match[3]!) }
function hostId(filename: string, alias: string): string {
  const hex = createHash('sha256').update(filename + '\0' + alias).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** Let OpenSSH resolve precedence and Match rules. Enumeration only supplies
 * concrete aliases from Host/Include entries; no configuration is rewritten. */
export async function readSshConfig(filename: string, home: string, executable = 'ssh'): Promise<SshHost[]> {
  const aliases = new Set<string>(), visited = new Set<string>()
  async function visit(path: string): Promise<void> {
    const canonical = await realpath(path).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error })
    if (!canonical || visited.has(canonical)) return
    if (visited.size >= 64) throw new HttpError(413, 'ssh_config_limit', 'SSH configuration includes too many files')
    visited.add(canonical)
    if ((await stat(canonical)).size > 1024 * 1024) throw new HttpError(413, 'ssh_config_limit', 'SSH configuration is too large')
    for (const line of (await readFile(canonical, 'utf8')).split(/\r?\n/)) {
      const match = line.trim().match(/^(Host|Include)\s+(.+)$/i)
      if (!match) continue
      for (const value of words(match[2]!)) {
        if (match[1]!.toLowerCase() === 'host') { if (!/[!*?\x00-\x20]/.test(value) && !value.startsWith('-')) aliases.add(value); continue }
        const expanded = value.startsWith('~/') ? join(home, value.slice(2)) : isAbsolute(value) ? value : resolve(dirname(filename), value)
        for await (const included of new Bun.Glob(expanded).scan({ absolute: true, onlyFiles: true })) await visit(included)
      }
    }
  }
  await visit(filename)
  const result: SshHost[] = []
  for (const alias of [...aliases].slice(0, 200)) {
    const child = Bun.spawn([executable, '-F', filename, '-G', alias], { stdout: 'pipe', stderr: 'pipe', timeout: 5000 })
    const [output, _error, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    if (code !== 0) throw new HttpError(400, 'ssh_config_invalid', 'OpenSSH could not resolve the SSH configuration')
    const entries = output.split(/\r?\n/).map(line => line.split(/\s(.+)/, 2))
    const field = (name: string) => entries.find(([key]) => key === name)?.[1]
    // An explicit proxy command is executable user configuration. SSH2 cannot
    // interpret it; leave its alias visible and report the constraint on connect.
    let identity: string | undefined
    for (const [, value] of entries.filter(([key]) => key === 'identityfile')) {
      if (!value || value === 'none') continue
      const candidate = value.startsWith('~/') ? join(home, value.slice(2)) : value
      if ((await stat(candidate).catch(() => null))?.isFile()) { identity = candidate; break }
    }
    result.push({ id: hostId(filename, alias), alias, hostname: field('hostname') || alias, user: field('user') || '',
      port: Number(field('port') || 22), authMethod: 'agent', source: 'config', ...(identity ? { identityFile: identity } : {}),
      ...(field('proxycommand') && field('proxycommand') !== 'none' || field('proxyjump') && field('proxyjump') !== 'none' ? { proxyConfigured: true } : {}),
    })
  }
  return result
}
