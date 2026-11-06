import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const github = readFileSync(join(root, 'app', 'GitHubLink.tsx'), 'utf8')
const home = readFileSync(join(root, 'app', 'HomePage.tsx'), 'utf8')
const download = readFileSync(join(root, 'app', 'download', 'DownloadPageClient.tsx'), 'utf8')
const styles = readFileSync(join(root, 'app', 'globals.css'), 'utf8')

test('the public repository is visible and clickable from every page', () => {
  expect(github).toContain('export const GITHUB_REPOSITORY = "https://github.com/colinagent/hulala"')
  expect(github).toContain('target="_blank"')
  expect(github).toContain('rel="noreferrer"')
  // The header pill, the closing block and the footer on the home page.
  expect(home.match(/GITHUB_REPOSITORY|GitHubLink/g)?.length).toBeGreaterThanOrEqual(3)
  expect(home).toContain('<GitHubLink ')
  expect(home).toContain('className="closing-github"')
  // The download page reuses the same pill instead of its own copy of the URL.
  expect(download).toContain('<GitHubLink ')
  expect(download).not.toContain('github.com/colinagent')
})

test('the document never smooth-scrolls user input', () => {
  // A global `scroll-behavior: smooth` re-animates every offset change, which
  // makes trackpad momentum and scrollbar drags shudder back and forth.
  expect(styles).not.toMatch(/(^|[\s,}])html\s*\{[^}]*scroll-behavior\s*:\s*smooth/)
  expect(styles).not.toContain('scroll-snap-type')
})
