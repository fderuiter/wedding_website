/**
 * @type {import('next').NextConfig}
 */
import type { NextConfig } from 'next';
/**
 * @description Configuration object for Next.js.
 *
 * This configuration includes:
 * - `images.remotePatterns`: A list of allowed hostnames for optimized image loading via `next/image`.
 *   This is a security measure to prevent arbitrary image hosting.
 */
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'self';",
  },
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  },
];

const isStaticExport = process.env.STATIC_EXPORT === 'true' ||
                       process.env.STATIC_EXPORT === '1' ||
                       process.env.npm_lifecycle_event === 'build:export';

const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim();
const basePath = isStaticExport && rawBasePath && rawBasePath !== '/'
  ? (rawBasePath.startsWith('/') ? rawBasePath : `/${rawBasePath}`).replace(/\/+$/, '')
  : undefined;

const nextConfig: NextConfig = {
  // Support dual-mode build: output: 'standalone' by default, 'export' for static showcases
  output: isStaticExport ? 'export' : 'standalone',
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  ...(isStaticExport ? {} : {
    async headers() {
      return [
        {
          source: '/(.*)',
          headers: securityHeaders,
        },
      ];
    },
  }),
  images: {
    unoptimized: isStaticExport ? true : undefined,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'fls-na.amazon.com',
        port: '',
        pathname: '/**',
      },
      { protocol: 'https', hostname: 'assets.mayoclinic.org' },
      { protocol: 'https', hostname: 'www.exploreminnesota.com' },
      { protocol: 'https', hostname: 'static.where-e.com' },
      { protocol: 'https', hostname: 'static.wixstatic.com' },
      { protocol: 'https', hostname: 'img.ctykit.com' },
      { protocol: 'https', hostname: 'assets.simpleviewinc.com' },
      { protocol: 'https', hostname: 'images.trvl-media.com' },
      { protocol: 'https', hostname: 'upload.wikimedia.org' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },
};

export default nextConfig;
