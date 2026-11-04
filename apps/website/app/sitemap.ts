import type { MetadataRoute } from "next";

const ORIGIN = "https://hulala.ai";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${ORIGIN}/`,
      changeFrequency: "weekly",
      priority: 1,
      alternates: { languages: { en: `${ORIGIN}/`, "zh-CN": `${ORIGIN}/zh-CN/`, "x-default": `${ORIGIN}/` } },
    },
    {
      url: `${ORIGIN}/zh-CN/`,
      changeFrequency: "weekly",
      priority: 1,
      alternates: { languages: { en: `${ORIGIN}/`, "zh-CN": `${ORIGIN}/zh-CN/`, "x-default": `${ORIGIN}/` } },
    },
    {
      url: `${ORIGIN}/download/`,
      changeFrequency: "daily",
      priority: .8,
      alternates: { languages: { en: `${ORIGIN}/download/`, "zh-CN": `${ORIGIN}/zh-CN/download/`, "x-default": `${ORIGIN}/download/` } },
    },
    {
      url: `${ORIGIN}/zh-CN/download/`,
      changeFrequency: "daily",
      priority: .8,
      alternates: { languages: { en: `${ORIGIN}/download/`, "zh-CN": `${ORIGIN}/zh-CN/download/`, "x-default": `${ORIGIN}/download/` } },
    },
  ];
}
