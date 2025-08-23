// This file customizes the default metadata for the app, including the favicon.
import type { Metadata } from 'next';

const siteConfig = {
  title: "Abbigayle & Frederick's Wedding",
  description: 'Join Abbigayle and Frederick for their wedding celebration at the historic Plummer House in Rochester, MN. Find all the details about the ceremony, reception, registry, and our story.',
  url: 'https://abbifred.com',
  ogImage: 'https://abbifred.com/images/sunset-embrace.jpg',
};

export const metadata: Metadata = {
  title: {
    default: siteConfig.title,
    template: `%s | ${siteConfig.title}`,
  },
  description: siteConfig.description,
  keywords: [
    "Abbigayle and Frederick's wedding",
    "wedding website",
    "Plummer House wedding",
    "Rochester MN wedding",
    "October 2025 wedding",
    "Abbigayle and Frederick registry",
    "wedding details",
    "wedding ceremony",
    "wedding reception",
    "nurse wedding",
    "Abbigayle nurse wedding",
    "Doctor of Nursing Practice wedding",
    "weddings in Rochester MN",
    "Rochester wedding venues",
    "Plummer House Rochester MN",
    "Rochester MN wedding photographer",
    "things to do in Rochester MN for wedding guests",
  ],
  authors: [{ name: 'Frederick de Ruiter', url: 'https://github.com/fderuiter' }],
  creator: 'Frederick de Ruiter',
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
        alt: `A photo of Abbigayle and Frederick embracing at sunset.`,
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
    creator: 'fderuiter',
  },
  metadataBase: new URL(siteConfig.url),
};
