import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@tcg/domain", "@tcg/graphql", "@tcg/persistence"],
};
export default nextConfig;
