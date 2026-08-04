import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@casting/python-bridge"],
  poweredByHeader: false,
  typedRoutes: true,
};

export default nextConfig;
