import type { Metadata } from "next";
import { headers } from "next/headers";
import type { SiteLocale } from "./HomePage";

type PageKind = "home" | "download";

const metadataCopy = {
  en: {
    home: {
      title: "Hulala — Your local personal agent, on DeepSeek Harness.",
      description: "Your local personal agent on DeepSeek Harness: one Host daemon, many windows, Neovim and a real shell beside the conversation, the same agent in Telegram and Feishu, and `hulala ssh <host>` to a Host on another machine, pasted images included. macOS and Linux, one command.",
    },
    download: {
      title: "Install Hulala — Downloads",
      description: "Install the Hulala terminal client with one command on macOS or Linux, or download Hulala Desktop. Verify SHA-256 before installing.",
    },
  },
  "zh-CN": {
    home: {
      title: "Hulala 呼啦啦｜跑在你本地的 DeepSeek Harness 个人 Agent",
      description: "跑在你本地的 DeepSeek Harness 个人 Agent：一个 Host 守护进程、多个窗口，对话旁边是 Neovim 和真实 shell；同一个 agent 也在 Telegram 和飞书里回你，`hulala ssh <host>` 还能把窗口开到另一台机器的 Host 上，粘贴的图片直接过去。macOS 与 Linux，一行命令安装。",
    },
    download: {
      title: "安装 Hulala｜下载与安装说明",
      description: "macOS、Linux 一行命令安装 Hulala 终端版，或下载 Hulala 桌面版。校验 SHA-256 后再安装。",
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
