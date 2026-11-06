import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const page = readFileSync(join(root, 'app', 'download', 'DownloadPageClient.tsx'), 'utf8')
const loader = readFileSync(join(root, 'app', 'download', 'release.ts'), 'utf8')
const englishDownload = readFileSync(join(root, 'app', '(en)', 'download', 'page.tsx'), 'utf8')
const chineseDownload = readFileSync(join(root, 'app', '(zh)', 'zh-CN', 'download', 'page.tsx'), 'utf8')
const home = readFileSync(join(root, 'app', 'HomePage.tsx'), 'utf8')
const metadata = readFileSync(join(root, 'app', 'siteMetadata.ts'), 'utf8')
const sitemap = readFileSync(join(root, 'app', 'sitemap.ts'), 'utf8')
const github = readFileSync(join(root, 'app', 'GitHubLink.tsx'), 'utf8')

test('download page uses the isolated Hulala manifest and GitHub fallback', () => {
  expect(loader).toContain('https://downloads.hulala.ai/hulala/desktop/latest/manifest.json')
  // One repository constant feeds the home page, the download page and the fallback.
  expect(github).toContain('https://github.com/colinagent/hulala"')
  expect(github).toContain('`${GITHUB_REPOSITORY}/releases`')
  expect(page).toContain('GITHUB_RELEASES')
  expect(page).not.toContain('github.com/colinagent/hulala')
  expect(home).toContain('isZh ? "/zh-CN/download/" : "/download/"')
  expect(loader).not.toContain('download.op-agent.com/desktop/latest')
})

test('download page gives bilingual unsigned installation guidance', () => {
  for (const text of ['Open Anyway', '仍要打开', 'Run anyway', '仍要运行', 'Smart App Control', 'SHA-256']) expect(page).toContain(text)
  expect(page).toContain('there is no safe per-app bypass')
  expect(page).toContain('没有安全的单应用绕过方式')
  expect(page).toContain('Git for Windows')
  expect(page).toContain('download-important')
  expect(page).toContain('重点提示：当前版本未签名')
})

test('homepage and download page expose indexable English and Chinese routes', () => {
  expect(home).not.toContain('localStorage')
  expect(home).toContain('href="/zh-CN/"')
  expect(page).not.toContain('localStorage')
  expect(page).toContain('href="/zh-CN/download/"')
  expect(englishDownload).toContain('locale="en"')
  expect(chineseDownload).toContain('locale="zh-CN"')
  for (const marker of ['canonical', '"zh-CN"', '"x-default"']) expect(metadata).toContain(marker)
  for (const route of ['/zh-CN/', '/download/', '/zh-CN/download/']) expect(sitemap).toContain(route)
})
