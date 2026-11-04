import type { Metadata } from "next";
import { headers } from "next/headers";
import type { SiteLocale } from "./HomePage";

type PageKind = "home" | "download";

const metadataCopy = {
  en: {
    home: {
      title: "Hulala — Growth in motion.",
      description: "The private AI workspace that turns reading, writing, and coding into a flywheel for long-term growth.",
    },
    download: {
      title: "Install Hulala — Downloads",
      description: "Install the Hulala terminal client with one command on macOS or Linux, or download Hulala Desktop. Verify SHA-256 and keep your work local.",
    },
  },
  "zh-CN": {
    home: {
      title: "Hulala 呼啦啦｜你的成长飞轮",
      description: "为长期成长而生的私有 AI 工作空间，让阅读沉淀为知识，让写作磨砺思想，让代码把想法变成作品。",
    },
    download: {
      title: "安装 Hulala｜下载与安装说明",
      description: "macOS、Linux 一行命令安装 Hulala 终端版，或下载 Hulala 桌面版。校验 SHA-256，让工作保留在本地。",
    },
  },
} as const;

const localizedPath = (locale: SiteLocale, page: PageKind): string => {
  if (locale === "zh-CN") return page === "home" ? "/zh-CN/" : "/zh-CN/download/";
  return page === "home" ? "/" : "/download/";
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
