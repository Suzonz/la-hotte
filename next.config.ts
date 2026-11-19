import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This folder is the project root (another package-lock.json higher up would confuse Next).
  outputFileTracingRoot: __dirname,
  // The UI tests run their own server next to `npm run dev`: they need their own build folder.
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
