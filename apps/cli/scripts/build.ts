import { chmod, copyFile, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const cliRoot = fileURLToPath(new URL('../', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const external = ['@anthropic-ai/*', '@deepseek-ai/*', '@earendil-works/*', 'undici']

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

const packageJson = await import('../package.json', { with: { type: 'json' } })
await build({
  entryPoints: [`${cliRoot}src/main.ts`],
  outfile: `${dist}cli.js`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
  define: { __HULALA_VERSION__: JSON.stringify(packageJson.default.version) },
  external,
})
await chmod(`${dist}cli.js`, 0o755)

const plugins = {
  'network-proxy': 'packages/network-proxy/src/index.ts',
  'agent-loop-selector': 'packages/agent-loop-selector/src/index.ts',
  'agent-loop-pi': 'packages/agent-loop-pi/src/index.ts',
  'agent-loop-codex': 'packages/agent-loop-codex/src/index.ts',
  'agent-loop-claude': 'packages/agent-loop-claude/src/index.ts',
}

await Promise.all(Object.entries(plugins).map(async ([name, source]) => {
  const outdir = `${dist}plugins/${name}/`
  await mkdir(outdir, { recursive: true })
  await build({
    entryPoints: [`${repositoryRoot}${source}`],
    outfile: `${outdir}index.js`,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    sourcemap: true,
    external,
  })
}))

await mkdir(`${dist}plugins/agent-loop-selector/client`, { recursive: true })
await copyFile(
  `${repositoryRoot}packages/agent-loop-selector/lib/client/runtime-ui.js`,
  `${dist}plugins/agent-loop-selector/client/runtime-ui.js`,
)
await copyFile(`${repositoryRoot}LICENSE`, `${dist}LICENSE`)
await copyFile(`${repositoryRoot}THIRD_PARTY_NOTICES.md`, `${dist}THIRD_PARTY_NOTICES.md`)
