import type { MetadataRoute } from 'next';
import { getAppConfig } from '@/lib/config';
import { getValidatedCanonicalUrl } from '@/utils/hostValidation';

export const dynamic = 'force-static';

export default async function robots(): Promise<MetadataRoute.Robots> {
  let siteUrl = 'http://localhost:3000';
  let shouldAllowIndexing = false;

  const isStaticExport =
    process.env.STATIC_EXPORT === 'true' ||
    process.env.STATIC_EXPORT === '1' ||
    process.env.npm_lifecycle_event === 'build:export';

  try {
    const config = await getAppConfig();
    if (config.baseUrl) {
      siteUrl = config.baseUrl;
    }
    const isPasswordProtected = config.guestPasscodeEnabled !== false;
    shouldAllowIndexing = !isPasswordProtected && Boolean(config.allowSearchIndexing);

    if (!isStaticExport) {
      try {
        const { headers } = await import('next/headers');
        const headersList = await headers();
        const host = headersList.get('host');
        const proto = headersList.get('x-forwarded-proto');
        if (host) {
          siteUrl = getValidatedCanonicalUrl(host, proto, siteUrl);
        }
      } catch {
        // Fallback if headers are not available during static generation
      }
    }
  } catch {
    shouldAllowIndexing = false;
  }

  if (!shouldAllowIndexing) {
    return {
      rules: {
        userAgent: '*',
        disallow: '/',
      },
    };
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin/', '/api/', '/guest/'],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
