/**
 * The blog's two views, in both languages.
 *
 * One release, one post: the index is a list of releases and each row is the
 * value sentence the post opens with. The post itself is a narrow column — a
 * heading, the description as a lede, then the Markdown — because the page is
 * prose, not a product surface: the header and the install button are the only
 * things it shares with the rest of the site.
 *
 * The copy lives in `copy.ts` rather than in `HomePage.tsx`'s translations: the
 * blog is a separate page kind with its own voice, the home page should not grow
 * a second set of strings for a section it does not show, and `siteMetadata.ts`
 * reads the same strings for the page's `<title>` and description.
 *
 * @module hulala/website/blog/BlogPage
 */
import { notFound } from 'next/navigation'
import GitHubLink, { GITHUB_REPOSITORY } from '../GitHubLink'
import LanguageSwitcher from '../LanguageSwitcher'
import { blogCopy as copy } from './copy'
import { renderMarkdown } from './markdown'
import { blogPath, localePath } from '../i18n'
import { findPost, formatPostDate, loadPosts, type BlogLocale, type BlogPost } from './posts'
import { blogIndexStructuredData, blogStructuredData, jsonLdHtml } from './structuredData'

const LOGO_SRC = '/logo-mark.svg?v=flywheel-brand-2'

/** The home page, in the same language as the blog page being read. */
function homeHref(locale: BlogLocale): string {
  return localePath(locale, '/')
}

/** The download page, in the same language. */
function downloadHref(locale: BlogLocale): string {
  return localePath(locale, '/download/')
}

/**
 * The header the blog shares with the rest of the site.
 *
 * The language switch keeps the reader on the page they are reading: on a post it
 * points at the same slug in the other language, not at that language's index.
 * @param props.locale - the language being read.
 * @param props.slug - the post's slug, when the page is a post.
 */
function BlogHeader({ locale, slug }: { locale: BlogLocale; slug?: string }) {
  const t = copy[locale]
    return (
    <header className="site-header">
      <a className="brand" href={homeHref(locale)} aria-label="Hulala home">
        <img src={LOGO_SRC} alt="" />
        <span>Hulala</span>
      </a>
      <nav aria-label={t.navAria}>
        <a href={homeHref(locale)}>{t.home}</a>
        <a href={blogPath(locale)} aria-current="page">
          {t.blog}
        </a>
        <a href={downloadHref(locale)}>{t.download}</a>
      </nav>
      <div className="header-actions">
        <GitHubLink label={t.githubLabel} accessibleName={t.githubAria} />
        <LanguageSwitcher locale={locale} path={slug === undefined ? '/blog/' : `/blog/${slug}/`} />
        <a className="button static-glass button-small" href={downloadHref(locale)}>
          {t.install} <span aria-hidden="true">↗</span>
        </a>
      </div>
    </header>
  )
}

/** The footer both blog views end with: the same one the home page draws. */
function BlogFooter({ locale }: { locale: BlogLocale }) {
  const t = copy[locale]
  return (
    <footer>
      <a className="brand" href={homeHref(locale)} aria-label="Hulala home">
        <img src={LOGO_SRC} alt="" />
        <span>Hulala</span>
      </a>
      <p>{t.footerSlogan}</p>
      <div>
        <span>{t.footer}</span>
        <a href={GITHUB_REPOSITORY} rel="noreferrer" target="_blank">
          GitHub ↗
        </a>
        <span>hello@hulala.ai</span>
      </div>
    </footer>
  )
}

/**
 * The index: every release post, newest first.
 * @param props.locale - the language to render.
 */
export async function BlogIndexPage({ locale }: { locale: BlogLocale }) {
  const t = copy[locale]
  const posts = await loadPosts()
  return (
    <main id="top" data-locale={locale === 'zh-CN' ? 'zh' : 'en'} data-blog-page="index">
      <BlogHeader locale={locale} />
      <section className="blog-hero">
        <p className="section-label">{t.label}</p>
        <h1>
          {t.title[0]}
          <br />
          <em>{t.title[1]}</em>
        </h1>
        <p>{t.lede}</p>
      </section>
      <section className="blog-list" aria-label={t.listAria}>
        {posts.length === 0 ? <p className="blog-empty">{t.empty}</p> : null}
        {posts.map(post => (
          <a className="blog-row" href={blogPath(locale, post.slug)} key={post.version}>
            <div className="blog-row-meta">
              <time dateTime={post.date}>{formatPostDate(locale, post.date)}</time>
              <span>v{post.version}</span>
            </div>
            <div className="blog-row-body">
              <h2>{post.text[locale].title}</h2>
              <p>{post.text[locale].description}</p>
              <span className="blog-read">{t.read} →</span>
            </div>
          </a>
        ))}
      </section>
      <BlogFooter locale={locale} />
      <script
        type="application/ld+json"
        // The payload is generated from the same loader the list renders from.
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(blogIndexStructuredData(locale, posts)) }}
      />
    </main>
  )
}

/**
 * One post.
 *
 * The slug is looked up in both languages' pairs, so a URL that names no release
 * is a 404 rather than an empty page.
 * @param props.locale - the language to render.
 * @param props.slug - the post's URL segment.
 */
export async function BlogPostPage({ locale, slug }: { locale: BlogLocale; slug: string }) {
  const t = copy[locale]
  const posts = await loadPosts()
  const post: BlogPost | undefined = findPost(posts, slug)
  if (post === undefined) notFound()
  const text = post.text[locale]
  // One post per release, newest first: the three before this one are where a
  // reader goes next after finishing a single post.
  const others = posts.filter(entry => entry.version !== post.version).slice(0, 3)
  return (
    <main id="top" data-locale={locale === 'zh-CN' ? 'zh' : 'en'} data-blog-page="post">
      <BlogHeader locale={locale} slug={post.slug} />
      <article className="blog-post">
        <nav className="blog-breadcrumb" aria-label={t.breadcrumbAria}>
          <a href={homeHref(locale)}>{t.home}</a>
          <span aria-hidden="true">/</span>
          <a href={blogPath(locale)}>{t.blog}</a>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{text.title}</span>
        </nav>
        <p className="section-label blog-post-meta">
          {t.release} v{post.version} · <time dateTime={post.date}>{formatPostDate(locale, post.date)}</time>
        </p>
        <h1>{text.title}</h1>
        <p className="blog-lede">{text.description}</p>
        <div className="blog-prose">{renderMarkdown(text.body)}</div>
        <div className="blog-post-footer">
          <a href={blogPath(locale)}>← {t.back}</a>
          <a className="button static-glass button-small" href={downloadHref(locale)}>
            {t.install} <span aria-hidden="true">↗</span>
          </a>
        </div>
      </article>
      {others.length > 0 ? (
        <section className="blog-more" aria-label={t.moreAria}>
          <p className="section-label">{t.more}</p>
          <ul>
            {others.map(other => (
              <li key={other.version}>
                <a href={blogPath(locale, other.slug)}>
                  <span>v{other.version}</span>
                  {other.text[locale].title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <BlogFooter locale={locale} />
      <script
        type="application/ld+json"
        // The payload is generated from the same fields the page renders, and
        // `jsonLdHtml` escapes `<` so the data cannot close the element.
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(blogStructuredData(locale, post)) }}
      />
    </main>
  )
}
