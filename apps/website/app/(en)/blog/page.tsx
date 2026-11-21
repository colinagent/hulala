import type { Metadata } from "next";
import { BlogIndexPage } from "../../blog/BlogPage";
import { buildBlogMetadata } from "../../siteMetadata";

export const generateMetadata = (): Promise<Metadata> => buildBlogMetadata("en", { kind: "index" });

export default function EnglishBlogPage() {
  return <BlogIndexPage locale="en" />;
}
