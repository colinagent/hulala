/**
 * The release blog: one bilingual pair of Markdown files per release, read from
 * `<repository>/blog/<version>/{en,zh-CN}.md`.
 *
 * A post belongs to one tag. It is written beside the changelog it explains —
 * the changelog says what changed, the post says what that is worth to the person
 * installing it — and the website renders it at build time. Keeping this module
 * free of React lets the website and `scripts/release/blog.ts` validate exactly
 * the same format: a post that the site cannot render also fails the release
 * gate, and a post that the gate accepts is one the site can render.
 *
 * Frontmatter is a deliberate subset of YAML: `key: value` lines, optionally
 * quoted. The author is this repository, not a plugin, so an unknown key is an
 * error rather than something silently ignored — a typo must not ship a post
 * whose title or description quietly disappeared.
 *
 * @module hulala/website/blog/posts
 */
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { LOCALES, type SiteLocale } from '../i18n'

/** The two languages every post is written in, named as the site names them. */
export const BLOG_LOCALES = LOCALES

/** One of the two languages a post exists in. */
export type BlogLocale = SiteLocale

/** One language of one post, as the loader returns it. */
export interface PostText {
  /** The post's own heading, not the site's. */
  readonly title: string
  /** One sentence: what this release is worth, for cards and `<meta>`. */
  readonly description: string
  /** The Markdown body, without its frontmatter. */
  readonly body: string
}

/** One release post: the facts both languages share, and both bodies. */
export interface BlogPost {
  /** The release it is written for; also its directory name. */
  readonly version: string
  /** The URL segment: `https://hulala.ai/blog/<slug>/`. */
  readonly slug: string
  /** The publication date, `YYYY-MM-DD`. */
  readonly date: string
  /** Both languages, keyed by locale. */
  readonly text: Readonly<Record<BlogLocale, PostText>>
}

/** Where the Markdown lives when nothing overrides it. */
export const BLOG_DIRECTORY_NAME = 'blog'

/** The keys a post's frontmatter may carry, in the order they are documented. */
const FRONTMATTER_KEYS = ['slug', 'title', 'description', 'date', 'version'] as const

/** A version directory name, matching the manifests' own version format. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/
/** A URL segment: lower-case words joined by single dashes. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** An ISO calendar date, which is what `<time datetime>` and the sitemap want. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * The blog root, found without a build-time constant.
 *
 * Two callers read it from different working directories — the website build runs
 * in `apps/website`, the release gate runs at the repository root — and neither
 * may depend on the other's cwd. `HULALA_BLOG_DIR` exists for a test or a staged
 * tree; otherwise the first existing candidate wins, and a missing directory is a
 * named error rather than an empty blog.
 * @returns the absolute path of the directory holding the version folders.
 */
export function blogRoot(): string {
  const override = process.env.HULALA_BLOG_DIR
  if (override !== undefined && override !== '') return resolve(override)
  for (const candidate of [
    join(process.cwd(), BLOG_DIRECTORY_NAME),
    join(process.cwd(), '..', '..', BLOG_DIRECTORY_NAME),
  ]) {
    if (existsSync(join(candidate, 'README.md'))) return resolve(candidate)
  }
  throw new Error(
    `no blog/ directory with a README.md under ${process.cwd()}; ` +
      'set HULALA_BLOG_DIR when the tree lives somewhere else',
  )
}

/** Strip one pair of matching quotes from a frontmatter value. */
function unquote(value: string): string {
  const first = value.at(0)
  if ((first !== '"' && first !== "'") || !value.endsWith(first) || value.length < 2) return value
  return value.slice(1, -1)
}

/**
 * Parse the `---` block at the top of a post.
 *
 * Only the documented keys are accepted, every key appears at most once, and a
 * key that is not one of them fails the build: a post whose frontmatter drifted is
 * a post whose card and `<meta>` would be wrong without anyone noticing.
 * @param file - the path named in the error, so a bad post is findable.
 * @param source - the whole file, frontmatter included.
 * @returns the frontmatter values and the body that follows them.
 */
export function parsePost(file: string, source: string): { values: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (match === null) throw new Error(`${file}: the post must open with a --- frontmatter block`)
  const values: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === '') continue
    const separator = line.indexOf(':')
    if (separator < 1) throw new Error(`${file}: frontmatter line is not "key: value": ${line}`)
    const key = line.slice(0, separator).trim()
    if (!(FRONTMATTER_KEYS as readonly string[]).includes(key)) {
      throw new Error(`${file}: unknown frontmatter key "${key}" (expected ${FRONTMATTER_KEYS.join(', ')})`)
    }
    if (key in values) throw new Error(`${file}: duplicate frontmatter key "${key}"`)
    values[key] = unquote(line.slice(separator + 1).trim())
  }
  const body = source.slice(match[0].length).trim()
  if (body === '') throw new Error(`${file}: the post has no body`)
  return { values, body }
}

/** Prove a date is a real calendar day, not just the right shape. */
function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
}

