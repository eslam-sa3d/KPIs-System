/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship TS/CSS source; Next transpiles them in-place.
  transpilePackages: ['@pulse/contracts', '@pulse/theme'],
};

export default nextConfig;
