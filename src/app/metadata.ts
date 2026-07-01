import type { Metadata } from 'next';
import { getAppConfig } from '@/lib/config';
import { getLocalImageDimensions } from '@/utils/image-metadata';

function interpolateKeywords(templateStr: string, config: any): string[] {
  if (!templateStr) return [];
  const interpolated = templateStr.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return config[key] !== undefined ? config[key] : match;
  });
  return interpolated.split(',').map(s => s.trim()).filter(Boolean);
}


export async function generateMetadata(): Promise<Metadata> {
  const config = await getAppConfig();
  
  const ogImageUrl = config.ogImageUrl || '/images/sunset-embrace.jpg';
  const faviconUrl = config.faviconUrl || '/assets/favicon.png';
  const seoKeywords = config.seoKeywords ?? "{{brideName}} and {{groomName}}'s wedding, wedding website, {{venueName}} wedding, {{venueCity}} {{venueState}} wedding, {{brideName}} and {{groomName}} registry, wedding details, wedding ceremony, wedding reception";

  const siteConfig = {
    title: config.seoTitle || `${config.brideName} & ${config.groomName}'s Wedding`,
    description: config.seoDescription || `Join ${config.brideName} and ${config.groomName} for their wedding celebration at the historic ${config.venueName} in ${config.venueCity}, ${config.venueState}. Find all the details about the ceremony, reception, registry, and our story.`,
    url: config.baseUrl || 'http://localhost:3000',
    ogImage: ogImageUrl.startsWith('http') ? ogImageUrl : `${config.baseUrl || 'http://localhost:3000'}${ogImageUrl}`,
    favicon: faviconUrl,
  };

  const dynamicKeywords = interpolateKeywords(seoKeywords, config);
  const dims = getLocalImageDimensions(ogImageUrl);
  const ogImageObj = {
    url: siteConfig.ogImage,
    width: dims?.width || 1200,
    height: dims?.height || 630,
    alt: `A photo of ${config.brideName} and ${config.groomName} embracing.`,
  };

  return {
    title: {
      default: siteConfig.title,
      template: `%s | ${siteConfig.title}`,
    },
    description: siteConfig.description,
    keywords: dynamicKeywords,
    authors: [{ name: config.groomName, url: config.baseUrl }],
    creator: config.groomName,
    publisher: 'Vercel',
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

