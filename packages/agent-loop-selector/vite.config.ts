import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    cors: true,
  },
  build: {
    lib: {
      entry: 'src/client.ts',
      formats: ['es'],
      fileName: () => 'runtime-ui.js',
    },
    outDir: 'lib/client',
    emptyOutDir: true,
    sourcemap: true,
  },
})
