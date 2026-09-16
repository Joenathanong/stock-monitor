/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  experimental: { serverActions: { bodySizeLimit: '25mb' } },
};
export default nextConfig;
