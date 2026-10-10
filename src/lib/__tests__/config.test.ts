import { toPublicAppConfig, isMultisiteEnabled, APP_DEFAULTS, getEnvConfigOverrides, getAppConfig } from '../config';
import { prisma } from '../prisma';

jest.mock('../prisma', () => ({
  prisma: {
    appConfig: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    contentNode: {
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn(),
    },
  },
}));

const baseConfig: any = {
  id: 'global',
  partner1Name: 'Jane',
  partner2Name: 'John',
  brideName: 'Jane',
  groomName: 'John',
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
  ogImageUrl: '/images/placeholder.png',
  seoKeywords: "Jane and John's wedding, wedding website",
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
    expect(publicConfig.brideName).toBe('Jane');
    expect(publicConfig.groomName).toBe('John');
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

  it('toPublicAppConfig strips sensitive setup properties and credentials', () => {
    const configWithSecrets: any = {
      ...baseConfig,
      adminPassword: 'SuperSecretPassword123!',
      smtpPassword: 'smtp-pass-value',
      apiSecret: 'sk_live_123456789',
      stripeSecretKey: 'sk_test_987654321',
      databaseUrlCredentials: 'postgres://user:pass@host/db',
      authToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      guestPasscode: 'wedding2026',
    };

    const publicConfig: any = toPublicAppConfig(configWithSecrets);

    expect(publicConfig.brideName).toBe('Jane');
    expect(publicConfig.seoKeywords).toBe("Jane and John's wedding, wedding website");
    expect(publicConfig.adminPassword).toBeUndefined();
    expect(publicConfig.smtpPassword).toBeUndefined();
    expect(publicConfig.apiSecret).toBeUndefined();
    expect(publicConfig.stripeSecretKey).toBeUndefined();
    expect(publicConfig.databaseUrlCredentials).toBeUndefined();
    expect(publicConfig.authToken).toBeUndefined();
    expect(publicConfig.guestPasscode).toBeUndefined();
  });
});

describe('Configuration System Layers & Precedence', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('APP_DEFAULTS contains generic technical defaults with no personal wedding content', () => {
    expect(APP_DEFAULTS.brideName).toBe('');
    expect(APP_DEFAULTS.groomName).toBe('');
    expect(APP_DEFAULTS.venueName).toBe('');
    expect(APP_DEFAULTS.venueCity).toBe('');
    expect(APP_DEFAULTS.venueState).toBe('');
    expect(APP_DEFAULTS.brideName).not.toContain('Abbigayle');
    expect(APP_DEFAULTS.groomName).not.toContain('Frederick');
    expect(APP_DEFAULTS.venueName).not.toContain('Plummer');
  });

  it('getEnvConfigOverrides extracts SITE_* environment variable overrides', () => {
    process.env.SITE_BRIDE_NAME = 'Alice';
    process.env.SITE_GROOM_NAME = 'Bob';
    process.env.SITE_VENUE_NAME = 'Sunset Gardens';
    process.env.SITE_SHOW_COUNTDOWN = 'false';

    const overrides = getEnvConfigOverrides();

    expect(overrides.brideName).toBe('Alice');
    expect(overrides.groomName).toBe('Bob');
    expect(overrides.venueName).toBe('Sunset Gardens');
    expect(overrides.showCountdown).toBe(false);
  });

  it('getAppConfig applies deterministic precedence (Env Overrides > DB Config > Application Defaults)', async () => {
    (prisma.appConfig.findUnique as jest.Mock).mockResolvedValue({
      id: 'global',
      brideName: 'DB Bride',
      groomName: 'DB Groom',
      weddingDate: new Date('2026-08-15T00:00:00.000Z'),
      baseUrl: 'https://db-site.com',
      venueName: 'DB Venue',
      venueAddress: '123 DB Way',
      venueCity: 'DBCity',
      venueState: 'CA',
      venueZip: '90001',
      latitude: 34.0522,
      longitude: -118.2437,
      storyText: 'DB Story',
      venueDescription: 'DB Venue Description',
      travelAdvice: 'DB Travel',
      heroTitle: 'DB Hero',
      heroSubtitle: 'DB Subtitle',
      seoTitle: 'DB SEO Title',
      seoDescription: 'DB SEO Desc',
      faviconUrl: '/assets/favicon.png',
      ogImageUrl: '/assets/og-image.jpg',
      seoKeywords: 'db, keywords',
      colorPrimary: '#123456',
      colorSecondary: '#654321',
      timezone: 'America/Los_Angeles',
      showCountdown: true,
      showAddToCalendar: true,
      features: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      subdomain: null,
    });

    process.env.SITE_BRIDE_NAME = 'Env Bride Override';

    const effectiveConfig = await getAppConfig('global');

    expect(effectiveConfig.brideName).toBe('Env Bride Override');
    expect(effectiveConfig.groomName).toBe('DB Groom');
    expect(effectiveConfig.venueName).toBe('DB Venue');
  });

  it('fails clearly with descriptive error if invalid config is parsed in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SITE_LATITUDE = 'invalid-latitude';

    (prisma.appConfig.findUnique as jest.Mock).mockResolvedValue({
      id: 'global',
      brideName: 'Test',
      groomName: 'Test',
      weddingDate: new Date(),
      baseUrl: 'http://localhost',
      venueName: 'Venue',
      venueAddress: 'Address',
      venueCity: 'City',
      venueState: 'State',
      venueZip: '00000',
      latitude: 0,
      longitude: 0,
      storyText: '',
      venueDescription: '',
      travelAdvice: '',
      heroTitle: '',
      heroSubtitle: '',
      seoTitle: '',
      seoDescription: '',
      faviconUrl: '/assets/favicon.png',
      ogImageUrl: '/assets/og-image.jpg',
      seoKeywords: '',
      colorPrimary: '#000000',
      colorSecondary: '#000000',
      timezone: 'UTC',
      showCountdown: true,
      showAddToCalendar: true,
      features: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      subdomain: null,
    });

    await expect(getAppConfig('global')).rejects.toThrow(/Production Configuration Validation Failure/);
  });
});

