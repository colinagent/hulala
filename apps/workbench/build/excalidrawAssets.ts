import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Plugin } from 'vite';

export function excalidrawAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const root = join(dirname(require.resolve('@excalidraw/excalidraw')), 'fonts');
  return {
    name: 'hulala-excalidraw-fonts',
    configureServer(server) {
      server.middlewares.use('/excalidraw/fonts', async (req, res, next) => {
        try {
          const path = resolve(root, `.${decodeURIComponent((req.url || '/').split('?')[0])}`);
          if (!path.startsWith(`${root}${sep}`) || !path.endsWith('.woff2')) return next();
          res.setHeader('Content-Type', 'font/woff2');
          res.end(await readFile(path));
        } catch { next(); }
      });
    },
    async generateBundle() {
      const visit = async (dir: string): Promise<void> => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name);
          if (entry.isDirectory()) await visit(path);
          else if (/\.woff2$|license|ofl/i.test(entry.name)) {
            this.emitFile({ type: 'asset', fileName: `excalidraw/fonts/${relative(root, path).split(sep).join('/')}`, source: await readFile(path) });
          }
        }
      };
      await visit(root);
    },
  };
}
