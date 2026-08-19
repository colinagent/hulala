import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@hulala/core", "@hulala/cordis", "@hulala/cosmokit"],
};

export default nextConfig;

