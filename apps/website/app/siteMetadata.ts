import type { Metadata } from "next";
import { headers } from "next/headers";
import { blogCopy } from "./blog/copy";
import type { SiteLocale } from "./i18n";
import { blogPath, localePath } from "./i18n";

type PageKind = "home" | "download";

const metadataCopy = {
  en: {
    home: {
      title: "Hulala — the local DeepSeek Harness agent that outlives your terminal window",
      description: "Hulala runs DeepSeek Harness in one TUI: the agent, Neovim and a real shell, backed by a single Host daemon. Detach with Ctrl-Q and the turn keeps running. The same agent answers in Telegram and Feishu, and hulala ssh opens a window on another machine. macOS and Linux, one command.",
    },
    download: {
      title: "Install Hulala — Downloads",
      description: "Install the Hulala terminal client with one command on macOS or Linux, or download Hulala Desktop. Verify SHA-256 before installing.",
    },
  },
  "zh-CN": {
    home: {
      title: "Hulala 呼啦啦｜关掉窗口，工作照样在跑的本地 Agent",
      description: "Hulala 把 DeepSeek Harness 放进一个 TUI：Agent、Neovim 和真实 shell，背后只有一个 Host 守护进程。Ctrl-Q 断开窗口，turn 继续跑。同一个 agent 也能在 Telegram 和飞书里回你，hulala ssh 还能把窗口开到另一台机器。macOS 与 Linux，一行命令安装。",
    },
    download: {
      title: "安装 Hulala｜下载与安装说明",
      description: "macOS、Linux 一行命令安装 Hulala 终端版，或下载 Hulala 桌面版。校验 SHA-256 后再安装。",
    },
  },
} as const;

const localizedPath = (locale: SiteLocale, page: PageKind): string => {
  return localePath(locale, page === "home" ? "/" : "/download/");
};

const requestOrigin = async (): Promise<string> => {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const forwardedProtocol = requestHeaders.get("x-forwarded-proto");
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https"
    ? forwardedProtocol
    : host?.startsWith("localhost") || host?.startsWith("127.0.0.1")
      ? "http"
      : "https";
  return host ? `${protocol}://${host}` : "https://hulala.ai";
};

export async function buildSiteMetadata(locale: SiteLocale, page: PageKind): Promise<Metadata> {
  const origin = await requestOrigin();
  const copy = metadataCopy[locale][page];
  const canonical = new URL(localizedPath(locale, page), origin).toString();
  const englishUrl = new URL(localizedPath("en", page), origin).toString();
  const chineseUrl = new URL(localizedPath("zh-CN", page), origin).toString();
  const socialImage = new URL("/og.png", origin).toString();

  return {
    title: copy.title,
    description: copy.description,
    icons: { icon: "/logo.svg?v=flywheel-brand-1" },
    alternates: {
      canonical,
      languages: { en: englishUrl, "zh-CN": chineseUrl, "x-default": englishUrl },
    },
    openGraph: {
      type: "website",
      url: canonical,
      siteName: "Hulala",
      locale: locale === "zh-CN" ? "zh_CN" : "en_US",
      alternateLocale: [locale === "zh-CN" ? "en_US" : "zh_CN"],
      title: copy.title,
      description: copy.description,
      images: [{ url: socialImage, width: 1734, height: 907, alt: copy.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: copy.title,
      description: copy.description,
      images: [socialImage],
    },
  };
}
/** What a blog page's metadata needs: the index, or one post's own facts. */
export type BlogMetadataInput =
  | { readonly kind: "index" }
  | {
      readonly kind: "post";
      readonly slug: string;
      readonly title: string;
      readonly description: string;
      readonly date: string;
      readonly version: string;
    };

/**
 * Metadata for the blog index and for one post.
 *
 * A post's canonical URL is its slug in the language being read, and the
 * alternate points at the same slug in the other language — the two files are
 * one page in two languages, not two unrelated articles. An article also carries
 * its publication date, because the index is a reverse-chronological list and a
 * reader should be able to tell when a release was written about.
 * @param locale - the language of the page being rendered.
 * @param input - which page, and for a post its title, description and date.
 * @returns the page metadata, matching the copy the page itself renders.
 */
export async function buildBlogMetadata(locale: SiteLocale, input: BlogMetadataInput): Promise<Metadata> {
  const origin = await requestOrigin();
  const copy = blogCopy[locale];
  const canonicalPath = input.kind === "index" ? blogPath(locale) : blogPath(locale, input.slug);
  const canonical = new URL(canonicalPath, origin).toString();
  const englishUrl = new URL(input.kind === "index" ? blogPath("en") : blogPath("en", input.slug), origin).toString();
  const chineseUrl = new URL(input.kind === "index" ? blogPath("zh-CN") : blogPath("zh-CN", input.slug), origin).toString();
  const socialImage = new URL("/og.png", origin).toString();
  const title = input.kind === "index" ? copy.metaTitle : `${input.title} — Hulala`;
  const description = input.kind === "index" ? copy.metaDescription : input.description;
  const shared = {
    siteName: "Hulala",
    locale: locale === "zh-CN" ? "zh_CN" : "en_US",
    alternateLocale: [locale === "zh-CN" ? "en_US" : "zh_CN"],
  };

  return {
    title,
    description,
    icons: { icon: "/logo.svg?v=flywheel-brand-1" },
    alternates: {
      canonical,
      languages: { en: englishUrl, "zh-CN": chineseUrl, "x-default": englishUrl },
    },
    openGraph:
      input.kind === "index"
        ? {
            type: "website",
            url: canonical,
            ...shared,
            title,
            description,
            images: [{ url: socialImage, width: 1734, height: 907, alt: title }],
          }
        : {
            type: "article",
            url: canonical,
            ...shared,
            title,
            description,
            publishedTime: input.date,
            modifiedTime: input.date,
            section: "Release",
            // The release the post is about, not a tag system: one post, one tag.
            tags: [`v${input.version}`],
            images: [{ url: socialImage, width: 1734, height: 907, alt: title }],
          },
    twitter: { card: "summary_large_image", title, description, images: [socialImage] },
  };
}
