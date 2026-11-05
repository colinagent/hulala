import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { privateHostBuildPlugins } from './buildPrivacy.ts'

if (!Bun.semver.satisfies(Bun.version, '>=1.4.2')) throw new Error('Harness Host builds require Bun >=1.4.2')

const packageRoot = join(import.meta.dirname, '..')
const outputRoot = join(packageRoot, 'dist')
await mkdir(outputRoot, { recursive: true })

// DeepSeek Harness 0.2.2 boots profiles through Node's internal module loader,
// so the Host is a Node program: Bundle first-party code and keep every package
// external, because the resolved package closure carries Node-only addons.
const result = await Bun.build({
  entrypoints: [join(packageRoot, 'src', 'main.ts')],
  outdir: outputRoot,
  naming: 'hulala-desktop-server.mjs',
  target: 'node',
  format: 'esm',
  // First-party workspace code is bundled (Node ESM cannot resolve its
  // extensionless imports); published packages stay external with their addons.
  external: ['@deepseek-ai/*', 'zod', 'ws', 'undici', 'koffi', 'sharp', 'miniflare'],
  minify: true,
  sourcemap: 'none',
  plugins: privateHostBuildPlugins(),
})
if (!result.success) throw new AggregateError(result.logs, 'failed to build private Hulala Host')
