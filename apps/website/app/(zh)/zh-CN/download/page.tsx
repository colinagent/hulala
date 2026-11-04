import type { Metadata } from "next";
import DownloadPageClient from "../../../download/DownloadPageClient";
import { loadRelease } from "../../../download/release";
import { buildSiteMetadata } from "../../../siteMetadata";

export const dynamic = "force-dynamic";
export const generateMetadata = (): Promise<Metadata> => buildSiteMetadata("zh-CN", "download");

export default async function ChineseDownloadPage() {
  return <DownloadPageClient locale="zh-CN" release={await loadRelease()} />;
}
