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

const shouldStripStaticDemoRuntime =
  !isStaticExport &&
  process.env.NODE_ENV !== 'test' &&
  !process.env.JEST_WORKER_ID;

const nextConfig: NextConfig = {
  // Support dual-mode build: output: 'standalone' by default, 'export' for static showcases
  output: isStaticExport ? 'export' : 'standalone',
  distDir: isStaticExport ? '.next-export' : '.next',
  ...(shouldStripStaticDemoRuntime
    ? {
      turbopack: {
        resolveAlias: {
          '@/lib/staticDemo/runtime': './src/lib/staticDemo/runtime.noop.ts',
        },
      },
    }
    : {}),
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
  },
  outputFileTracingExcludes: {
    '*': [
      './node_modules/pdfkit/.yarn/**/*',
      './node_modules/pdfkit/js/pdfkit.standalone.js',
      './node_modules/pdfkit/js/pdfkit.browser*',
      './node_modules/pdfkit/js/*.old.*',
      './node_modules/pdfkit/lib/*/browser.js',
      './node_modules/fontkit/dist/browser*',
      './node_modules/fontkit/src/**/*',
      './node_modules/**/test/**/*',
      './node_modules/**/tests/**/*',
      './node_modules/**/__tests__/**/*',
      './node_modules/**/src/**/*.ts',
      './node_modules/**/*.d.ts',
      './node_modules/**/*.map',
      './src/**/*.ts',
      './src/**/*.tsx',
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
