// This file customizes the default metadata for the app, including the favicon.
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: "Abbigayle & Frederick's Wedding",
  description: 'A joyful celebration of love uniting Abbigayle & Frederick in historic Plummer House gardens.',
  icons: {
    icon: '/assets/favicon.png',
  },
  openGraph: {
    type: 'website',
    url: 'https://wedding-website-rho-six.vercel.app/',
    title: "Abbigayle & Frederick's Wedding",
    description: 'A joyful celebration of love uniting Abbigayle & Frederick in historic Plummer House gardens.',
    images: ['https://wedding-website-rho-six.vercel.app/assets/favicon.png'],
  },
  twitter: {
    card: 'summary',
    title: "Abbigayle & Frederick's Wedding",
    description: 'A joyful celebration of love uniting Abbigayle & Frederick in historic Plummer House gardens.',
    images: ['https://wedding-website-rho-six.vercel.app/assets/favicon.png'],
  },
  metadataBase: new URL('https://wedding-website-rho-six.vercel.app'),
};
