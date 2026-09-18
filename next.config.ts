import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  devIndicators: false,
  // STATIC_EXPORT=1 builds a plain static site (served by the live lab server or any static host)
  ...(process.env.STATIC_EXPORT === "1" ? { output: "export" as const, images: { unoptimized: true } } : {}),
};

export default nextConfig;
