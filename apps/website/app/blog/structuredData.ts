/**
 * The structured data a post carries: `BlogPosting` and `BreadcrumbList`.
 *
 * It states, in a standard vocabulary, which article this is, when it was
 * published, in which language, and where it sits under the site. The breadcrumb
 * list has to match a breadcrumb the reader can see, so the page renders one and
 * this describes exactly that one.
 *
 * The markup is generated from the same loader the page renders from, so it can
 * never describe a different title, date or URL than the visible page.
 *
 * @module hulala/website/blog/structuredData
 */
import { blogCopy } from './copy'
import { blogPath, localePath } from '../i18n'
import { type BlogLocale, type BlogPost } from './posts'

const ORIGIN = 'https://hulala.ai'

/** The site name the publisher entity is registered under. */
const PUBLISHER = {
  '@type': 'Organization',
  name: 'Hulala',
  url: ORIGIN,
  logo: { '@type': 'ImageObject', url: `${ORIGIN}/logo.svg` },
} as const

/** The label the visible breadcrumb uses for the blog's index page. */
const BLOG_LABEL: Readonly<Record<BlogLocale, string>> = { en: 'Blog', 'zh-CN': '博客' }

/** The label the visible breadcrumb uses for the home page. */
const HOME_LABEL: Readonly<Record<BlogLocale, string>> = { en: 'Home', 'zh-CN': '首页' }

/**
 * The JSON-LD documents for one post.
 * @param locale - the language the page is rendered in.
 * @param post - the post being rendered.
 * @returns the graph, in the order the page emits it.
 */
export function blogStructuredData(locale: BlogLocale, post: BlogPost): Record<string, unknown>[] {
  const text = post.text[locale]
  const url = `${ORIGIN}${blogPath(locale, post.slug)}`
  const index = `${ORIGIN}${blogPath(locale)}`
  const home = `${ORIGIN}${localePath(locale, '/')}`
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      '@id': `${url}#post`,
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      url,
      headline: text.title,
      description: text.description,
      inLanguage: locale === 'zh-CN' ? 'zh-CN' : 'en',
      // One post per release: the publication day is the release day, and a
      // shipped post is not edited afterwards, so both dates are the same.
      datePublished: post.date,
      dateModified: post.date,
      articleSection: 'Release',
      image: `${ORIGIN}/og.png`,
      author: PUBLISHER,
      publisher: PUBLISHER,
      isPartOf: { '@type': 'Blog', '@id': `${index}#blog`, name: 'Hulala blog', url: index },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: HOME_LABEL[locale], item: home },
        { '@type': 'ListItem', position: 2, name: BLOG_LABEL[locale], item: index },
        { '@type': 'ListItem', position: 3, name: text.title },
      ],
    },
  ]
}

/**
 * A JSON-LD payload safe to place inside a `<script>` element.
 *
 * `<` is escaped as `\u003c` because a `</script>` inside the data would end the
 * element early, and escaping it is cheaper than trusting every future field to
 * avoid one.
 * @param value - the structured data.
 * @returns the string to assign to `dangerouslySetInnerHTML`.
 */
export function jsonLdHtml(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/**
 * The JSON-LD document for the blog index.
 *
 * A `Blog` entity names the collection, and its `blogPost` list names the posts
 * in the same order the page shows them. It is generated from the same loader as
 * the list, so the two cannot disagree about what is published.
 * @param locale - the language the index is rendered in.
 * @param posts - every post, newest first, as the page renders them.
 * @returns the graph the index page emits.
 */
export function blogIndexStructuredData(locale: BlogLocale, posts: readonly BlogPost[]): Record<string, unknown>[] {
  const url = `${ORIGIN}${blogPath(locale)}`
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Blog',
      '@id': `${url}#blog`,
      url,
      name: locale === 'zh-CN' ? 'Hulala 博客' : 'Hulala blog',
      description: blogCopy[locale].metaDescription,
      inLanguage: locale === 'zh-CN' ? 'zh-CN' : 'en',
      publisher: PUBLISHER,
      blogPost: posts.map(post => ({
        '@type': 'BlogPosting',
        headline: post.text[locale].title,
        url: `${ORIGIN}${blogPath(locale, post.slug)}`,
        datePublished: post.date,
      })),
    },
  ]
}
