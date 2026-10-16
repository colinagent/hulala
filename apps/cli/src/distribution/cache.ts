import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { verifyPackage } from '@hulala/distribution/manifest'
import { releaseTarget } from '@hulala/distribution/targets'

/** npx may delete its download cache while a detached Host is still running.
 * Execute the same verified immutable package from Hulala-owned runtime storage. */
export async function stablePackage(source: string, stateRoot: string, expectedVersion: string): Promise<string> {
  const metadata = await readFile(join(source, 'manifest.json'))
  const identity = createHash('sha256').update(metadata).digest('hex')
  const target = releaseTarget()
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(expectedVersion)) throw new Error('Invalid package version')
  const cache = join(stateRoot, 'runtime', 'distributions')
  const destination = join(cache, expectedVersion + '-' + target + '-' + identity.slice(0, 24))
  const check = async (directory: string) => {
    const manifest = await verifyPackage(directory)
    if (manifest.stage !== 'workbench' || manifest.version !== expectedVersion || manifest.target !== target) throw new Error('The platform package does not match this Hulala installation')
    if (createHash('sha256').update(await readFile(join(directory, 'manifest.json'))).digest('hex') !== identity) throw new Error('Cached platform package identity mismatch')
  }
  try { await readFile(join(destination, 'manifest.json')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await check(source)
    await mkdir(cache, { recursive: true, mode: 0o700 })
    const staging = await mkdtemp(join(cache, '.staging-'))
    try {
      await cp(source, staging, { recursive: true, dereference: false })
      await check(staging)
      try { await rename(staging, destination) }
      catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', ...(process.platform === 'win32' ? ['EPERM'] : [])].includes((error as NodeJS.ErrnoException).code || '')) throw error
        await check(destination)
      }
    } finally { await rm(staging, { recursive: true, force: true }) }
  }
  await check(destination)
  return destination
}
