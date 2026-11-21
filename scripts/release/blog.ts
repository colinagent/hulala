#!/usr/bin/env bun
/**
 * The release blog gate.
 *
 * The blog is part of a release, not a later nice-to-have: `blog/<version>/` must
 * exist in both languages before the tag, or the tag fails instead of publishing a
 * release whose post appears days afterwards — or never. The same loader the
 * website renders from is the validator here, so a post this accepts is a post the
 * site can build.
 *
 *   bun run check:blog                     # structure and parity of every post
 *   bun run check:blog --version 0.3.31    # this release has a post (the tag gate)
 *
 * `BLOG_VERSION` is the environment equivalent of `--version`, for a workflow step
 * that would rather not pass arguments.
 *
 * @module hulala/release/blog
 */
import { join, resolve } from 'node:path'
import { compareVersions, loadPosts } from '../../apps/website/app/blog/posts.ts'

const root = resolve(import.meta.dirname, '../..')

/**
 * The shortest a post may be and still be a post.
 *
 * The point is not a word count; it is that "explain what this is worth, why it
 * is built this way and what it is for" cannot be done in a paragraph that repeats
 * the changelog bullet. A stub fails here rather than shipping as a heading.
 */
const MINIMUM_BODY = 600

/** One flag's value, or undefined when the flag is absent. */
function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

/** Read, validate and report. */
async function main(): Promise<void> {
  const version = option('--version') ?? (process.env.BLOG_VERSION || undefined)
  const posts = await loadPosts({ root: join(root, 'blog') })
  const stubs = posts.flatMap(post =>
    (['en', 'zh-CN'] as const)
      .filter(locale => post.text[locale].body.length < MINIMUM_BODY)
      .map(locale => `blog/${post.version}/${locale}.md`),
  )
  if (stubs.length > 0) {
    throw new Error(`a post must say something (under ${MINIMUM_BODY} characters): ${stubs.join(', ')}`)
  }
  if (version === undefined) {
    const versions = posts.map(post => post.version)
    console.log(`Blog gate: ok (${posts.length} post${posts.length === 1 ? '' : 's'}${versions.length > 0 ? `: ${versions.join(', ')}` : ''})`)
    return
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`--version "${version}" is not x.y.z`)
  if (!posts.some(post => post.version === version)) {
    throw new Error(
      `this release has no blog post: write blog/${version}/en.md and blog/${version}/zh-CN.md ` +
        'explaining what the release is worth, why it is built this way and what it is for',
    )
  }
  const ahead = posts.filter(post => compareVersions(post.version, version) > 0).map(post => post.version)
  if (ahead.length > 0) console.log(`Blog gate: warning: posts newer than ${version} exist (${ahead.join(', ')})`)
  console.log(`Blog gate: ok (${version})`)
}

await main().catch((error: unknown) => {
  console.error(`Blog gate: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
