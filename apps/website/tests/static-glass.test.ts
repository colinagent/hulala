import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const styles = readFileSync(join(root, 'app', 'globals.css'), 'utf8');
const home = readFileSync(join(root, 'app', 'HomePage.tsx'), 'utf8');
const download = readFileSync(join(root, 'app', 'download', 'DownloadPageClient.tsx'), 'utf8');

test('website Static Glass derives every fill from its declared substrate', () => {
  expect(styles).toMatch(/--sg-substrate:\s*var\(--paper\);/);
  expect(styles).toMatch(/--sg-substrate-ratio:\s*72%;/);
  expect(styles).toMatch(/--sg-accent-ratio:\s*28%;/);
  expect(styles).toMatch(/\.static-glass\s*\{[\s\S]*?--sg-fill:\s*color-mix\([\s\S]*?var\(--sg-substrate\) var\(--sg-substrate-ratio\),[\s\S]*?var\(--sg-accent\) var\(--sg-accent-ratio\)[\s\S]*?background-color:\s*var\(--sg-fill\);/);
  expect(styles).toMatch(/\.closing-section\s*\{[^}]*--sg-substrate:\s*var\(--moss-dark\);[^}]*--sg-substrate-ratio:\s*78%;[^}]*--sg-accent-ratio:\s*22%;/);
  expect(styles).toMatch(/\.download-card\s*\{[^}]*--sg-substrate:\s*var\(--paper-light\);[^}]*background:\s*var\(--sg-substrate\);/);
});

test('website has one static recipe and never dynamically samples the background', () => {
  expect(styles).not.toContain('--sg-frost');
  expect(styles).not.toContain('.static-glass-dark');
  expect(home).not.toContain('static-glass-dark');
  expect(`${styles}\n${home}\n${download}`).not.toMatch(/backdrop-filter|filter:\s*blur/);
  expect(home.match(/static-glass/g)?.length).toBe(4);
  expect(download.match(/static-glass/g)?.length).toBe(3);
});
