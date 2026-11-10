import { chmod, mkdir, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import packageJson from '../package.json' with { type: 'json' }

const cliRoot = fileURLToPath(new URL('../', import.meta.url))
const dist = fileURLToPath(new URL('../dist/', import.meta.url))
// The changelog travels inside the bundle: an installed copy has no checkout
// to read it from, and `/changelog` must answer there too.
const changelog = readFileSync(fileURLToPath(new URL('../../../CHANGELOG.md', import.meta.url)), 'utf8')
await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })
await build({ entryPoints: [cliRoot + 'src/npm-entry.ts'], outfile: dist + 'cli.js', bundle: true, platform: 'node', format: 'esm',
  target: 'node22', sourcemap: false, minify: true, banner: { js: '#!/usr/bin/env node' },
  define: {
    __HULALA_VERSION__: JSON.stringify(packageJson.version),
    __HULALA_CHANGELOG__: JSON.stringify(changelog),
  },
})
await chmod(dist + 'cli.js', 0o755)
