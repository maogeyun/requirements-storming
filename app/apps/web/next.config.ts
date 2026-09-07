import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@rs/shared", "@rs/game-data", "@rs/rules-engine"],
};

export default nextConfig;
