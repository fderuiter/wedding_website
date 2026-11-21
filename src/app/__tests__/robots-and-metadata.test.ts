/** @jest-environment node */

import robots from '@/app/robots';
import { generateMetadata } from '@/app/metadata';
import { getAppConfig } from '@/lib/config';

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
}));

jest.mock('@/utils/image-metadata', () => ({
  getLocalImageDimensions: jest.fn().mockResolvedValue({ width: 1200, height: 630 }),
}));

jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue(new Headers({ host: 'localhost:3000' })),
}));

const mockGetAppConfig = getAppConfig as jest.Mock;

function buildMockConfig(overrides: {
  guestPasscodeEnabled: boolean;
  allowSearchIndexing: boolean;
}) {
  return {
    id: 'global',
    partner1Name: 'Alex',
    partner2Name: 'Sam',
    brideName: 'Alex',
    groomName: 'Sam',
    weddingDate: new Date('2027-06-20T00:00:00.000Z'),
    baseUrl: 'https://celebration.example.com',
    venueName: 'Grand Conservatory',
    venueCity: 'Portland',
    venueState: 'OR',
    seoTitle: 'Alex & Sam Celebration',
    seoDescription: 'Join us in Portland',
    seoKeywords: 'wedding, celebration',
    faviconUrl: '/assets/favicon.png',
    ogImageUrl: '/api/og',
    colorPrimary: '#B91C1C',
    guestPasscodeEnabled: overrides.guestPasscodeEnabled,
    allowSearchIndexing: overrides.allowSearchIndexing,
  };
}

describe('Dynamic Search Indexing Controls (robots.ts & metadata.ts)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    {
      label: 'Password Protected + allowSearchIndexing=false (default)',
      guestPasscodeEnabled: true,
      allowSearchIndexing: false,
    },
    {
      label: 'Password Protected + allowSearchIndexing=true (visibility overrides indexing)',
      guestPasscodeEnabled: true,
      allowSearchIndexing: true,
    },
    {
      label: 'Public + allowSearchIndexing=false',
      guestPasscodeEnabled: false,
      allowSearchIndexing: false,
    },
  ])('blocks crawlers and emits noindex/nofollow when $label', async ({
    guestPasscodeEnabled,
    allowSearchIndexing,
  }) => {
    mockGetAppConfig.mockResolvedValue(
      buildMockConfig({ guestPasscodeEnabled, allowSearchIndexing })
    );

    const robotsResult = await robots();
    expect(robotsResult).toEqual({
      rules: {
        userAgent: '*',
        disallow: '/',
      },
    });
    expect(robotsResult.sitemap).toBeUndefined();

    const metadataResult = await generateMetadata();
    expect(metadataResult.robots).toEqual({
      index: false,
      follow: false,
    });
  });

  it('allows public crawling while protecting /admin/, /api/, and /guest/ only when Public AND allowSearchIndexing=true', async () => {
    mockGetAppConfig.mockResolvedValue(
      buildMockConfig({
        guestPasscodeEnabled: false,
        allowSearchIndexing: true,
      })
    );

    const robotsResult = await robots();
    expect(robotsResult).toEqual({
      rules: {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin/', '/api/', '/guest/'],
      },
      sitemap: 'http://localhost:3000/sitemap.xml',
    });

    const metadataResult = await generateMetadata();
    expect(metadataResult.robots).toEqual({
      index: true,
      follow: true,
    });
  });
});
