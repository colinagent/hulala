import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { BunPlugin } from 'bun'

const PACKAGE_VERSION_READ = /const \{ version \} = createRequire\(import\.meta\.url\)\((['"])\.\.\/package\.json\1\);/gu

/**
 * Bun compile materializes `import.meta.url` as the build machine's absolute
 * source path. The upstream LLM attribution module reads its adjacent package
 * version that way, so replace only that reviewed read with the exact installed
 * package version before bundling. Failing to find exactly one occurrence stops
 * the build instead of baking a developer's home directory into the artifact.
 */
export function privateHostBuildPlugins(): BunPlugin[] {
  return [{
    name: 'hulala-private-build-path-sanitizer',
    setup(build) {
      build.onLoad({ filter: /[\\/]@deepseek-ai[\\/]dsh-llm[\\/]lib[\\/]index\.js$/u }, async ({ path }) => {
        const source = await readFile(path, 'utf8')
        const matches = [...source.matchAll(PACKAGE_VERSION_READ)]
        if (matches.length !== 1) {
          throw new Error(`expected one dsh-llm package version read, found ${matches.length}`)
        }
        const packageRoot = dirname(dirname(path))
        const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as { version?: unknown }
        if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
          throw new Error('installed dsh-llm package has no version')
        }
        return {
          contents: source.replace(PACKAGE_VERSION_READ, `const version = ${JSON.stringify(manifest.version)};`),
          loader: 'js',
        }
      })
      build.onLoad({ filter: /[\\/]@deepseek-ai[\\/]cordis-plugin-loader[\\/]lib[\\/]index\.js$/u }, async ({ path }) => {
        const source = await readFile(path, 'utf8')
        const pattern = /createRequire\(import\.meta\.url\)/gu
        const matches = [...source.matchAll(pattern)]
        if (matches.length !== 1) {
          throw new Error(`expected one Cordis Loader createRequire(import.meta.url), found ${matches.length}`)
        }
        return {
          contents: source.replace(pattern, 'createRequire(process.execPath)'),
          loader: 'js',
        }
      })
    },
  }]
}
