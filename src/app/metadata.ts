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
  const couplesNames = `${partner1} & ${partner2}`;

  const ogImageUrl = config.ogImageUrl || '/images/sunset-embrace.jpg';
  const faviconUrl = config.faviconUrl || '/assets/favicon.png';
  const seoKeywords = config.seoKeywords ?? "{{partner1Name}} and {{partner2Name}}'s wedding, wedding website, {{venueName}} wedding, {{venueCity}} {{venueState}} wedding, {{partner1Name}} and {{partner2Name}} registry, wedding details, wedding ceremony, wedding reception";

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

  const siteConfig = {
    title: config.seoTitle || `${couplesNames}'s Wedding`,
    description: config.seoDescription || `Join ${partner1} and ${partner2} for their wedding celebration at the historic ${config.venueName} in ${config.venueCity}, ${config.venueState}. Find all the details about the ceremony, reception, registry, and our story.`,
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
    alt: `A photo of ${partner1} and ${partner2} embracing.`,
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

