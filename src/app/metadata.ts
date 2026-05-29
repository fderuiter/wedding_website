import type { Metadata } from 'next';
import { getAppConfig } from '@/lib/config';

export async function generateMetadata(): Promise<Metadata> {
  const config = await getAppConfig();
  
  const siteConfig = {
    title: config.seoTitle || `${config.brideName} & ${config.groomName}'s Wedding`,
    description: config.seoDescription || `Join ${config.brideName} and ${config.groomName} for their wedding celebration at the historic ${config.venueName} in ${config.venueCity}, ${config.venueState}. Find all the details about the ceremony, reception, registry, and our story.`,
    url: config.baseUrl,
    ogImage: `${config.baseUrl}/images/sunset-embrace.jpg`,
  };

  return {
    title: {
      default: siteConfig.title,
      template: `%s | ${siteConfig.title}`,
    },
    description: siteConfig.description,
    keywords: [
      `${config.brideName} and ${config.groomName}'s wedding`,
      "wedding website",
      `${config.venueName} wedding`,
      `${config.venueCity} ${config.venueState} wedding`,
      `${config.brideName} and ${config.groomName} registry`,
      "wedding details",
      "wedding ceremony",
      "wedding reception",
    ],
    authors: [{ name: config.groomName, url: config.baseUrl }],
    creator: config.groomName,
    publisher: 'Vercel',
    icons: {
      icon: '/assets/favicon.png',
      shortcut: '/assets/favicon.png',
      apple: '/assets/favicon.png',
    },
    openGraph: {
      type: 'website',
      url: siteConfig.url,
      title: siteConfig.title,
      description: siteConfig.description,
      images: [
        {
          url: siteConfig.ogImage,
          width: 1200,
          height: 630,
          alt: `A photo of ${config.brideName} and ${config.groomName} embracing.`,
        },
      ],
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

