import type { Metadata } from 'next';
import { getAppConfig } from '@/lib/config';
import { getLocalImageDimensions } from '@/utils/image-metadata';
import { getValidatedCanonicalUrl } from '@/utils/hostValidation';

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


export async function generateMetadata(): Promise<Metadata> {
  const config = await getAppConfig();
  
  const partner1 = config.partner1Name || config.brideName || '';
  const partner2 = config.partner2Name || config.groomName || '';
  const couplesNames = partner1 && partner2 ? `${partner1} & ${partner2}` : '';

  const ogImageUrl = config.ogImageUrl || '/images/placeholder.png';
  const faviconUrl = config.faviconUrl || '/assets/favicon.png';
  const seoKeywords = config.seoKeywords || '';

  let siteUrl = config.baseUrl || 'http://localhost:3000';
  try {
    const { headers } = require('next/headers');
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

  const siteConfig = {
    title: config.seoTitle || defaultTitle,
    description: config.seoDescription || defaultDescription,
    url: siteUrl,
    ogImage: ogImageUrl.startsWith('http') ? ogImageUrl : `${siteUrl}${ogImageUrl}`,
    favicon: faviconUrl,
  };

  const dynamicKeywords = interpolateKeywords(seoKeywords, config);
  const dims = getLocalImageDimensions(ogImageUrl);
  const ogImageObj = {
    url: siteConfig.ogImage,
    width: dims?.width || 1200,
    height: dims?.height || 630,
    alt: partner1 && partner2
      ? `A photo for ${partner1} and ${partner2}'s wedding.`
      : 'Wedding website cover photo.',
  };

  return {
    title: {
      default: siteConfig.title,
      template: `%s | ${siteConfig.title}`,
    },
    description: siteConfig.description,
    keywords: dynamicKeywords,
    authors: [{ name: couplesNames, url: config.baseUrl }],
    creator: couplesNames,
    publisher: couplesNames,
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

