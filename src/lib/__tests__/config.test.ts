import { toPublicAppConfig } from '../config';

const baseConfig: any = {
  id: 'global',
  brideName: 'Abbi',
  groomName: 'Fred',
  weddingDate: new Date('2025-10-10'),
  baseUrl: 'http://localhost:3000',
  venueName: 'The Venue',
  venueAddress: '123 Venue St',
  venueCity: 'City',
  venueState: 'State',
  venueZip: '12345',
  latitude: 40.7128,
  longitude: -74.0060,
  storyText: 'Our story...',
  venueDescription: 'A lovely place...',
  travelAdvice: 'Fly here...',
  heroTitle: 'Welcome',
  heroSubtitle: 'Join us',
  seoTitle: 'Wedding',
  seoDescription: 'Wedding site',
  faviconUrl: '/assets/favicon.png',
  ogImageUrl: '/images/sunset-embrace.jpg',
  seoKeywords: "Abbi and Fred's wedding, wedding website",
  colorPrimary: '#B91C1C',
  colorSecondary: '#B45309',
  features: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('Configuration DTO Architecture', () => {
  it('toPublicAppConfig should return the configuration object', () => {
    const publicConfig = toPublicAppConfig(baseConfig);

    // Assert other fields remain intact
    expect(publicConfig.brideName).toBe('Abbi');
    expect(publicConfig.groomName).toBe('Fred');
  });

  it('toPublicAppConfig preserves faviconUrl in the public config', () => {
    const config: any = { ...baseConfig, faviconUrl: '/uploads/custom-favicon.ico' };
    const publicConfig = toPublicAppConfig(config);

    expect(publicConfig.faviconUrl).toBe('/uploads/custom-favicon.ico');
  });

  it('toPublicAppConfig preserves ogImageUrl in the public config', () => {
    const config: any = { ...baseConfig, ogImageUrl: '/uploads/my-og-image.jpg' };
    const publicConfig = toPublicAppConfig(config);

    expect(publicConfig.ogImageUrl).toBe('/uploads/my-og-image.jpg');
  });

  it('toPublicAppConfig preserves seoKeywords in the public config', () => {
    const customKeywords = '{{brideName}} wedding, {{venueName}} ceremony, wedding website';
    const config: any = { ...baseConfig, seoKeywords: customKeywords };
    const publicConfig = toPublicAppConfig(config);

    expect(publicConfig.seoKeywords).toBe(customKeywords);
  });

  it('toPublicAppConfig preserves all three new SEO fields simultaneously', () => {
    const config: any = {
      ...baseConfig,
      faviconUrl: '/uploads/abc123.ico',
      ogImageUrl: '/uploads/def456.jpg',
      seoKeywords: 'custom keyword, another keyword',
    };
    const publicConfig = toPublicAppConfig(config);

    expect(publicConfig.faviconUrl).toBe('/uploads/abc123.ico');
    expect(publicConfig.ogImageUrl).toBe('/uploads/def456.jpg');
    expect(publicConfig.seoKeywords).toBe('custom keyword, another keyword');
  });
});
