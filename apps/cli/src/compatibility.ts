import { createRequire } from 'node:module'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const LOOPBACK_NEEDLE = 'if (hostname === "localhost" || hostname === "[::1]") return true;'
const LOOPBACK_REPLACEMENT = 'if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "[::1]") return true;'

export function patchLoopbackSource(source: string): string {
  if (source.includes(LOOPBACK_REPLACEMENT)) return source
  if (!source.includes(LOOPBACK_NEEDLE)) {
    throw new Error('The installed DeepSeek Harness loopback check is not compatible with this LoopWithAI release.')
  }
  return source.replaceAll(LOOPBACK_NEEDLE, LOOPBACK_REPLACEMENT)
}

async function patchFile(path: string): Promise<void> {
  const source = await readFile(path, 'utf8')
  const patched = patchLoopbackSource(source)
  if (patched === source) return
  const temporary = `${path}.loopwithai-${process.pid}`
  await writeFile(temporary, patched, 'utf8')
  await rename(temporary, path)
}

/**
 * DeepSeek Harness rc.6 predates RFC 6761 subdomain handling in its private
 * loopback predicate. Patch the isolated installed dependency only after an
 * exact-version check; never edit DNS, hosts, or global system state.
 */
export async function ensureLocalhostSubdomainCompatibility(): Promise<void> {
  const require = createRequire(import.meta.url)
  const packagePath = require.resolve('@deepseek-ai/dsh-client-connection/package.json')
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as { version?: unknown }
  if (packageJson.version !== '0.1.0-rc.6') {
    throw new Error(`Unsupported @deepseek-ai/dsh-client-connection version: ${String(packageJson.version)}`)
  }
  const root = dirname(packagePath)
  await Promise.all([
    patchFile(join(root, 'lib', 'index.js')),
    patchFile(join(root, 'lib', 'client.js')),
  ])
}
