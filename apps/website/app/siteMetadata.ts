import type { Metadata } from "next";
import { headers } from "next/headers";
import type { SiteLocale } from "./HomePage";

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
