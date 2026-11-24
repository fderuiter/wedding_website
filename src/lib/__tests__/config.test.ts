import { headers } from 'next/headers';
import {
  toPublicAppConfig,
  toUnauthenticatedAppConfig,
  toAdminAppConfig,
  isMultisiteEnabled,
  isSiteInitialized,
  isSetupCompleted,
  APP_DEFAULTS,
  getAppConfig,
} from '../config';
import type { AdminAppConfig } from '../config';
import { PublicAppConfigSchema } from '@/features/content';
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
    expect(adminConfig.setupCompleted).toBe(true);
  });

  it('tracks setupCompleted accurately across DTO projections and isSetupCompleted helper', () => {
    const inProgressConfig = {
      ...baseConfig,
      setupCompleted: false,
    };

    const publicProjected = toPublicAppConfig(inProgressConfig) as Record<string, unknown>;
    expect(publicProjected.setupCompleted).toBeUndefined();

    const adminProjected = toAdminAppConfig(inProgressConfig);
    expect(adminProjected.setupCompleted).toBe(false);

    expect(isSetupCompleted(null)).toBe(false);
    expect(isSetupCompleted({ ...baseConfig, partner1Name: '', brideName: '', setupCompleted: true })).toBe(false);
    expect(isSetupCompleted(inProgressConfig)).toBe(false);
    expect(isSetupCompleted({ ...baseConfig, setupCompleted: true })).toBe(true);
    expect(isSetupCompleted(baseConfig)).toBe(true);
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

  it('ignores empty and whitespace-only strings in SITE_WEDDING_DATE, SITE_LATITUDE, and SITE_LONGITUDE without failing AppConfigSchema.parse', async () => {
    const savedWeddingDate = process.env.SITE_WEDDING_DATE;
    const savedLatitude = process.env.SITE_LATITUDE;
    const savedLongitude = process.env.SITE_LONGITUDE;

    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      process.env.SITE_WEDDING_DATE = '';
      process.env.SITE_LATITUDE = '   ';
      process.env.SITE_LONGITUDE = '';

      const fallbackDate = new Date('2027-06-19T17:00:00.000Z');
      (prisma.appConfig.findUnique as jest.Mock).mockResolvedValue({
        ...baseConfig,
        id: 'global',
        weddingDate: fallbackDate,
        latitude: 30.2672,
        longitude: -97.7431,
      });

      const effectiveConfig = await getAppConfig('global');
      expect(effectiveConfig.weddingDate).toEqual(fallbackDate);
      expect(effectiveConfig.latitude).toBe(30.2672);
      expect(effectiveConfig.longitude).toBe(-97.7431);
    } finally {
      if (savedWeddingDate === undefined) {
        delete process.env.SITE_WEDDING_DATE;
      } else {
        process.env.SITE_WEDDING_DATE = savedWeddingDate;
      }
      if (savedLatitude === undefined) {
        delete process.env.SITE_LATITUDE;
      } else {
        process.env.SITE_LATITUDE = savedLatitude;
      }
      if (savedLongitude === undefined) {
        delete process.env.SITE_LONGITUDE;
      } else {
        process.env.SITE_LONGITUDE = savedLongitude;
      }
    }
  });

  it('skips empty and whitespace-only SITE_* strings across all 32 keys without ZodError or SetupWizard resets', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.E2E_TEST = 'false';

    const all32SiteKeys = [
      'SITE_PARTNER1_NAME',
      'SITE_PARTNER2_NAME',
      'SITE_BRIDE_NAME',
      'SITE_GROOM_NAME',
      'SITE_WEDDING_DATE',
      'SITE_BASE_URL',
      'SITE_VENUE_NAME',
      'SITE_VENUE_ADDRESS',
      'SITE_VENUE_CITY',
      'SITE_VENUE_STATE',
      'SITE_VENUE_ZIP',
      'SITE_LATITUDE',
      'SITE_LONGITUDE',
      'SITE_TIMEZONE',
      'SITE_COLOR_PRIMARY',
      'SITE_COLOR_SECONDARY',
      'SITE_THEME_PRESET',
      'SITE_THEME_TOKENS',
      'SITE_SHOW_COUNTDOWN',
      'SITE_SHOW_ADD_TO_CALENDAR',
      'SITE_SEO_TITLE',
      'SITE_SEO_DESCRIPTION',
      'SITE_BRAND_MONOGRAM',
      'SITE_BRAND_LOGO_URL',
      'SITE_BRAND_LOGO_ALT',
      'SITE_HERO_IMAGE_URL',
      'SITE_HERO_IMAGE_ALT',
      'SITE_BRAND_WATERMARK_URL',
      'SITE_BRAND_WATERMARK_ALT',
      'SITE_BADGE_GRAPHIC_URL',
      'SITE_BADGE_GRAPHIC_ALT',
      'SITE_CONTACT_EMAIL',
    ] as const;

    const dbWeddingDate = new Date('2027-09-18T17:00:00.000Z');
    (prisma.appConfig.findUnique as jest.Mock).mockResolvedValue({
      ...baseConfig,
      id: 'global',
      partner1Name: 'Alex',
      partner2Name: 'Jordan',
      brideName: 'Alex',
      groomName: 'Jordan',
      weddingDate: dbWeddingDate,
      baseUrl: 'https://celebration.mydomain.com',
      venueName: 'Grand Conservatory',
      venueAddress: '100 Garden Way',
      venueCity: 'Minneapolis',
      venueState: 'MN',
      venueZip: '55401',
      latitude: 44.9778,
      longitude: -93.265,
      colorPrimary: '#4A5D4E',
      colorSecondary: '#D4AF37',
      themePreset: 'modern',
      themeTokens: { '--btn-radius': '10px' },
      timezone: 'America/Chicago',
      showCountdown: true,
      showAddToCalendar: true,
      contactEmail: 'couple@mydomain.com',
      subdomain: null,
    });

    const globalWithStore = globalThis as typeof globalThis & {
      globalFallbackStore?: Map<string, unknown>;
    };

    for (const blankValue of ['', '   \t\n  ']) {
      globalWithStore.globalFallbackStore?.clear();
      for (const key of all32SiteKeys) {
        process.env[key] = blankValue;
      }

      const resolved = await getAppConfig('global');
      expect(resolved.partner1Name).toBe('Alex');
      expect(resolved.partner2Name).toBe('Jordan');
      expect(resolved.brideName).toBe('Alex');
      expect(resolved.groomName).toBe('Jordan');
      expect(resolved.weddingDate.toISOString()).toBe(dbWeddingDate.toISOString());
      expect(resolved.baseUrl).toBe('https://celebration.mydomain.com');
      expect(resolved.venueName).toBe('Grand Conservatory');
      expect(resolved.venueAddress).toBe('100 Garden Way');
      expect(resolved.venueCity).toBe('Minneapolis');
      expect(resolved.venueState).toBe('MN');
      expect(resolved.venueZip).toBe('55401');
      expect(resolved.latitude).toBe(44.9778);
      expect(resolved.longitude).toBe(-93.265);
      expect(resolved.colorPrimary).toBe('#4A5D4E');
      expect(resolved.colorSecondary).toBe('#D4AF37');
      expect(resolved.themePreset).toBe('modern');
      expect(resolved.themeTokens).toEqual({ '--btn-radius': '10px' });
      expect(resolved.timezone).toBe('America/Chicago');
      expect(resolved.showCountdown).toBe(true);
      expect(resolved.showAddToCalendar).toBe(true);
      expect(resolved.contactEmail).toBe('couple@mydomain.com');
      expect(isSiteInitialized(resolved)).toBe(true);
    }
  });

  it('trims surrounding whitespace across all 32 non-empty SITE_* overrides and rejects non-empty malformed coordinates', async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.E2E_TEST = 'false';

    const globalWithStore = globalThis as typeof globalThis & {
      globalFallbackStore?: Map<string, unknown>;
    };
    globalWithStore.globalFallbackStore?.clear();

    (prisma.appConfig.findUnique as jest.Mock).mockResolvedValue({
      ...baseConfig,
      id: 'global',
      timezone: 'UTC',
      showCountdown: true,
      showAddToCalendar: false,
      subdomain: null,
    });

    process.env.SITE_BRIDE_NAME = '  Legacy Bride  ';
    process.env.SITE_GROOM_NAME = '  Legacy Groom  ';
    process.env.SITE_PARTNER1_NAME = '  Taylor  ';
    process.env.SITE_PARTNER2_NAME = '  Morgan  ';
    process.env.SITE_WEDDING_DATE = '  2027-10-16T18:30:00.000Z  ';
    process.env.SITE_BASE_URL = '  https://celebrate.mydomain.com  ';
    process.env.SITE_VENUE_NAME = '  Botanical Pavilion  ';
    process.env.SITE_VENUE_ADDRESS = '  500 Conservatory Ave  ';
    process.env.SITE_VENUE_CITY = '  Saint Paul  ';
    process.env.SITE_VENUE_STATE = '  MN  ';
    process.env.SITE_VENUE_ZIP = '  55102  ';
    process.env.SITE_LATITUDE = '  44.9537  ';
    process.env.SITE_LONGITUDE = '  -93.0900  ';
    process.env.SITE_TIMEZONE = '  America/Chicago  ';
    process.env.SITE_COLOR_PRIMARY = '  #2E4A3E  ';
    process.env.SITE_COLOR_SECONDARY = '  #C9A227  ';
    process.env.SITE_THEME_PRESET = '  romantic  ';
    process.env.SITE_THEME_TOKENS = '  {"--btn-radius":"16px"}  ';
    process.env.SITE_SHOW_COUNTDOWN = '  FALSE  ';
    process.env.SITE_SHOW_ADD_TO_CALENDAR = '  TRUE  ';
    process.env.SITE_SEO_TITLE = '  Taylor & Morgan Celebration  ';
    process.env.SITE_SEO_DESCRIPTION = '  Weekend schedule and travel details  ';
    process.env.SITE_BRAND_MONOGRAM = '  T&M  ';
    process.env.SITE_BRAND_LOGO_URL = '  /assets/custom-logo.svg  ';
    process.env.SITE_BRAND_LOGO_ALT = '  Taylor and Morgan crest  ';
    process.env.SITE_HERO_IMAGE_URL = '  /assets/custom-hero.jpg  ';
    process.env.SITE_HERO_IMAGE_ALT = '  Conservatory courtyard  ';
    process.env.SITE_BRAND_WATERMARK_URL = '  /assets/custom-watermark.svg  ';
    process.env.SITE_BRAND_WATERMARK_ALT = '  Botanical watermark  ';
    process.env.SITE_BADGE_GRAPHIC_URL = '  /assets/custom-badge.svg  ';
    process.env.SITE_BADGE_GRAPHIC_ALT = '  Weekend badge  ';
    process.env.SITE_CONTACT_EMAIL = '  hosts@mydomain.com  ';

    const resolved = await getAppConfig('global');
    expect(resolved.partner1Name).toBe('Taylor');
    expect(resolved.partner2Name).toBe('Morgan');
    expect(resolved.brideName).toBe('Taylor');
    expect(resolved.groomName).toBe('Morgan');
    expect(resolved.weddingDate.toISOString()).toBe('2027-10-16T18:30:00.000Z');
    expect(resolved.baseUrl).toBe('https://celebrate.mydomain.com');
    expect(resolved.venueName).toBe('Botanical Pavilion');
    expect(resolved.venueAddress).toBe('500 Conservatory Ave');
    expect(resolved.venueCity).toBe('Saint Paul');
    expect(resolved.venueState).toBe('MN');
    expect(resolved.venueZip).toBe('55102');
    expect(resolved.latitude).toBe(44.9537);
    expect(resolved.longitude).toBe(-93.09);
    expect(resolved.timezone).toBe('America/Chicago');
    expect(resolved.colorPrimary).toBe('#2E4A3E');
    expect(resolved.colorSecondary).toBe('#C9A227');
    expect(resolved.themePreset).toBe('romantic');
    expect(resolved.themeTokens).toEqual({ '--btn-radius': '16px' });
    expect(resolved.showCountdown).toBe(false);
    expect(resolved.showAddToCalendar).toBe(true);
    expect(resolved.seoTitle).toBe('Taylor & Morgan Celebration');
    expect(resolved.seoDescription).toBe('Weekend schedule and travel details');
    expect(resolved.brandMonogram).toBe('T&M');
    expect(resolved.brandLogoUrl).toBe('/assets/custom-logo.svg');
    expect(resolved.brandLogoAlt).toBe('Taylor and Morgan crest');
    expect(resolved.heroImageUrl).toBe('/assets/custom-hero.jpg');
    expect(resolved.heroImageAlt).toBe('Conservatory courtyard');
    expect(resolved.brandWatermarkUrl).toBe('/assets/custom-watermark.svg');
    expect(resolved.brandWatermarkAlt).toBe('Botanical watermark');
    expect(resolved.badgeGraphicUrl).toBe('/assets/custom-badge.svg');
    expect(resolved.badgeGraphicAlt).toBe('Weekend badge');
    expect(resolved.contactEmail).toBe('hosts@mydomain.com');

    // When SITE_PARTNER1_NAME / SITE_PARTNER2_NAME are blank, trimmed legacy SITE_BRIDE_NAME / SITE_GROOM_NAME apply
    globalWithStore.globalFallbackStore?.clear();
    process.env.SITE_PARTNER1_NAME = '   ';
    process.env.SITE_PARTNER2_NAME = '';
    const legacyResolved = await getAppConfig('global');
    expect(legacyResolved.partner1Name).toBe('Legacy Bride');
    expect(legacyResolved.partner2Name).toBe('Legacy Groom');

    // Padded malformed coordinate still triggers strict production validation failure
    globalWithStore.globalFallbackStore?.clear();
    process.env.SITE_LATITUDE = '  invalid-latitude  ';
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

  describe('hidden section redaction and unauthenticated layout gating', () => {
    it('redacts title and content on hidden features in toPublicAppConfig while preserving visible features and raw admin features', () => {
      const configWithHiddenFeatures = {
        ...baseConfig,
        features: [
          {
            id: 'story',
            type: 'story',
            title: 'Our Story',
            content: 'Public story intro',
            visible: true,
          },
          {
            id: 'custom-secret',
            type: 'custom',
            title: 'Secret Afterparty Draft',
            content: 'Private speakeasy code 9942',
            visible: false,
          },
        ],
      };

      const pub = toPublicAppConfig(configWithHiddenFeatures);
      expect(pub.features).toEqual([
        {
          id: 'story',
          type: 'story',
          title: 'Our Story',
          content: 'Public story intro',
          visible: true,
        },
        {
          id: 'custom-secret',
          type: 'custom',
          title: '',
          content: '',
          visible: false,
        },
      ]);

      const admin = toAdminAppConfig(configWithHiddenFeatures);
      expect(admin.features).toEqual([
        {
          id: 'story',
          type: 'story',
          title: 'Our Story',
          content: 'Public story intro',
          visible: true,
        },
        {
          id: 'custom-secret',
          type: 'custom',
          title: 'Secret Afterparty Draft',
          content: 'Private speakeasy code 9942',
          visible: false,
        },
      ]);
    });

    it('retains redacted hidden placeholder entries when all features are hidden so empty-array fallbacks do not trigger', () => {
      const allHiddenConfig = {
        ...baseConfig,
        features: JSON.stringify([
          {
            id: 'details',
            type: 'details',
            title: 'Unpublished Details',
            content: 'Hidden ceremony schedule',
            visible: false,
          },
          {
            id: 'venue',
            type: 'venue',
            title: 'Unpublished Venue',
            content: 'Hidden venue gate code',
            visible: false,
          },
        ]),
      };

      const pub = toPublicAppConfig(allHiddenConfig);
      expect(pub.features).toHaveLength(2);
      expect(pub.features).toEqual([
        {
          id: 'details',
          type: 'details',
          title: '',
          content: '',
          visible: false,
        },
        {
          id: 'venue',
          type: 'venue',
          title: '',
          content: '',
          visible: false,
        },
      ]);
    });

    it('clears gated event details in toUnauthenticatedAppConfig while preserving branding, theme tokens, modules, contactEmail, timezone, and RSVP fields', () => {
      const richConfig = {
        ...baseConfig,
        partner1Name: 'Taylor',
        partner2Name: 'Morgan',
        brideName: 'Taylor',
        groomName: 'Morgan',
        weddingDate: new Date('2026-10-10T16:00:00.000Z'),
        seoTitle: 'Taylor & Morgan Wedding',
        seoDescription: 'Join us in Asheville',
        seoKeywords: 'Taylor, Morgan, Asheville wedding',
        brandMonogram: 'T & M',
        brandLogoUrl: '/uploads/logo.png',
        brandLogoAlt: 'Couple monogram',
        heroImageUrl: '/uploads/hero.jpg',
        heroImageAlt: 'Sunset portrait',
        brandWatermarkUrl: '/uploads/watermark.png',
        brandWatermarkAlt: 'Floral crest',
        badgeGraphicUrl: '/uploads/badge.png',
        badgeGraphicAlt: 'Wax seal',
        photoAlbumUrl: 'https://photos.example.invalid/private-album',
        venueName: 'Secret Estate',
        venueAddress: '742 Hidden Lane',
        venueCity: 'Asheville',
        venueState: 'NC',
        venueZip: '28801',
        latitude: 35.5951,
        longitude: -82.5515,
        venueDescription: 'Gate code 4815 at north entrance',
        storyText: 'Private couple story narrative',
        travelAdvice: 'Private shuttle pickup instructions',
        heroTitle: 'Secret Garden Weekend',
        heroSubtitle: 'Private estate celebration',
        colorPrimary: '#1E3A8A',
        colorSecondary: '#D97706',
        themePreset: 'editorial',
        themeTokens: { '--color-accent': '#0F766E' },
        contactEmail: 'hosts@wedding.example',
        timezone: 'America/New_York',
        rsvpOpen: true,
        rsvpDeadlineDate: '2099-09-01',
        rsvpClosedMessage: 'Please email hosts for late RSVP updates.',
        modules: {
          registry: true,
          groupGifting: false,
          weather: true,
          weddingParty: true,
          attractions: false,
          gallery: true,
          countdown: true,
          addToCalendar: false,
          interactive3D: false,
        },
        features: [
          {
            id: 'story',
            type: 'story',
            title: 'Private Story Heading',
            content: 'Private story section body',
            visible: true,
          },
          {
            id: 'hidden-draft',
            type: 'custom',
            title: 'Hidden Draft Title',
            content: 'Hidden draft body',
            visible: false,
          },
        ],
      };

      const unauth = toUnauthenticatedAppConfig(richConfig);

      // Gated fields are cleared
      expect(unauth.partner1Name).toBe('');
      expect(unauth.partner2Name).toBe('');
      expect(unauth.brideName).toBe('');
      expect(unauth.groomName).toBe('');
      expect(unauth.weddingDate).toBe('');
      expect(unauth.seoTitle).toBe('');
      expect(unauth.seoDescription).toBe('');
      expect(unauth.seoKeywords).toBe('');
      expect(unauth.photoAlbumUrl).toBe('');
      expect(unauth.venueName).toBe('');
      expect(unauth.venueAddress).toBe('');
      expect(unauth.venueCity).toBe('');
      expect(unauth.venueState).toBe('');
      expect(unauth.venueZip).toBe('');
      expect(unauth.latitude).toBe(0);
      expect(unauth.longitude).toBe(0);
      expect(unauth.venueDescription).toBe('');
      expect(unauth.storyText).toBe('');
      expect(unauth.travelAdvice).toBe('');
      expect(unauth.heroTitle).toBe('');
      expect(unauth.heroSubtitle).toBe('');
      expect(unauth.features).toEqual([]);

      // Branding tokens, theme, modules, contactEmail, timezone, and RSVP fields are preserved
      expect(unauth.brandMonogram).toBe('T & M');
      expect(unauth.brandLogoUrl).toBe('/uploads/logo.png');
      expect(unauth.brandLogoAlt).toBe('Couple monogram');
      expect(unauth.heroImageUrl).toBe('/uploads/hero.jpg');
      expect(unauth.brandWatermarkUrl).toBe('/uploads/watermark.png');
      expect(unauth.badgeGraphicUrl).toBe('/uploads/badge.png');
      expect(unauth.colorPrimary).toBe('#1E3A8A');
      expect(unauth.colorSecondary).toBe('#D97706');
      expect(unauth.themePreset).toBe('editorial');
      expect(unauth.themeTokens).toEqual({ '--color-accent': '#0F766E' });
      expect(unauth.contactEmail).toBe('hosts@wedding.example');
      expect(unauth.timezone).toBe('America/New_York');
      expect(unauth.rsvpOpen).toBe(true);
      expect(unauth.isRsvpOpen).toBe(true);
      expect(unauth.rsvpDeadlineDate).toBe('2099-09-01');
      expect(unauth.rsvpClosedMessage).toBe('Please email hosts for late RSVP updates.');
      expect(unauth.modules.registry).toBe(true);
      expect(unauth.modules.attractions).toBe(false);
    });
  });
});
