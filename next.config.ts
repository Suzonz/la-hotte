import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This folder is the project root (another package-lock.json higher up would confuse Next).
  outputFileTracingRoot: __dirname,
  // The UI tests run their own server next to `npm run dev`: they need their own build folder.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // To try `npm run dev` from a phone on the same Wi-Fi (http://192.168.x.x:3123).
  allowedDevOrigins: ['192.168.*.*'],
};

export default nextConfig;
