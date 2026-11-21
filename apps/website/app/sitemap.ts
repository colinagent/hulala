import type { MetadataRoute } from "next";
import { loadPosts } from "./blog/posts";
import { blogPath, localePath, type SiteLocale } from "./i18n";

const ORIGIN = "https://hulala.ai";

const at = (path: string): string => `${ORIGIN}${path}`;
const blogIndex = (locale: SiteLocale): string => at(blogPath(locale));
const blogPost = (locale: SiteLocale, slug: string): string => at(blogPath(locale, slug));

const alternates = (en: string, zh: string) => ({ languages: { en, "zh-CN": zh, "x-default": en } });

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await loadPosts();
  return [
    {
      url: at(localePath("en", "/")),
      changeFrequency: "weekly",
      priority: 1,
      alternates: alternates(at(localePath("en", "/")), at(localePath("zh-CN", "/"))),
    },
    {
      url: at(localePath("zh-CN", "/")),
      changeFrequency: "weekly",
      priority: 1,
      alternates: alternates(at(localePath("en", "/")), at(localePath("zh-CN", "/"))),
    },
    {
      url: at(localePath("en", "/download/")),
      changeFrequency: "daily",
      priority: .8,
      alternates: alternates(at(localePath("en", "/download/")), at(localePath("zh-CN", "/download/"))),
    },
    {
      url: at(localePath("zh-CN", "/download/")),
      changeFrequency: "daily",
      priority: .8,
      alternates: alternates(at(localePath("en", "/download/")), at(localePath("zh-CN", "/download/"))),
    },
    {
      url: blogIndex("en"),
      changeFrequency: "weekly",
      priority: .7,
      alternates: alternates(blogIndex("en"), blogIndex("zh-CN")),
    },
    {
      url: blogIndex("zh-CN"),
      changeFrequency: "weekly",
      priority: .7,
      alternates: alternates(blogIndex("en"), blogIndex("zh-CN")),
    },
    // One release, one post, one URL per language: `lastModified` is the day the
    // post was published, not the day the site was deployed.
    ...posts.flatMap((post) => {
      const lastModified = new Date(`${post.date}T00:00:00Z`);
      return (["en", "zh-CN"] as const).map((locale) => ({
        url: blogPost(locale, post.slug),
        lastModified,
        changeFrequency: "yearly" as const,
        priority: .6,
        alternates: alternates(blogPost("en", post.slug), blogPost("zh-CN", post.slug)),
      }));
    }),
  ];
}
