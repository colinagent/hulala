import { chmod, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import packageJson from '../package.json' with { type: 'json' }

const cliRoot = fileURLToPath(new URL('../', import.meta.url))
const dist = fileURLToPath(new URL('../dist/', import.meta.url))
await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
await build({ entryPoints: [cliRoot + 'src/npm-entry.ts'], outfile: dist + 'cli.js', bundle: true, platform: 'node', format: 'esm',
  target: 'node18', sourcemap: false, minify: true, banner: { js: '#!/usr/bin/env node' },
  define: { __HULALA_VERSION__: JSON.stringify(packageJson.version) },
})
await chmod(dist + 'cli.js', 0o755)
