import { headers } from 'next/headers';
import { toPublicAppConfig, toAdminAppConfig, isMultisiteEnabled, APP_DEFAULTS, getAppConfig } from '../config';
import type { AdminAppConfig } from '../config';
import { PublicAppConfigSchema } from '../../features/content/schemas';
import { prisma } from '../prisma';

jest.mock('next/headers', () => ({
  headers: jest.fn(() => {
    throw new Error('headers() called outside request scope');
  }),
}));

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

  it('toPublicAppConfig preserves contactEmail in the public config', () => {
    const config: any = { ...baseConfig, contactEmail: 'hosts@wedding.example' };
    const publicConfig = toPublicAppConfig(config);

    expect(publicConfig.contactEmail).toBe('hosts@wedding.example');
  });

  it('toPublicAppConfig preserves faviconUrl in the public config', () => {
    const config: any = { ...baseConfig, faviconUrl: '/uploads/custom-favicon.ico' };
    const publicConfig = toPublicAppConfig(config);

    expect(publicConfig.faviconUrl).toBe('/uploads/custom-favicon.ico');
  });

  it('applies SITE_HERO_IMAGE_URL, SITE_BRAND_WATERMARK_URL, and SITE_BADGE_GRAPHIC_URL environment variable overrides', async () => {
    process.env.SITE_HERO_IMAGE_URL = 'https://cdn.example.com/hero.jpg';
    process.env.SITE_HERO_IMAGE_ALT = 'Hero background';
    process.env.SITE_BRAND_WATERMARK_URL = '/images/watermark.png';
    process.env.SITE_BRAND_WATERMARK_ALT = 'Brand Watermark';
    process.env.SITE_BADGE_GRAPHIC_URL = '/images/badge.png';
    process.env.SITE_BADGE_GRAPHIC_ALT = 'Badge Graphic';

    (prisma.appConfig.findUnique as jest.Mock).mockResolvedValue({
      ...baseConfig,
      heroImageUrl: null,
      brandWatermarkUrl: null,
      badgeGraphicUrl: null,
    });

    const effectiveConfig = await getAppConfig('global');

    expect(effectiveConfig.heroImageUrl).toBe('https://cdn.example.com/hero.jpg');
    expect(effectiveConfig.heroImageAlt).toBe('Hero background');
    expect(effectiveConfig.brandWatermarkUrl).toBe('/images/watermark.png');
    expect(effectiveConfig.brandWatermarkAlt).toBe('Brand Watermark');
    expect(effectiveConfig.badgeGraphicUrl).toBe('/images/badge.png');
    expect(effectiveConfig.badgeGraphicAlt).toBe('Badge Graphic');
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
      emailProvider: 'smtp',
      smtpHost: 'smtp.example.invalid',
      smtpPort: 465,
      smtpUser: 'mailer@example.invalid',
      smtpPass: 'smtp-secret-pass',
      smtpFrom: 'noreply@example.invalid',
      smtpSecure: true,
      resendApiKey: 're_live_secret_123',
      resendFrom: 'resend@example.invalid',
      sendgridApiKey: 'SG.live_secret_456',
      sendgridFrom: 'sendgrid@example.invalid',
      smsProvider: 'twilio',
      twilioAccountSid: 'AC_SYNTHETIC_TWILIO_SID',
      twilioAuthToken: 'twilio-secret-auth-token',
      twilioFromNumber: '+15550199999',
      broadcastBatchSize: 25,
      broadcastBatchDelayMs: 1000,
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
    expect(publicConfig.emailProvider).toBeUndefined();
    expect(publicConfig.smtpHost).toBeUndefined();
    expect(publicConfig.smtpPort).toBeUndefined();
    expect(publicConfig.smtpUser).toBeUndefined();
    expect(publicConfig.smtpPass).toBeUndefined();
    expect(publicConfig.smtpFrom).toBeUndefined();
    expect(publicConfig.smtpSecure).toBeUndefined();
    expect(publicConfig.resendApiKey).toBeUndefined();
    expect(publicConfig.resendFrom).toBeUndefined();
    expect(publicConfig.sendgridApiKey).toBeUndefined();
    expect(publicConfig.sendgridFrom).toBeUndefined();
    expect(publicConfig.smsProvider).toBeUndefined();
    expect(publicConfig.twilioAccountSid).toBeUndefined();
    expect(publicConfig.twilioAuthToken).toBeUndefined();
    expect(publicConfig.twilioFromNumber).toBeUndefined();
    expect(publicConfig.broadcastBatchSize).toBeUndefined();
    expect(publicConfig.broadcastBatchDelayMs).toBeUndefined();
    expect(publicConfig.apiSecret).toBeUndefined();
    expect(publicConfig.stripeSecretKey).toBeUndefined();
    expect(publicConfig.databaseUrlCredentials).toBeUndefined();
    expect(publicConfig.authToken).toBeUndefined();
    expect(publicConfig.guestPasscode).toBeUndefined();
  });

  it('PublicAppConfigSchema strictly rejects unknown and credential keys', () => {
    const validResult = PublicAppConfigSchema.safeParse(baseConfig);
    expect(validResult.success).toBe(true);

    const withSmtpPass = PublicAppConfigSchema.safeParse({
      ...baseConfig,
      smtpPass: 'secret',
    });
    expect(withSmtpPass.success).toBe(false);

    const withTwilioSid = PublicAppConfigSchema.safeParse({
      ...baseConfig,
      twilioAccountSid: 'AC12345',
    });
    expect(withTwilioSid.success).toBe(false);
  });

  it('toAdminAppConfig omits raw secrets and returns boolean presence flags alongside non-secret messaging fields', () => {
    const adminConfig: AdminAppConfig = toAdminAppConfig({
      ...baseConfig,
      emailProvider: 'smtp',
      smtpHost: 'smtp.mailgun.org',
      smtpPort: 587,
      smtpUser: 'postmaster@wedding.example',
      smtpPass: 'super-secret-smtp-pass',
      smtpFrom: 'wedding@example.com',
      smtpSecure: true,
      resendApiKey: '',
      resendFrom: 'resend@example.com',
      sendgridApiKey: 'SG.secret',
      sendgridFrom: 'sg@example.com',
      smsProvider: 'twilio',
      twilioAccountSid: 'AC999888777',
      twilioAuthToken: '   ',
      twilioFromNumber: '+15551234567',
      broadcastBatchSize: 40,
      broadcastBatchDelayMs: 750,
    });

    expect(adminConfig.smtpHost).toBe('smtp.mailgun.org');
    expect(adminConfig.smtpUser).toBe('postmaster@wedding.example');
    expect(adminConfig.twilioAccountSid).toBe('AC999888777');
    expect(adminConfig.hasSmtpPass).toBe(true);
    expect(adminConfig.hasResendApiKey).toBe(false);
    expect(adminConfig.hasSendgridApiKey).toBe(true);
    expect(adminConfig.hasTwilioAuthToken).toBe(false);

    expect('smtpPass' in adminConfig).toBe(false);
    expect('resendApiKey' in adminConfig).toBe(false);
    expect('sendgridApiKey' in adminConfig).toBe(false);
    expect('twilioAuthToken' in adminConfig).toBe(false);
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
    expect(APP_DEFAULTS.contactEmail).toBe('');
    expect(APP_DEFAULTS.brideName).toBe('');
    expect(APP_DEFAULTS.groomName).toBe('');
    expect(APP_DEFAULTS.venueName).toBe('');
    expect(APP_DEFAULTS.venueCity).toBe('');
    expect(APP_DEFAULTS.venueState).toBe('');
    expect(APP_DEFAULTS.brideName).not.toContain('Abbigayle');
    expect(APP_DEFAULTS.groomName).not.toContain('Frederick');
    expect(APP_DEFAULTS.venueName).not.toContain('Plummer');
  });

  it('extracts SITE_* environment variable overrides via getAppConfig', async () => {
    (prisma.appConfig.findUnique as jest.Mock).mockResolvedValue({
      id: 'global',
      brideName: 'Original Bride',
      groomName: 'Original Groom',
      weddingDate: new Date('2026-08-15T00:00:00.000Z'),
      baseUrl: 'https://site.com',
      venueName: 'Original Venue',
      venueAddress: '123 Way',
      venueCity: 'City',
      venueState: 'CA',
      venueZip: '90001',
      latitude: 34.0522,
      longitude: -118.2437,
      storyText: 'Story',
      venueDescription: 'Desc',
      travelAdvice: 'Travel',
      heroTitle: 'Hero',
      heroSubtitle: 'Sub',
      seoTitle: 'SEO Title',
      seoDescription: 'SEO Desc',
      faviconUrl: '/assets/favicon.png',
      ogImageUrl: '/assets/og-image.jpg',
      seoKeywords: 'keywords',
      colorPrimary: '#123456',
      colorSecondary: '#654321',
      timezone: 'UTC',
      showCountdown: true,
      showAddToCalendar: true,
      features: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      subdomain: null,
    });

    process.env.SITE_BRIDE_NAME = 'Alice';
    process.env.SITE_GROOM_NAME = 'Bob';
    process.env.SITE_VENUE_NAME = 'Sunset Gardens';
    process.env.SITE_CONTACT_EMAIL = 'custom-hosts@wedding.example';
    process.env.SITE_SHOW_COUNTDOWN = 'false';
    process.env.SITE_BRAND_MONOGRAM = 'A & B';
    process.env.SITE_BRAND_LOGO_URL = '/images/tenant-logo.svg';
    process.env.SITE_BRAND_LOGO_ALT = 'Tenant Brand Logo';

    const config = await getAppConfig('global');

    expect(config.brideName).toBe('Alice');
    expect(config.groomName).toBe('Bob');
    expect(config.venueName).toBe('Sunset Gardens');
    expect(config.contactEmail).toBe('custom-hosts@wedding.example');
    expect(config.showCountdown).toBe(false);
    expect(config.brandMonogram).toBe('A & B');
    expect(config.brandLogoUrl).toBe('/images/tenant-logo.svg');
    expect(config.brandLogoAlt).toBe('Tenant Brand Logo');
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

  it('merges sparse themeTokens with deterministic precedence (DB themeTokens < SITE_THEME_TOKENS) without hydrating preset defaults', async () => {
    (prisma.appConfig.findUnique as jest.Mock).mockResolvedValue({
      ...baseConfig,
      id: 'global',
      themePreset: 'modern',
      themeTokens: {
        '--btn-radius': '12px',
        '--custom-db-token': 'from-db',
      },
    });

    process.env.SITE_THEME_TOKENS = '{"--btn-radius": "20px", "--custom-env-token": "from-env"}';

    const effectiveConfig = await getAppConfig('global');

    // Modern preset default for --btn-radius is 0.5rem (8px), DB had 12px, and env had 20px
    expect(effectiveConfig.themeTokens['--btn-radius']).toBe('20px');
    expect(effectiveConfig.themeTokens['--custom-db-token']).toBe('from-db');
    expect(effectiveConfig.themeTokens['--custom-env-token']).toBe('from-env');
    // Uncustomized preset defaults stay separate in presets.ts rather than polluting themeTokens
    expect(effectiveConfig.themeTokens['--btn-font-weight']).toBeUndefined();
  });

  it('strips legacy hydrated classic preset tokens when loading another preset while keeping custom overrides', async () => {
    const { getPresetTokens } = await import('@/lib/theme/presets');
    const classicLightDump = getPresetTokens('classic', 'light') as unknown as Record<string, unknown>;
    const pollutedTokens: Record<string, string> = {};
    for (const [k, v] of Object.entries(classicLightDump)) {
      if (k.startsWith('--') && typeof v === 'string') {
        pollutedTokens[k] = v;
      }
    }
    pollutedTokens['--btn-radius'] = '14px';

    (prisma.appConfig.findUnique as jest.Mock).mockResolvedValue({
      ...baseConfig,
      id: 'global',
      themePreset: 'romantic',
      themeTokens: pollutedTokens,
    });

    const effectiveConfig = await getAppConfig('global');
    expect(effectiveConfig.themeTokens).toEqual({
      '--btn-radius': '14px',
    });
  });

  it('fails clearly with descriptive error if invalid config is parsed in production', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
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

  it('prefers x-forwarded-host over host when MULTISITE_ENABLED=true and validates against ALLOWED_HOSTS', async () => {
    const originalAllowedHosts = process.env.ALLOWED_HOSTS;
    process.env.MULTISITE_ENABLED = 'true';
    process.env.ALLOWED_HOSTS = 'localhost,127.0.0.1,*.wedding.example,wedding.example';

    const globalWithStore = globalThis as typeof globalThis & {
      globalFallbackStore?: Map<string, unknown>;
    };

    try {
      // 1. Reverse proxy sets x-forwarded-host while internal host is 127.0.0.1:3000
      globalWithStore.globalFallbackStore?.clear();
      (headers as jest.Mock).mockResolvedValueOnce(
        new Headers({
          'x-forwarded-host': 'smiths.wedding.example, ingress.internal',
          host: '127.0.0.1:3000',
        })
      );
      (prisma.appConfig.findFirst as jest.Mock).mockImplementation(
        async ({ where }: { where: { subdomain?: string } }) => {
          if (where.subdomain === 'smiths') {
            return { ...baseConfig, id: 'smiths-id', subdomain: 'smiths', partner1Name: 'Riley', brideName: 'Riley' };
          }
          return null;
        }
      );
      (prisma.appConfig.findUnique as jest.Mock).mockResolvedValue({
        ...baseConfig,
        id: 'global',
        partner1Name: 'Global',
        brideName: 'Global',
      });

      const forwardedResolved = await getAppConfig();
      expect(prisma.appConfig.findFirst).toHaveBeenCalledWith({ where: { subdomain: 'smiths' } });
      expect(forwardedResolved.partner1Name).toBe('Riley');

      // 2. Spoofed x-forwarded-host rejected by isHostAllowed -> falls back to global profile
      globalWithStore.globalFallbackStore?.clear();
      (prisma.appConfig.findFirst as jest.Mock).mockClear();
      (prisma.appConfig.findUnique as jest.Mock).mockClear();
      (headers as jest.Mock).mockResolvedValueOnce(
        new Headers({
          'x-forwarded-host': 'evil.attacker.invalid',
          host: 'smiths.wedding.example',
        })
      );

      const spoofedResolved = await getAppConfig();
      expect(prisma.appConfig.findFirst).not.toHaveBeenCalled();
      expect(prisma.appConfig.findUnique).toHaveBeenCalledWith({ where: { id: 'global' } });
      expect(spoofedResolved.partner1Name).toBe('Global');
    } finally {
      process.env.ALLOWED_HOSTS = originalAllowedHosts;
      (headers as jest.Mock).mockImplementation(() => {
        throw new Error('headers() called outside request scope');
      });
    }
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
      partner1Name: 'Cached Bride',
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
        return { ...baseConfig, id: 'site-a', partner1Name: 'Bride A', brideName: 'Bride A' };
      }
      if (where.id === 'site-b') {
        return { ...baseConfig, id: 'site-b', partner1Name: 'Bride B', brideName: 'Bride B' };
      }
      return { ...baseConfig, id: 'global', partner1Name: 'Global Bride', brideName: 'Global Bride' };
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
      partner1Name: 'Initial Bride',
      brideName: 'Initial Bride',
    });

    const req1Config = await getAppConfig('global');
    expect(req1Config.brideName).toBe('Initial Bride');
    expect(prisma.appConfig.findUnique).toHaveBeenCalledTimes(1);

    // Admin updates settings in database (represented by a new mock return value for Request 2)
    (prisma.appConfig.findUnique as jest.Mock).mockResolvedValueOnce({
      ...baseConfig,
      id: 'global',
      partner1Name: 'Updated Bride',
      brideName: 'Updated Bride',
    });

    // Request 2: Next page request (simulating fresh HTTP request lifecycle)
    // Clear request scope or fallback store to simulate next request
    const globalWithStore = globalThis as typeof globalThis & {
      globalFallbackStore?: Map<string, unknown>;
    };
    if (typeof globalWithStore.globalFallbackStore !== 'undefined') {
      globalWithStore.globalFallbackStore.clear();
    }

    const req2Config = await getAppConfig('global');
    expect(req2Config.brideName).toBe('Updated Bride');
    expect(prisma.appConfig.findUnique).toHaveBeenCalledTimes(2);
  });

  it('synchronizes legacy brideName and groomName aliases to partner1Name and partner2Name in getAppConfig', async () => {
    const globalWithStore = globalThis as typeof globalThis & {
      globalFallbackStore?: Map<string, unknown>;
    };
    globalWithStore.globalFallbackStore?.clear();

    (prisma.appConfig.findUnique as jest.Mock).mockResolvedValueOnce({
      ...baseConfig,
      id: 'global',
      partner1Name: 'Taylor',
      partner2Name: 'Morgan',
      brideName: 'StaleBride',
      groomName: 'StaleGroom',
    });

    const resolved = await getAppConfig('global');
    expect(resolved.partner1Name).toBe('Taylor');
    expect(resolved.partner2Name).toBe('Morgan');
    expect(resolved.brideName).toBe('Taylor');
    expect(resolved.groomName).toBe('Morgan');
  });

  it('omits rsvpGracePeriodHours from toPublicAppConfig while exposing it in toAdminAppConfig', async () => {
    const { toPublicAppConfig, toAdminAppConfig } = await import('../config');
    const rawWithGrace = {
      ...baseConfig,
      id: 'global',
      timezone: 'America/Chicago',
      rsvpOpen: true,
      rsvpDeadlineDate: '2099-08-15',
      rsvpGracePeriodHours: 48,
      rsvpClosedMessage: '<script>evil()</script>Please reach out to hosts@example.com',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const pub = toPublicAppConfig(rawWithGrace) as Record<string, unknown>;
    expect(pub.rsvpGracePeriodHours).toBeUndefined();
    expect(pub.rsvpDeadlineDate).toBe('2099-08-15');
    expect(pub.isRsvpOpen).toBe(true);
    expect(pub.rsvpClosedMessage).toBe('evil()Please reach out to hosts@example.com');

    const admin = toAdminAppConfig(rawWithGrace);
    expect(admin.rsvpGracePeriodHours).toBe(48);
    expect(admin.rsvpOpen).toBe(true);
  });
});
