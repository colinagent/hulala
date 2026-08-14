import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@loopwithai/core", "@loopwithai/cordis", "@loopwithai/cosmokit"],
};

export default nextConfig;

