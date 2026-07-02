import { generateMetadata } from '../metadata';
import { getAppConfig } from '@/lib/config';


jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
}));

jest.mock('@/utils/image-metadata', () => ({
  getLocalImageDimensions: jest.fn(),
}));

const mockGetAppConfig = getAppConfig as jest.MockedFunction<typeof getAppConfig>;

import { getLocalImageDimensions } from '@/utils/image-metadata';
const mockGetLocalImageDimensions = getLocalImageDimensions as jest.Mock;

const baseConfig = {
  brideName: 'Alice',
  groomName: 'Bob',
  venueName: 'Grand Hall',
  venueCity: 'Springfield',
  venueState: 'IL',
  baseUrl: 'https://example.com',
  seoTitle: '',
  seoDescription: '',
  faviconUrl: '/assets/favicon.png',
  ogImageUrl: '/images/sunset-embrace.jpg',
  seoKeywords: "{{brideName}} and {{groomName}}'s wedding, wedding website, {{venueName}} wedding, {{venueCity}} {{venueState}} wedding",
};

describe('generateMetadata - new SEO fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('faviconUrl from config', () => {
    it('uses faviconUrl from config for all icon fields', async () => {
      mockGetLocalImageDimensions.mockReturnValue({ width: 512, height: 512 });
      mockGetAppConfig.mockResolvedValue({
        ...baseConfig,
        faviconUrl: '/custom/my-favicon.ico',
      } as any);

      const metadata = await generateMetadata();

      expect(metadata.icons).toEqual({
        icon: '/custom/my-favicon.ico',
        shortcut: '/custom/my-favicon.ico',
        apple: '/custom/my-favicon.ico',
      });
    });

    it('falls back to /assets/favicon.png when faviconUrl is empty', async () => {
      mockGetLocalImageDimensions.mockReturnValue({ width: 32, height: 32 });
      mockGetAppConfig.mockResolvedValue({
        ...baseConfig,
        faviconUrl: '',
      } as any);

      const metadata = await generateMetadata();

      expect(metadata.icons).toEqual({
        icon: '/assets/favicon.png',
        shortcut: '/assets/favicon.png',
        apple: '/assets/favicon.png',
      });
    });
  });

  describe('ogImageUrl handling', () => {
    it('prepends baseUrl when ogImageUrl is a relative path', async () => {
      mockGetLocalImageDimensions.mockReturnValue({ width: 1200, height: 630 });
      mockGetAppConfig.mockResolvedValue({
        ...baseConfig,
        ogImageUrl: '/images/my-og-image.jpg',
      } as any);

      const metadata = await generateMetadata();
      const ogImages = (metadata.openGraph as any)?.images as any[];

      expect(ogImages[0].url).toBe('https://example.com/images/my-og-image.jpg');
    });

    it('uses ogImageUrl as-is when it is an absolute URL', async () => {
      mockGetLocalImageDimensions.mockReturnValue(null);
      mockGetAppConfig.mockResolvedValue({
        ...baseConfig,
        ogImageUrl: 'https://cdn.example.com/og-image.jpg',
      } as any);

      const metadata = await generateMetadata();
      const ogImages = (metadata.openGraph as any)?.images as any[];

      expect(ogImages[0].url).toBe('https://cdn.example.com/og-image.jpg');
    });

    it('uses actual image dimensions when file is readable', async () => {
      mockGetLocalImageDimensions.mockReturnValue({ width: 800, height: 400 });
      mockGetAppConfig.mockResolvedValue({
        ...baseConfig,
        ogImageUrl: '/images/custom.jpg',
      } as any);

      const metadata = await generateMetadata();
      const ogImages = (metadata.openGraph as any)?.images as any[];

      expect(ogImages[0].width).toBe(800);
      expect(ogImages[0].height).toBe(400);
    });

    it('falls back to 1200x630 when local image file cannot be read', async () => {
      mockGetLocalImageDimensions.mockImplementation(() => {
        return null;
      });
      mockGetAppConfig.mockResolvedValue({
        ...baseConfig,
        ogImageUrl: '/images/nonexistent.jpg',
      } as any);

      const metadata = await generateMetadata();
      const ogImages = (metadata.openGraph as any)?.images as any[];

      expect(ogImages[0].width).toBe(1200);
      expect(ogImages[0].height).toBe(630);
    });

    it('falls back to 1200x630 when ogImageUrl is absolute (no local file read)', async () => {
      mockGetAppConfig.mockResolvedValue({
        ...baseConfig,
        ogImageUrl: 'https://external.com/og.jpg',
      } as any);

      const metadata = await generateMetadata();
      const ogImages = (metadata.openGraph as any)?.images as any[];

      expect(ogImages[0].width).toBe(1200);
      expect(ogImages[0].height).toBe(630);
mockGetLocalImageDimensions.mockReturnValue(null);
    });

    it('falls back to default ogImageUrl when config ogImageUrl is empty', async () => {
      mockGetLocalImageDimensions.mockReturnValue({ width: 1024, height: 768 });
      mockGetAppConfig.mockResolvedValue({
        ...baseConfig,
        ogImageUrl: '',
      } as any);

      const metadata = await generateMetadata();
      const ogImages = (metadata.openGraph as any)?.images as any[];

      // Falls back to '/images/sunset-embrace.jpg'
      expect(ogImages[0].url).toBe('https://example.com/images/sunset-embrace.jpg');
    });

    it('includes og image alt text with bride and groom names', async () => {
      mockGetLocalImageDimensions.mockReturnValue({ width: 1200, height: 630 });
      mockGetAppConfig.mockResolvedValue({
        ...baseConfig,
        brideName: 'Emma',
        groomName: 'James',
      } as any);

      const metadata = await generateMetadata();
      const ogImages = (metadata.openGraph as any)?.images as any[];

      expect(ogImages[0].alt).toBe('A photo of Emma and James embracing.');
    });
  });

  describe('seoKeywords interpolation', () => {
    it('interpolates template variables with config values', async () => {
      mockGetLocalImageDimensions.mockReturnValue({ width: 1200, height: 630 });
      mockGetAppConfig.mockResolvedValue({
        ...baseConfig,
        brideName: 'Alice',
        groomName: 'Bob',
        venueName: 'Grand Hall',
        venueCity: 'Springfield',
        venueState: 'IL',
        seoKeywords: "{{brideName}} and {{groomName}}'s wedding, {{venueName}} wedding, {{venueCity}} {{venueState}} wedding",
      } as any);

      const metadata = await generateMetadata();

      expect(metadata.keywords).toContain("Alice and Bob's wedding");
      expect(metadata.keywords).toContain('Grand Hall wedding');
      expect(metadata.keywords).toContain('Springfield IL wedding');
    });

    it('leaves unknown template variables as-is', async () => {
      mockGetLocalImageDimensions.mockReturnValue({ width: 1200, height: 630 });
      mockGetAppConfig.mockResolvedValue({
        ...baseConfig,
        seoKeywords: '{{brideName}} wedding, {{unknownVar}} keyword',
        brideName: 'Alice',
      } as any);

      const metadata = await generateMetadata();

      expect(metadata.keywords).toContain('Alice wedding');
      expect(metadata.keywords).toContain('{{unknownVar}} keyword');
    });

    it('returns empty keywords array when seoKeywords is empty string', async () => {
      mockGetLocalImageDimensions.mockReturnValue({ width: 1200, height: 630 });
      mockGetAppConfig.mockResolvedValue({
        ...baseConfig,
        seoKeywords: '',
      } as any);

      const metadata = await generateMetadata();

      expect(metadata.keywords).toEqual([]);
    });

    it('splits comma-separated keywords and trims whitespace', async () => {
      mockGetLocalImageDimensions.mockReturnValue({ width: 1200, height: 630 });
      mockGetAppConfig.mockResolvedValue({
        ...baseConfig,
        seoKeywords: '  wedding website , ceremony details ,  reception info  ',
      } as any);

      const metadata = await generateMetadata();

      expect(metadata.keywords).toEqual(['wedding website', 'ceremony details', 'reception info']);
    });

    it('filters out empty keywords after splitting', async () => {
      mockGetLocalImageDimensions.mockReturnValue({ width: 1200, height: 630 });
      mockGetAppConfig.mockResolvedValue({
        ...baseConfig,
        seoKeywords: 'keyword one,,keyword two,  ,keyword three',
      } as any);

      const metadata = await generateMetadata();

      expect(metadata.keywords).toEqual(['keyword one', 'keyword two', 'keyword three']);
    });

    it('uses default seoKeywords template when seoKeywords is not in config', async () => {
      mockGetLocalImageDimensions.mockReturnValue({ width: 1200, height: 630 });
      const configWithoutKeywords = { ...baseConfig } as any;
      delete configWithoutKeywords.seoKeywords;
      mockGetAppConfig.mockResolvedValue({
        ...configWithoutKeywords,
        brideName: 'Alice',
        groomName: 'Bob',
      });

      const metadata = await generateMetadata();

      // Default template should still interpolate brideName and groomName
      expect(Array.isArray(metadata.keywords)).toBe(true);
      expect((metadata.keywords as string[]).some(k => k.includes('Alice'))).toBe(true);
      expect((metadata.keywords as string[]).some(k => k.includes('Bob'))).toBe(true);
    });
  });

  describe('twitter card metadata', () => {
    it('uses absolute ogImageUrl in twitter images when ogImageUrl is relative', async () => {
      mockGetLocalImageDimensions.mockReturnValue({ width: 1200, height: 630 });
      mockGetAppConfig.mockResolvedValue({
        ...baseConfig,
        ogImageUrl: '/images/custom-og.jpg',
      } as any);

      const metadata = await generateMetadata();

      expect((metadata.twitter as any)?.images).toEqual([
        'https://example.com/images/custom-og.jpg',
      ]);
    });

    it('uses ogImageUrl directly in twitter images when it is absolute', async () => {
      mockGetLocalImageDimensions.mockReturnValue(null);
      mockGetAppConfig.mockResolvedValue({
        ...baseConfig,
        ogImageUrl: 'https://cdn.example.com/og.jpg',
      } as any);

      const metadata = await generateMetadata();

      expect((metadata.twitter as any)?.images).toEqual([
        'https://cdn.example.com/og.jpg',
      ]);
    });
  });
});