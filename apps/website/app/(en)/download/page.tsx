import type { Metadata } from "next";
import DownloadPageClient from "../../download/DownloadPageClient";
import { loadRelease } from "../../download/release";
import { buildSiteMetadata } from "../../siteMetadata";

export const dynamic = "force-dynamic";
export const generateMetadata = (): Promise<Metadata> => buildSiteMetadata("en", "download");

export default async function EnglishDownloadPage() {
  return <DownloadPageClient locale="en" release={await loadRelease()} />;
}
