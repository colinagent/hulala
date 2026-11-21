import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderMarkdown } from '../app/blog/markdown'
import { blogRoot, compareVersions, formatPostDate, loadPosts, parsePost } from '../app/blog/posts'
import { blogStructuredData, jsonLdHtml } from '../app/blog/structuredData'
import sitemap from '../app/sitemap'

const temporary: string[] = []

/** A blog directory in the OS temp dir, never in the repository or the home dir. */
async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'hulala-blog-'))
  temporary.push(root)
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path)
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, content)
  }
  return root
}

/** One complete post in one language, with every frontmatter key a post needs. */
function post(locale: 'en' | 'zh-CN', overrides: { slug?: string; version?: string } = {}): string {
  return [
    '---',
    `slug: ${overrides.slug ?? 'a-release'}`,
    `title: The release, in ${locale}`,
    'description: One sentence about the release.',
    'date: 2026-11-21',
    `version: ${overrides.version ?? '0.3.31'}`,
    '---',
    '',
    '## What it is worth',
    '',
    'A body long enough to be a paragraph, with `code` and **bold** text.',
    '',
  ].join('\n')
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

test('the repository blog has paired posts and a readable root', async () => {
  const posts = await loadPosts()
  expect(posts.length).toBeGreaterThan(0)
  for (const entry of posts) {
    expect(entry.text.en.title).not.toBe(entry.text['zh-CN'].title)
    expect(entry.text.en.body.length).toBeGreaterThan(0)
    expect(entry.text['zh-CN'].body.length).toBeGreaterThan(0)
  }
  expect(new Set(posts.map(entry => entry.slug)).size).toBe(posts.length)
  expect(blogRoot().split('/').pop()).toBe('blog')
})

test('posts are returned newest first, and versions compare numerically', async () => {
  const root = await fixture({
    'README.md': '# blog',
    '0.3.9/en.md': post('en', { slug: 'older', version: '0.3.9' }),
    '0.3.9/zh-CN.md': post('zh-CN', { slug: 'older', version: '0.3.9' }),
    '0.3.10/en.md': post('en', { slug: 'newer', version: '0.3.10' }),
    '0.3.10/zh-CN.md': post('zh-CN', { slug: 'newer', version: '0.3.10' }),
  })
  const posts = await loadPosts({ root })
  expect(posts.map(entry => entry.version)).toEqual(['0.3.10', '0.3.9'])
  expect(compareVersions('0.3.10', '0.3.9')).toBeGreaterThan(0)
})

test('a post without its other language fails instead of rendering half a pair', async () => {
  const root = await fixture({ 'README.md': '# blog', '0.3.31/en.md': post('en') })
  await expect(loadPosts({ root })).rejects.toThrow(/every post needs both locales/)
})

test('the two languages must describe the same post', async () => {
  const root = await fixture({
    'README.md': '# blog',
    '0.3.31/en.md': post('en'),
    '0.3.31/zh-CN.md': post('zh-CN', { slug: 'another-release' }),
  })
  await expect(loadPosts({ root })).rejects.toThrow(/disagrees with the other locale/)
})

test('the frontmatter version must match the folder', async () => {
  const root = await fixture({
    'README.md': '# blog',
    '0.3.31/en.md': post('en', { version: '0.3.30' }),
    '0.3.31/zh-CN.md': post('zh-CN', { version: '0.3.30' }),
  })
  await expect(loadPosts({ root })).rejects.toThrow(/does not match its folder/)
})

test('a misspelled frontmatter key fails the build instead of dropping the field', () => {
  expect(() => parsePost('x.md', '---\ntitel: no\n---\n\nbody')).toThrow(/unknown frontmatter key "titel"/)
})

test('markdown renders the subset a post may use', () => {
  const html = renderToStaticMarkup(
    renderMarkdown(
      [
        '## The window',
        '',
        'A paragraph with **bold**, `code` and a [link](https://hulala.ai/).',
        '',
        '- one',
        '- two',
        '',
        '1. first',
        '',
        '> quoted',
        '',
        '```sh',
        'hulala update',
        '```',
      ].join('\n'),
    ),
  )
  expect(html).toContain('<h2 id="the-window">The window</h2>')
  expect(html).toContain('<strong>bold</strong>')
  expect(renderToStaticMarkup(renderMarkdown('an *emphasised* word'))).toContain('<em>emphasised</em>')
  expect(html).toContain('<code>code</code>')
  expect(html).toContain('<a href="https://hulala.ai/" rel="noreferrer" target="_blank">link</a>')
  expect(html).toContain('<ul><li>one</li><li>two</li></ul>')
  expect(html).toContain('<ol><li>first</li></ol>')
  expect(html).toContain('<blockquote>')
  expect(html).toContain('<pre data-language="sh"><code>hulala update</code></pre>')
})

test('a link scheme that is not http(s) or site-relative stays text', () => {
  const html = renderToStaticMarkup(renderMarkdown('[click](javascript:alert(1))'))
  expect(html).not.toContain('<a')
  expect(html).toContain('click')
})

test('a body starts at level 2, and an unclosed fence fails the build', () => {
  expect(() => renderMarkdown('# not a title')).toThrow(/frontmatter title is the h1/)
  expect(() => renderMarkdown('```sh\nhulala update')).toThrow(/never closes/)
})

test('dates are formatted from the string, not the build machine locale', () => {
  expect(formatPostDate('en', '2026-11-21')).toBe('21 November 2026')
  expect(formatPostDate('zh-CN', '2026-11-21')).toBe('2026 年 11 月 21 日')
})

test('the sitemap carries both languages of the index and of every post', async () => {
  const entries = await sitemap()
  for (const path of ['https://hulala.ai/blog/', 'https://hulala.ai/zh-CN/blog/']) {
    const entry = entries.find(item => item.url === path)
    expect(entry?.alternates?.languages?.en).toBe('https://hulala.ai/blog/')
    expect(entry?.alternates?.languages?.['zh-CN']).toBe('https://hulala.ai/zh-CN/blog/')
  }
  for (const post of await loadPosts()) {
    for (const path of [`https://hulala.ai/blog/${post.slug}/`, `https://hulala.ai/zh-CN/blog/${post.slug}/`]) {
      expect(entries.some(item => item.url === path)).toBe(true)
    }
  }
})
