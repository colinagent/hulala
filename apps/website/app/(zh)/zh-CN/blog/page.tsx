import type { Metadata } from "next";
import { BlogIndexPage } from "../../../blog/BlogPage";
import { buildBlogMetadata } from "../../../siteMetadata";

export const generateMetadata = (): Promise<Metadata> => buildBlogMetadata("zh-CN", { kind: "index" });

export default function ChineseBlogPage() {
  return <BlogIndexPage locale="zh-CN" />;
}
