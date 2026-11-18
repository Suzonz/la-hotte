import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This folder is the project root (another package-lock.json higher up would confuse Next).
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
