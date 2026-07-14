/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: `next build` emits a fully static site into `out/`,
  // which FastAPI serves as static files from the same origin as /api/*.
  output: 'export',
  reactStrictMode: true,
  images: { unoptimized: true },
  // Trailing slashes keep static-export routing predictable behind FastAPI.
  trailingSlash: true,
};

export default nextConfig;
