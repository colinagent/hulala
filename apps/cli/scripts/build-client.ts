import { chmod, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import packageJson from '../package.json' with { type: 'json' }

const root = join(import.meta.dirname, '..')
const version = process.env.HULALA_TUI_VERSION?.trim() || packageJson.version
const output = join(root, 'dist')
await rm(join(output, 'hulala.mjs'), { force: true })
await mkdir(output, { recursive: true })
const result = await Bun.build({
  entrypoints: [join(root, 'src', 'main.ts')],
  outdir: output,
  naming: 'hulala.mjs',
  target: 'node',
  format: 'esm',
  minify: true,
  sourcemap: 'none',
  banner: '#!/usr/bin/env node',
  define: { __HULALA_VERSION__: JSON.stringify(version) },
})
if (!result.success) throw new AggregateError(result.logs, 'failed to build the TUI executable')
await chmod(join(output, 'hulala.mjs'), 0o755)
console.log(`built TUI ${version}: ${join(output, 'hulala.mjs')}`)