/**
 * Read one language of one post and check it against the other.
 *
 * The pair is validated as a pair: the two files must describe the same post
 * (same slug, date and version), and both must carry a title and a description,
 * because a card with one language's title over the other language's body is a
 * bug no reader reports.
 * @param directory - the version folder, named in every error.
 * @param version - the folder name, which must match the frontmatter.
 * @returns the post, ready to render in both languages.
 */
async function readPost(directory: string, version: string): Promise<BlogPost> {
  const shared: { slug?: string; date?: string } = {}
  const text: Partial<Record<BlogLocale, PostText>> = {}
  for (const locale of BLOG_LOCALES) {
    const file = join(directory, `${locale}.md`)
    const source = await readFile(file, 'utf8').catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`${file}: every post needs both locales (${BLOG_LOCALES.join(', ')}): ${reason}`)
    })
    const { values, body } = parsePost(file, source)
    for (const key of FRONTMATTER_KEYS) {
      if (values[key] === undefined || values[key] === '') throw new Error(`${file}: frontmatter "${key}" is required`)
    }
    if (!VERSION_PATTERN.test(values.version)) throw new Error(`${file}: version "${values.version}" is not x.y.z`)
    if (values.version !== version) {
      throw new Error(`${file}: version "${values.version}" does not match its folder "${version}"`)
    }
    if (!SLUG_PATTERN.test(values.slug)) {
      throw new Error(`${file}: slug "${values.slug}" must be lower-case words joined by single dashes`)
    }
    if (!isCalendarDate(values.date)) throw new Error(`${file}: date "${values.date}" is not a real YYYY-MM-DD day`)
    if (shared.slug !== undefined && shared.slug !== values.slug) {
      throw new Error(`${file}: slug "${values.slug}" disagrees with the other locale's "${shared.slug}"`)
    }
    if (shared.date !== undefined && shared.date !== values.date) {
      throw new Error(`${file}: date "${values.date}" disagrees with the other locale's "${shared.date}"`)
    }
    shared.slug = values.slug
    shared.date = values.date
    text[locale] = { title: values.title, description: values.description, body }
  }
  return {
    version,
    slug: shared.slug as string,
    date: shared.date as string,
    text: text as Record<BlogLocale, PostText>,
  }
}

/**
 * Every post in the blog, newest first.
 *
 * Ordering is the publication date and then the version, so a release that ships
 * two posts in a day still reads in the order they were written. A README at the
 * root is documentation, not a post; anything else that is not a version folder
 * is an error, because a stray directory is a post the site would never show.
 * @param options.root - the blog directory; defaults to `blogRoot()`.
 * @returns the posts, newest first.
 */
export async function loadPosts(options: { root?: string } = {}): Promise<BlogPost[]> {
  const root = options.root ?? blogRoot()
  const entries = await readdir(root, { withFileTypes: true })
  const posts: BlogPost[] = []
  const versions = new Set<string>()
  const slugs = new Map<string, string>()
  for (const entry of entries) {
    if (entry.name === 'README.md' || entry.name.startsWith('.')) continue
    if (!entry.isDirectory()) throw new Error(`${join(root, entry.name)}: only version folders and README.md belong here`)
    if (!VERSION_PATTERN.test(entry.name)) throw new Error(`${join(root, entry.name)}: folder names are release versions (x.y.z)`)
    if (versions.has(entry.name)) throw new Error(`${join(root, entry.name)}: two posts for one release`)
    versions.add(entry.name)
    const post = await readPost(join(root, entry.name), entry.name)
    const written = slugs.get(post.slug)
    if (written !== undefined) throw new Error(`${join(root, entry.name)}: slug "${post.slug}" is already used by ${written}`)
    slugs.set(post.slug, post.version)
    posts.push(post)
  }
  return posts.sort((a, b) => (a.date === b.date ? compareVersions(b.version, a.version) : a.date < b.date ? 1 : -1))
}

/** Compare two `x.y.z` versions numerically, so 0.3.9 sorts below 0.3.10. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/** The post a URL names, or undefined when no release wrote that slug. */
export function findPost(posts: readonly BlogPost[], slug: string): BlogPost | undefined {
  return posts.find(post => post.slug === slug)
}

/**
 * A post's date, written out without asking the build machine's locale.
 *
 * `Intl` output changes with the ICU version a runner ships, and the blog is
 * pre-rendered once on a build machine and then served from static assets: two
 * releases could otherwise disagree about how the same day is written, or a
 * Chinese post could be rendered with an English month on a Linux runner.
 * @param locale - the language the date is written in.
 * @param date - the frontmatter date, `YYYY-MM-DD`.
 * @returns the date as `21 November 2026` or `2026 年 11 月 21 日`.
 */
export function formatPostDate(locale: BlogLocale, date: string): string {
  const [year, month, day] = date.split('-')
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]
  return locale === 'zh-CN'
    ? `${year} 年 ${Number(month)} 月 ${Number(day)} 日`
    : `${Number(day)} ${months[Number(month) - 1]} ${year}`
}
