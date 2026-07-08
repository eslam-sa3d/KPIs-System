/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export — the portal deploys to GitHub Pages (no Node server).
  // The API is a separate deployment; its origin comes from NEXT_PUBLIC_API_URL.
  output: 'export',
  // Project pages serve from https://<user>.github.io/<repo>/ — CI sets this.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
  images: { unoptimized: true }, // no image-optimizer server on Pages
  trailingSlash: true, // Pages serves folder/index.html, avoiding 404s on refresh
  // Workspace packages ship TS/CSS source; Next transpiles them in-place.
  transpilePackages: ['@pulse/contracts', '@pulse/theme'],
};

export default nextConfig;
