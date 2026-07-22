import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The committed SQLite DB (data/signals.db) is read at runtime by the API
  // routes. Next.js does not trace runtime-read data files into the serverless
  // function bundle by default, so include it explicitly or Vercel functions
  // hit ENOENT when copying it to /tmp.
  outputFileTracingIncludes: {
    '/api/**': ['./data/signals.db'],
  },
};

export default nextConfig;
