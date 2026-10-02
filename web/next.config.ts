import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  poweredByHeader: false,
  // Development proxies through Next; production is served by the Go backend.
  ...(process.env.NODE_ENV === "development"
    ? {
        async rewrites() {
          const backend =
            process.env.MTXUI_DEV_BACKEND ?? "http://127.0.0.1:8083";
          return [
            { source: "/api/:path*", destination: backend + "/api/:path*" },
          ];
        },
      }
    : {}),
};

export default nextConfig;
