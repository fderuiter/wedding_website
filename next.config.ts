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
    value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://js.stripe.com; worker-src 'self' blob:; frame-src 'self' https://js.stripe.com https://hooks.stripe.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'self';",
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
  typescript: {
    tsconfigPath: './tsconfig.build.json',
  },
  serverExternalPackages: ['sharp', 'heic-decode', 'libheif-js', 'pdfkit'],
  outputFileTracingIncludes: {
    '/api/admin/seating/export': [
      './node_modules/pdfkit/**/*',
      './node_modules/@noble/ciphers/**/*',
      './node_modules/@noble/hashes/**/*',
      './node_modules/fflate/**/*',
      './node_modules/fontkit/**/*',
      './node_modules/@swc/helpers/**/*',
      './node_modules/tslib/**/*',
      './node_modules/brotli/**/*',
      './node_modules/clone/**/*',
      './node_modules/dfa/**/*',
      './node_modules/fast-deep-equal/**/*',
      './node_modules/restructure/**/*',
      './node_modules/tiny-inflate/**/*',
      './node_modules/unicode-properties/**/*',
      './node_modules/unicode-trie/**/*',
      './node_modules/pako/**/*',
      './node_modules/linebreak/**/*',
      './node_modules/png-js/**/*',
    ],
    '/api/admin/thank-you-notes/export-labels': [
      './node_modules/pdfkit/**/*',
      './node_modules/@noble/ciphers/**/*',
      './node_modules/@noble/hashes/**/*',
      './node_modules/fflate/**/*',
      './node_modules/fontkit/**/*',
      './node_modules/@swc/helpers/**/*',
      './node_modules/tslib/**/*',
      './node_modules/brotli/**/*',
      './node_modules/clone/**/*',
      './node_modules/dfa/**/*',
      './node_modules/fast-deep-equal/**/*',
      './node_modules/restructure/**/*',
      './node_modules/tiny-inflate/**/*',
      './node_modules/unicode-properties/**/*',
      './node_modules/unicode-trie/**/*',
      './node_modules/pako/**/*',
      './node_modules/linebreak/**/*',
      './node_modules/png-js/**/*',
    ],
    '/api/media/export': [
      './node_modules/@isaacs/nonrecursive-glob-match/**/*',
      './node_modules/archiver/**/*',
      './node_modules/async/**/*',
      './node_modules/b4a/**/*',
      './node_modules/balanced-match/**/*',
      './node_modules/base64-js/**/*',
      './node_modules/brace-expansion/**/*',
      './node_modules/buffer/**/*',
      './node_modules/buffer-crc32/**/*',
      './node_modules/compress-commons/**/*',
      './node_modules/concat-map/**/*',
      './node_modules/core-util-is/**/*',
      './node_modules/crc-32/**/*',
      './node_modules/crc32-stream/**/*',
      './node_modules/event-target-shim/**/*',
      './node_modules/events/**/*',
      './node_modules/events-universal/**/*',
      './node_modules/fast-fifo/**/*',
      './node_modules/ieee754/**/*',
      './node_modules/inherits/**/*',
      './node_modules/is-stream/**/*',
      './node_modules/lazystream/**/*',
      './node_modules/minimatch/**/*',
      './node_modules/normalize-path/**/*',
      './node_modules/process/**/*',
      './node_modules/process-nextick-args/**/*',
      './node_modules/readable-stream/**/*',
      './node_modules/readdir-glob/**/*',
      './node_modules/safe-buffer/**/*',
      './node_modules/streamx/**/*',
      './node_modules/string_decoder/**/*',
      './node_modules/tar-stream/**/*',
      './node_modules/teex/**/*',
      './node_modules/text-decoder/**/*',
      './node_modules/util-deprecate/**/*',
      './node_modules/zip-stream/**/*',
      './node_modules/abort-controller/**/*',
    ],
  },
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  ...(isStaticExport ? {} : {
    async rewrites() {
      return {
        beforeFiles: [
          {
            source: '/uploads/:path*',
            destination: '/api/uploads/:path*',
          },
        ],
      };
    },
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
