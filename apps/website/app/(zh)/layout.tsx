import type { Metadata } from "next";
import "../globals.css";
import { buildSiteMetadata } from "../siteMetadata";

export const generateMetadata = (): Promise<Metadata> => buildSiteMetadata("zh-CN", "home");

export default function ChineseRootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