describe('Single-Site vs Multi-Site Config Resolution', () => {
  const originalEnv = process.env.MULTISITE_ENABLED;

  afterEach(() => {
    process.env.MULTISITE_ENABLED = originalEnv;
  });

  it('isMultisiteEnabled returns false by default', () => {
    delete process.env.MULTISITE_ENABLED;
    expect(isMultisiteEnabled()).toBe(false);
  });

  it('isMultisiteEnabled returns true when MULTISITE_ENABLED=true', () => {
    process.env.MULTISITE_ENABLED = 'true';
    expect(isMultisiteEnabled()).toBe(true);
  });

  it('toPublicAppConfig includes multisiteEnabled flag', () => {
    process.env.MULTISITE_ENABLED = 'false';
    const publicConfig = toPublicAppConfig(baseConfig);
    expect(publicConfig.multisiteEnabled).toBe(false);
  });
});

describe('Request-Level Configuration Memoization (React cache)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deduplicates multiple calls to getAppConfig with identical arguments within a request', async () => {
    (prisma.appConfig.findUnique as jest.Mock).mockResolvedValue({
      ...baseConfig,
      id: 'global',
      brideName: 'Cached Bride',
    });

    const [res1, res2, res3] = await Promise.all([
      getAppConfig('global'),
      getAppConfig('global'),
      getAppConfig('global'),
    ]);

    expect(res1).toEqual(res2);
    expect(res2).toEqual(res3);
    expect(res1.brideName).toBe('Cached Bride');

    // prisma.appConfig.findUnique should only have been called ONCE despite 3 invocations
    expect(prisma.appConfig.findUnique).toHaveBeenCalledTimes(1);
  });

  it('memoizes separate calls independently when different arguments are provided', async () => {
    process.env.MULTISITE_ENABLED = 'true';

    (prisma.appConfig.findUnique as jest.Mock).mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === 'site-a') {
        return { ...baseConfig, id: 'site-a', brideName: 'Bride A' };
      }
      if (where.id === 'site-b') {
        return { ...baseConfig, id: 'site-b', brideName: 'Bride B' };
      }
      return { ...baseConfig, id: 'global', brideName: 'Global Bride' };
    });

    const [resA, resB] = await Promise.all([
      getAppConfig('site-a'),
      getAppConfig('site-b'),
    ]);

    expect(resA.brideName).toBe('Bride A');
    expect(resB.brideName).toBe('Bride B');

    // Each distinct argument triggers its own DB call
    expect(prisma.appConfig.findUnique).toHaveBeenCalledWith({ where: { id: 'site-a' } });
    expect(prisma.appConfig.findUnique).toHaveBeenCalledWith({ where: { id: 'site-b' } });

    delete process.env.MULTISITE_ENABLED;
  });

  it('fetches fresh configuration on subsequent HTTP requests after settings update', async () => {
    // Request 1: Initial load
    (prisma.appConfig.findUnique as jest.Mock).mockResolvedValueOnce({
      ...baseConfig,
      id: 'global',
      brideName: 'Initial Bride',
    });

    const req1Config = await getAppConfig('global');
    expect(req1Config.brideName).toBe('Initial Bride');
    expect(prisma.appConfig.findUnique).toHaveBeenCalledTimes(1);

    // Admin updates settings in database (represented by a new mock return value for Request 2)
    (prisma.appConfig.findUnique as jest.Mock).mockResolvedValueOnce({
      ...baseConfig,
      id: 'global',
      brideName: 'Updated Bride',
    });

    // Request 2: Next page request (simulating fresh HTTP request lifecycle)
    // Clear request scope or fallback store to simulate next request
    if (typeof globalThis.globalFallbackStore !== 'undefined') {
      globalThis.globalFallbackStore.clear();
    }

    const req2Config = await getAppConfig('global');
    expect(req2Config.brideName).toBe('Updated Bride');
    expect(prisma.appConfig.findUnique).toHaveBeenCalledTimes(2);
  });
});
