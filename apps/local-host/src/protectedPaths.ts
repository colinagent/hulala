import { realpath, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { HttpError } from './http'

function contains(parent: string, child: string): boolean {
  const delta = relative(parent, child)
  return delta === '' || (!isAbsolute(delta) && delta !== '..' && !delta.startsWith('..' + sep))
}
async function canonical(path: string): Promise<string> {
  try { return await realpath(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = dirname(path)
    return parent === path ? path : resolve(await canonical(parent), relative(parent, path))
  }
}

/** Provider-owned credentials are never file-editor or resource-download content. */
export class ProtectedPaths {
  constructor(private readonly paths: string[] = [], private readonly additional?: () => Promise<string[]>) {}
  async assert(path: string, recursive = false): Promise<void> {
    const target = await canonical(resolve(path))
    for (const protectedPath of [...this.paths, ...await this.additional?.() || []]) {
      const secret = await canonical(resolve(protectedPath))
      if (contains(secret, target) || (recursive && contains(target, secret))) {
        throw new HttpError(403, 'credential_path_protected', 'Manage credentials and SSH keys in their settings; credential files cannot be opened, copied, or changed through workspace files.')
      }
    }
  }
  async visible(path: string): Promise<boolean> {
    try { await this.assert(path); return true } catch (error) {
      if (error instanceof HttpError && error.code === 'credential_path_protected') return false
      throw error
    }
  }
}

export function providerCredentialPaths(configRoot: string, env: NodeJS.ProcessEnv = process.env, home = homedir()): string[] {
  return [
    join(home, '.ssh'),
    join(configRoot, 'ssh'),
    join(configRoot, 'harness', '.credentials.yaml'),
    join(env.DSH_HOME || join(configRoot, 'harness'), '.credentials.yaml'),
    join(env.PI_CODING_AGENT_DIR || join(home, '.pi', 'agent'), 'auth.json'),
    join(env.CODEX_HOME || join(home, '.codex'), 'auth.json'),
    join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), '.credentials.json'),
  ]
}

export async function selectedSshIdentityPaths(configRoot: string): Promise<string[]> {
  try {
    const data = JSON.parse(await readFile(join(configRoot, 'ssh/selected-identities.json'), 'utf8')) as unknown
    if (!Array.isArray(data) || data.some(path => typeof path !== 'string' || !isAbsolute(path))) throw new Error('Invalid SSH identity protection configuration')
    return data
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}
