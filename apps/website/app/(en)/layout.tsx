import type { Metadata } from "next";
import "../globals.css";
import { buildSiteMetadata } from "../siteMetadata";

export const generateMetadata = (): Promise<Metadata> => buildSiteMetadata("en", "home");

export default function EnglishRootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
