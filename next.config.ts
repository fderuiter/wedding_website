/**
 * @type {import('next').NextConfig}
 */
import type { NextConfig } from "next";

/**
 * @description Configuration object for Next.js.
 *
 * This configuration includes:
 * - `images.remotePatterns`: A list of allowed hostnames for optimized image loading via `next/image`.
 *   This is a security measure to prevent arbitrary image hosting.
 * - `webpack`: A function to customize the Webpack configuration.
 *   - It excludes the 're2' module from the server-side bundle. 're2' is a native C++
 *     module that can cause issues with serverless environments if not handled as an external dependency.
 */
const securityHeaders = [
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

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
  images: {
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
  webpack: (config, { isServer }) => {
    // Exclude re2 from bundling for server-side code
    if (isServer) {
      config.externals.push("re2");
    }
    // Important: return the modified config
    return config;
  },
};

export default nextConfig;
