import type { Metadata, Viewport } from 'next';
import { getAppConfig, toUnauthenticatedAppConfig } from '@/lib/config';
import { stripBasePath, withBasePath } from '@/lib/basePath';
import { getLocalImageDimensions } from '@/utils/image-metadata';
import { getValidatedCanonicalUrl } from '@/utils/hostValidation';
import { deriveBrandMonogram } from '@/features/content';
import { isAdminRequest } from '@/core/auth/auth.server';
import { isGuestRequest } from '@/core/auth/guest.server';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';

function interpolateKeywords(templateStr: string, config: any): string[] {
  if (!templateStr) return [];
  const interpolated = templateStr.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (config[key] !== undefined && config[key] !== null) return config[key];
    if (key === 'partner1Name' || key === 'brideName') return config.partner1Name ?? config.brideName ?? match;
    if (key === 'partner2Name' || key === 'groomName') return config.partner2Name ?? config.groomName ?? match;
    return match;
  });
  return interpolated.split(',').map(s => s.trim()).filter(Boolean);
}

export async function generateViewport(): Promise<Viewport> {
  const config = await getAppConfig();
  const themeColor = config.colorPrimary || '#B91C1C';
  return {
    themeColor,
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const rawConfig = await getAppConfig();

  const isStaticExport =
    process.env.STATIC_EXPORT === 'true' ||
    process.env.STATIC_EXPORT === '1' ||
    process.env.npm_lifecycle_event === 'build:export';

  let isAuthenticated = isStaticExport;
  if (!isStaticExport) {
    try {
      isAuthenticated =
        (await isAdminRequest()) ||
        (await isGuestRequest()) ||
        Boolean(await getGuestInviteSession());
    } catch {
      isAuthenticated = false;
    }
  }

  const config = isAuthenticated ? rawConfig : toUnauthenticatedAppConfig(rawConfig);

  const partner1 = config.partner1Name || config.brideName || '';
  const partner2 = config.partner2Name || config.groomName || '';
  const couplesNames = partner1 && partner2 ? `${partner1} & ${partner2}` : '';
  const monogram = deriveBrandMonogram(config);
  const brandIdentity = isAuthenticated
    ? config.brandMonogram || couplesNames || monogram
    : config.brandMonogram?.trim() || 'Wedding Website';

  const rawOgImageUrl = isAuthenticated ? config.ogImageUrl || '/api/og' : '/api/og';
  const ogImageUrl = rawOgImageUrl === '/images/placeholder.png' ? '/api/og' : rawOgImageUrl;
  const faviconUrl = config.faviconUrl || '/assets/favicon.png';
  const seoKeywords = config.seoKeywords || '';

  let siteUrl = config.baseUrl || 'http://localhost:3000';
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

  let venueLoc = '';
  if (config.venueName) {
    venueLoc = ` at ${config.venueName}`;
    if (config.venueCity) {
      venueLoc += ` in ${config.venueCity}`;
      if (config.venueState) {
        venueLoc += `, ${config.venueState}`;
      }
    }
  }

  const defaultTitle = partner1 && partner2
    ? `${partner1} & ${partner2}'s Wedding`
    : 'Wedding Website';

  const defaultDescription = partner1 && partner2
    ? `Join ${partner1} and ${partner2} for their wedding celebration${venueLoc}.`
    : 'Welcome to our wedding website.';

  const unprefixedOgImageUrl = stripBasePath(ogImageUrl);
  const prefixedOgImageUrl = withBasePath(ogImageUrl);
  const siteConfig = {
    title: config.seoTitle || defaultTitle,
    description: config.seoDescription || defaultDescription,
    url: siteUrl,
    ogImage: ogImageUrl.startsWith('http')
      ? ogImageUrl
      : `${siteUrl}${prefixedOgImageUrl.startsWith('/') ? prefixedOgImageUrl : `/${prefixedOgImageUrl}`}`,
    favicon: withBasePath(faviconUrl),
  };

  const dynamicKeywords = interpolateKeywords(seoKeywords, config);
  const dims = isAuthenticated ? await getLocalImageDimensions(unprefixedOgImageUrl) : null;
  const ogImageObj = {
    url: siteConfig.ogImage,
    width: dims?.width || 1200,
    height: dims?.height || 630,
    alt: isAuthenticated
      ? config.brandLogoAlt ||
        (partner1 && partner2
          ? `A photo for ${partner1} and ${partner2}'s wedding.`
          : 'Wedding website cover photo.')
      : 'Wedding website cover photo.',
  };

  return {
    title: {
      default: siteConfig.title,
      template: `%s | ${siteConfig.title}`,
    },
    description: siteConfig.description,
    keywords: dynamicKeywords,
    authors: [{ name: brandIdentity, url: config.baseUrl }],
    creator: brandIdentity,
    publisher: brandIdentity,
    ...(!isAuthenticated
      ? {
        robots: {
          index: false,
          follow: false,
        },
      }
      : {}),
    icons: {
      icon: siteConfig.favicon,
      shortcut: siteConfig.favicon,
      apple: siteConfig.favicon,
    },
    openGraph: {
      type: 'website',
      url: siteConfig.url,
      title: siteConfig.title,
      description: siteConfig.description,
      images: [ogImageObj],
      locale: 'en_US',
      siteName: siteConfig.title,
    },
    twitter: {
      card: 'summary_large_image',
      title: siteConfig.title,
      description: siteConfig.description,
      images: [siteConfig.ogImage],
    },
    metadataBase: new URL(siteConfig.url),
  };
}

interface PageMetadataOptions {
  title: string;
  description?: string;
  canonical?: string;
  noIndex?: boolean;
}

export function createPageMetadata({
  title,
  description,
  canonical,
  noIndex = false,
}: PageMetadataOptions): Metadata {
  return {
    title,
    ...(description ? { description } : {}),
    ...(canonical ? { alternates: { canonical } } : {}),
    ...(noIndex
      ? {
        robots: {
          index: false,
          follow: false,
        },
      }
      : {}),
  };
}


