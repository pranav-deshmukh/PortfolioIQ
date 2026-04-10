import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use fallback rewrites so that explicit App-Router route handlers
  // (e.g. /api/chat, /api/memory/*) are served first by the filesystem.
  // Only unmatched /api/* requests fall through to the agent backend.
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [],
      fallback: [
        {
          source: "/api/:path*",
          destination: "http://localhost:3001/api/:path*",
        },
      ],
    };
  },
};

export default nextConfig;
