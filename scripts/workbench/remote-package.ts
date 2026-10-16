import { createRequire } from 'node:module'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { packageFiles } from './package-manifest'
import { targetFromBun } from '@hulala/distribution/targets'

const root = join(import.meta.dir, '../..')
const require = createRequire(import.meta.url)
export async function prepareRemotePackage(runtime: string, browserHost = false): Promise<void> {
  if (!await Bun.file(join(runtime, 'runtime/host.js')).exists()) throw new Error('A completed public portable Runtime is required')
  if (await Bun.file(join(runtime, 'manifest.json')).exists()) {
    await cp(join(runtime, 'manifest.json'), join(runtime, 'runtime-manifest.json'))
    await rm(join(runtime, 'manifest.json'))
  }
  const metadata = JSON.parse(await readFile(join(runtime, 'runtime-manifest.json'), 'utf8')) as { version: string; target: string }
  const host = JSON.parse(await readFile(join(root, 'apps/local-host/package.json'), 'utf8')) as { dependencies: Record<string, string> }
  for (const name of Object.keys(host.dependencies).filter(name => !name.startsWith('@hulala/'))) {
    if (!await Bun.file(join(runtime, 'node_modules', name, 'package.json')).exists()) throw new Error(`Portable Runtime is missing ${name}; build with HULALA_PORTABLE_WORKBENCH=1`)
  }
  await mkdir(join(runtime, 'host'), { recursive: true })
  const entries = [['main.ts', 'worker.js'], ['ssh/remote-entry.ts', 'remote-entry.js'], ...(browserHost ? [['browser-main.ts', 'browser.js']] : [])]
  for (const [entry, output] of entries) {
    const built = await Bun.build({ entrypoints: [join(root, 'apps/local-host/src', entry!)], target: 'bun', packages: 'external', minify: true, sourcemap: 'none',
      plugins: [{ name: 'public-workbench-contracts', setup(build) {
        build.onResolve({ filter: /^@hulala\/(?:workbench-contracts|plugin-sdk|distribution)(?:\/|$)/ }, ({ path }) => ({ path: require.resolve(path), external: false }))
      } }],
    })
    if (!built.success || !built.outputs[0]) throw new AggregateError(built.logs, 'Could not build public Host')
    const source = await built.outputs[0].text()
    if (source.includes(root)) throw new Error('Host contains a build-machine path')
    await writeFile(join(runtime, 'host', output!), source)
  }
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await cp(join(root, file), join(runtime, file))
  await rm(join(runtime, 'node_modules/.bin'), { recursive: true, force: true })
  const files = (await packageFiles(runtime)).filter(entry => entry.path !== 'remote-manifest.json')
  await writeFile(join(runtime, 'remote-manifest.json'), JSON.stringify({ format: 1, product: 'hulala-remote-host', version: metadata.version,
    target: targetFromBun(metadata.target), files,
  }, null, 2) + '\n')
}
if (import.meta.main) {
  if (!process.argv[2]) throw new Error('Pass a completed public portable Runtime directory')
  const runtime = resolve(process.argv[2])
  await prepareRemotePackage(runtime)
  console.log(JSON.stringify({ directory: runtime, remoteHost: true }))
}
