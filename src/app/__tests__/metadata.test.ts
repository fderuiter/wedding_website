import { metadata } from '../metadata';

describe('metadata', () => {
  it('matches expected values', () => {
    const title = typeof metadata.title === 'object' && metadata.title !== null ? metadata.title.default : metadata.title;
    expect(title).toBe("Abbigayle & Frederick's Wedding");
    expect(metadata.description).toBe(
      'Join Abbigayle and Frederick for their wedding celebration at the historic Plummer House in Rochester, MN. Find all the details about the ceremony, reception, registry, and our story.'
    );
    expect(metadata.icons).toEqual({
      icon: '/favicon.ico',
      shortcut: '/favicon.ico',
      apple: '/favicon.ico',
    });
    expect(metadata.openGraph).toEqual({
      type: 'website',
      url: 'https://abbifred.com',
      title: "Abbigayle & Frederick's Wedding",
      description: 'Join Abbigayle and Frederick for their wedding celebration at the historic Plummer House in Rochester, MN. Find all the details about the ceremony, reception, registry, and our story.',
      images: [
        {
          url: 'https://abbifred.com/images/sunset-embrace.jpg',
          width: 1200,
          height: 630,
          alt: 'A photo of Abbigayle and Frederick embracing at sunset.',
        },
      ],
      locale: 'en_US',
      siteName: "Abbigayle & Frederick's Wedding",
    });
    expect(metadata.twitter).toEqual({
      card: 'summary_large_image',
      title: "Abbigayle & Frederick's Wedding",
      description: 'Join Abbigayle and Frederick for their wedding celebration at the historic Plummer House in Rochester, MN. Find all the details about the ceremony, reception, registry, and our story.',
      images: ['https://abbifred.com/images/sunset-embrace.jpg'],
      creator: '@fderuiter',
    });
    expect(metadata.metadataBase?.href).toBe('https://abbifred.com/');
  });
});
