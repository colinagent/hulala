import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', workers: 1, timeout: 60000,
  fullyParallel: false, reporter: [['list']], outputDir: '../../dist/browser-test-results',
  use: { headless: true, viewport: { width: 1280, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }, { name: 'firefox', use: { browserName: 'firefox' } }, { name: 'webkit', use: { browserName: 'webkit' } }],
})
