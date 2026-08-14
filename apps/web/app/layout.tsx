import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Loop — Build a system that learns",
  description: "A local-first human–Agent feedback loop built around objectives, world models, evidence, and revision.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

