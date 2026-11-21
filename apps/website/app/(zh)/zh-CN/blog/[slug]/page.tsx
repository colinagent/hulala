import type { Metadata } from "next";
import { BlogPostPage } from "../../../../blog/BlogPage";
import { findPost, loadPosts } from "../../../../blog/posts";
import { buildBlogMetadata } from "../../../../siteMetadata";

/** Only the slugs a release actually wrote exist; anything else is a 404. */
export const dynamicParams = false;

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  return (await loadPosts()).map((post) => ({ slug: post.slug }));
}

interface PostRouteProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PostRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const post = findPost(await loadPosts(), slug);
  if (post === undefined) return {};
  const text = post.text["zh-CN"];
  return buildBlogMetadata("zh-CN", {
    kind: "post",
    slug: post.slug,
    title: text.title,
    description: text.description,
    date: post.date,
    version: post.version,
  });
}

export default async function ChineseBlogPostPage({ params }: PostRouteProps) {
  const { slug } = await params;
  return <BlogPostPage locale="zh-CN" slug={slug} />;
}
