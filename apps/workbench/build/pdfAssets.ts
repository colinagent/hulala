import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'

export function pdfAssets(): Plugin {
  const require = createRequire(import.meta.url)
  const root = dirname(require.resolve('pdfjs-dist/package.json'))
  const groups = new Set(['cmaps', 'standard_fonts', 'wasm'])
  return {
    name: 'hulala-pdf-reader-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', async (request, response, next) => {
        try {
          const path = resolve(root, '.' + decodeURIComponent((request.url || '/').split('?')[0]!))
          const local = relative(root, path)
          if (!groups.has(local.split(sep)[0]!) || !path.startsWith(root + sep)) return next()
          response.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream')
          response.end(await readFile(path))
        } catch { next() }
      })
    },
    async generateBundle() {
      for (const group of groups) for (const entry of await readdir(join(root, group), { withFileTypes: true })) {
        if (!entry.isFile() || !/\.(bcmap|ttf|otf|pfb|wasm)$|license/i.test(entry.name)) continue
        this.emitFile({ type: 'asset', fileName: `pdfjs/${group}/${entry.name}`, source: await readFile(join(root, group, entry.name)) })
      }
    },
  }
}
