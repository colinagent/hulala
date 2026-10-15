import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import { fileURLToPath } from 'node:url'
import { excalidrawAssets } from './build/excalidrawAssets'
import { pdfAssets } from './build/pdfAssets'

export default defineConfig({
  plugins: [react(), excalidrawAssets(), pdfAssets()],
  base: '/',
  resolve: { dedupe: ['react', 'react-dom'] },
  css: { postcss: { plugins: [tailwind(), autoprefixer()] } },
  build: {
    outDir: process.env.HULALA_WEB_OUTPUT || 'dist',
    sourcemap: false,
    rollupOptions: { input: {
      main: fileURLToPath(new URL('./index.html', import.meta.url)),
      drawing: fileURLToPath(new URL('./drawing.html', import.meta.url)),
    } },
  },
  server: { host: '127.0.0.1', port: 5175, strictPort: true, allowedHosts: ['hulala.localhost'] },
})
