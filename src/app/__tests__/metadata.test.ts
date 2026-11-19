import { generateMetadata, generateViewport } from '../metadata';

const mockHeaders = jest.fn().mockImplementation(() => {
  throw new Error('Headers not available');
});

jest.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    partner1Name: 'TestBride',
    partner2Name: 'TestGroom',
    brideName: 'TestBride',
    groomName: 'TestGroom',
    venueName: 'Test Venue',
    venueCity: 'TestCity',
    venueState: 'TS',
    baseUrl: 'https://testsite.com',
    colorPrimary: '#B91C1C',
  })
}));

describe('generateMetadata', () => {
  it('generates expected metadata based on config', async () => {
    const metadata = await generateMetadata();
    const title =
      typeof metadata.title === 'object' && metadata.title !== null && 'default' in metadata.title
        ? metadata.title.default
        : metadata.title;
    expect(title).toBe("TestBride & TestGroom's Wedding");
    expect(metadata.description).toBe(
      'Join TestBride and TestGroom for their wedding celebration at Test Venue in TestCity, TS.'
    );
    expect(metadata.publisher).toBe('TestBride & TestGroom');
    expect(metadata.icons).toEqual({
      icon: '/assets/favicon.png',
      shortcut: '/assets/favicon.png',
      apple: '/assets/favicon.png',
    });
    expect(metadata.openGraph).toEqual({
      type: 'website',
      url: 'https://testsite.com',
      title: "TestBride & TestGroom's Wedding",
      description: 'Join TestBride and TestGroom for their wedding celebration at Test Venue in TestCity, TS.',
      images: [
        {
          url: 'https://testsite.com/api/og',
          width: 1200,
          height: 630,
          alt: "A photo for TestBride and TestGroom's wedding.",
        },
      ],
      locale: 'en_US',
      siteName: "TestBride & TestGroom's Wedding",
    });
    expect(metadata.twitter).toEqual({
      card: 'summary_large_image',
      title: "TestBride & TestGroom's Wedding",
      description: 'Join TestBride and TestGroom for their wedding celebration at Test Venue in TestCity, TS.',
      images: ['https://testsite.com/api/og'],
    });
    expect((metadata.metadataBase as URL | null | undefined)?.href).toBe('https://testsite.com/');
  });

  it('resolves canonical URL using host and proto headers when available', async () => {
    const originalAllowedHosts = process.env.ALLOWED_HOSTS;
    process.env.ALLOWED_HOSTS = 'canonical.example.com';
    try {
      mockHeaders.mockResolvedValueOnce({
        get: (header: string) => {
          if (header === 'host') return 'canonical.example.com';
          if (header === 'x-forwarded-proto') return 'https';
          return null;
        },
      });

      const metadata = await generateMetadata();
      expect(metadata.openGraph?.url).toBe('https://canonical.example.com');
      expect((metadata.metadataBase as URL | null | undefined)?.href).toBe('https://canonical.example.com/');
    } finally {
      process.env.ALLOWED_HOSTS = originalAllowedHosts;
    }
  });
});

describe('generateViewport', () => {
  it('populates themeColor from primary theme color config', async () => {
    const viewport = await generateViewport();
    expect(viewport.themeColor).toBe('#B91C1C');
  });
});


