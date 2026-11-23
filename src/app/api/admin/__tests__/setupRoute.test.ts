/** @jest-environment node */

import { NextRequest } from 'next/server';
import { GET, POST } from '../setup/route';
import { signAdminToken } from '@/core/auth/auth.server';
import { prisma } from '@/lib/prisma';
import { isSiteInitialized } from '@/lib/config';
import {
  APP_CONFIG_BACKUP_KEYS,
  APP_CONFIG_SECRET_KEYS,
} from '@/lib/backupPersistence';
import { AppConfigSchema } from '@/features/content';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    appConfig: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      upsert: jest.fn(),
    },
    snapshotVersion: {
      create: jest.fn(),
    },
    contentNode: {
      count: jest.fn().mockResolvedValue(1),
    },
  },
}));

describe('Setup API Route (/api/admin/setup)', () => {
  const mockPrisma = prisma as jest.Mocked<typeof prisma>;

  const uninitializedConfig = {
    id: 'global',
    brideName: '',
    groomName: '',
    baseUrl: '',
    weddingDate: new Date(),
    venueName: '',
    venueAddress: '',
    venueCity: '',
    venueState: '',
    venueZip: '',
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
    ogImageUrl: '/images/sunset.jpg',
    seoKeywords: '',
    colorPrimary: '#B91C1C',
    colorSecondary: '#B45309',
    timezone: 'America/Chicago',
    showCountdown: true,
    showAddToCalendar: true,
    features: '[]',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const initializedConfig = {
    id: 'global',
    brideName: 'Alice',
    groomName: 'Bob',
    baseUrl: 'https://ourwedding.com',
    weddingDate: new Date(),
    venueName: 'The Venue',
    venueAddress: '123 St',
    venueCity: 'City',
    venueState: 'ST',
    venueZip: '12345',
    latitude: 0,
    longitude: 0,
    storyText: '',
    venueDescription: '',
    travelAdvice: '',
    heroTitle: '',
    heroSubtitle: '',
    seoTitle: '',
    seoDescription: '',
    faviconUrl: '',
    ogImageUrl: '',
    seoKeywords: '',
    colorPrimary: '#B91C1C',
    colorSecondary: '#B45309',
    timezone: 'America/Chicago',
    showCountdown: true,
    showAddToCalendar: true,
    features: '[]',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitsForTesting();
    // Valid scrypt hash for password 'secret'
    process.env.ADMIN_PASSWORD =
      'scrypt:8R6mvU36W2Cqp3C8vq+r1g==:XlhFCFplIJUauzo9FzPUPVgA5458RRwbTpQtFCRWjoLN4AI6VCH76jOksMQdQX/5f45ALowp67Xxo58mFrcb3g==';
  });

  describe('GET /api/admin/setup', () => {
    test('returns initialized false when site is uninitialized', async () => {
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(
        uninitializedConfig,
      );

      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.initialized).toBe(false);
      expect(json.requiresSetup).toBe(true);
    });

    test('returns initialized true when site is fully initialized', async () => {
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(
        initializedConfig,
      );

      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.initialized).toBe(true);
      expect(json.requiresSetup).toBe(false);
    });
  });

  describe('POST /api/admin/setup', () => {
    test('uninitialized setup fails when wrong password is provided', async () => {
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(
        uninitializedConfig,
      );

      const req = new NextRequest('http://localhost/api/admin/setup', {
        method: 'POST',
        body: JSON.stringify({ password: 'wrongpassword' }),
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Invalid admin password.');
    });

    test('returns 400 when ogImageUrl contains parent traversal sequence', async () => {
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(
        uninitializedConfig,
      );

      const req = new NextRequest('http://localhost/api/admin/setup', {
        method: 'POST',
        body: JSON.stringify({
          password: 'secret',
          brideName: 'Alice',
          groomName: 'Bob',
          baseUrl: 'https://ourwedding.com',
          ogImageUrl: '/../canary-outside-public.svg',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(mockPrisma.appConfig.upsert).not.toHaveBeenCalled();
    });

    test('uninitialized setup succeeds and returns session cookie with correct password', async () => {
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(
        uninitializedConfig,
      );

      const req = new NextRequest('http://localhost/api/admin/setup', {
        method: 'POST',
        body: JSON.stringify({ password: 'secret' }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      const setCookie = res.cookies.get('admin_auth')?.value;
      expect(setCookie).toBeTruthy();
    });

    test('uninitialized setup completes configuration and marks site initialized', async () => {
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(
        uninitializedConfig,
      );

      const mockSavedConfig = {
        id: 'global',
        subdomain: null,
        brideName: 'Alice',
        groomName: 'Bob',
        weddingDate: new Date('2026-06-20T16:00:00.000Z'),
        baseUrl: 'https://ourwedding.com',
        venueName: 'The Glasshouse',
        venueAddress: '123 Main St',
        venueCity: 'Seattle',
        venueState: 'WA',
        venueZip: '98101',
        latitude: 47.6,
        longitude: -122.3,
        storyText: 'Our story...',
        venueDescription: 'Venue description...',
        travelAdvice: 'Fly to SEA',
        heroTitle: 'We Tied the Knot!',
        heroSubtitle: 'Welcome!',
        seoTitle: 'Alice & Bob Wedding',
        seoDescription: 'Join Alice and Bob',
        faviconUrl: '/assets/favicon.png',
        ogImageUrl: '/images/sunset.jpg',
        brandMonogram: null,
        brandLogoUrl: null,
        brandLogoAlt: null,
        heroImageUrl: null,
        heroImageAlt: null,
        brandWatermarkUrl: null,
        brandWatermarkAlt: null,
        badgeGraphicUrl: null,
        badgeGraphicAlt: null,
        seoKeywords: 'wedding, seattle',
        colorPrimary: '#B91C1C',
        colorSecondary: '#B45309',
        timezone: 'America/Los_Angeles',
        showCountdown: true,
        showAddToCalendar: true,
        rsvpGracePeriodHours: 24,
        smtpHost: 'smtp.setup.example.com',
        smtpPass: 'setup-smtp-secret',
        twilioAccountSid: 'AC_SETUP',
        twilioAuthToken: 'setup-twilio-secret',
        shippingRecipientName: 'Alice & Bob',
        shippingAddressLine1: '123 Main St',
        defaultPaymentHandleType: 'Venmo',
        defaultPaymentHandle: '@alice-bob',
        features: '[]',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrisma.appConfig.upsert as jest.Mock).mockResolvedValue(
        mockSavedConfig,
      );

      const req = new NextRequest('http://localhost/api/admin/setup', {
        method: 'POST',
        body: JSON.stringify({
          password: 'secret',
          brideName: 'Alice',
          groomName: 'Bob',
          weddingDate: '2026-06-20T16:00:00.000Z',
          baseUrl: 'https://ourwedding.com',
          venueName: 'The Glasshouse',
          venueCity: 'Seattle',
          venueState: 'WA',
          timezone: 'America/Los_Angeles',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.brideName).toBe('Alice');
      expect(json.groomName).toBe('Bob');
      expect(json.baseUrl).toBe('https://ourwedding.com');
      expect(json.timezone).toBe('America/Los_Angeles');
      expect(json.rsvpGracePeriodHours).toBeUndefined();
      expect(json.twilioAccountSid).toBeUndefined();
      expect(json.shippingRecipientName).toBeUndefined();
      expect(json.defaultPaymentHandle).toBeUndefined();
      expect(json.smtpPass).toBeUndefined();

      const setupSnapCall = (
        mockPrisma.snapshotVersion.create as jest.Mock
      ).mock.calls.at(-1)?.[0];
      expect(setupSnapCall.data.author).toBe('Admin (Setup)');
      expect(Object.keys(setupSnapCall.data.data).sort()).toEqual(
        [...APP_CONFIG_BACKUP_KEYS].sort(),
      );
      expect(setupSnapCall.data.data.rsvpGracePeriodHours).toBe(24);
      expect(setupSnapCall.data.data.smtpHost).toBe('smtp.setup.example.com');
      expect(setupSnapCall.data.data.twilioAccountSid).toBe('AC_SETUP');
      expect(setupSnapCall.data.data.shippingRecipientName).toBe('Alice & Bob');
      expect(setupSnapCall.data.data.defaultPaymentHandle).toBe('@alice-bob');
      for (const secretKey of APP_CONFIG_SECRET_KEYS) {
        expect(setupSnapCall.data.data[secretKey]).toBeUndefined();
      }
      expect(setupSnapCall.data.data.multisiteEnabled).toBeUndefined();
      expect(setupSnapCall.data.data.isRsvpOpen).toBeUndefined();
      expect(setupSnapCall.data.data.typographyScale).toBeUndefined();

      expect(mockPrisma.appConfig.upsert).toHaveBeenCalledWith({
        where: { id: 'global' },
        update: expect.objectContaining({
          brideName: 'Alice',
          groomName: 'Bob',
          partner1Name: 'Alice',
          partner2Name: 'Bob',
          baseUrl: 'https://ourwedding.com',
          timezone: 'America/Los_Angeles',
        }),
        create: expect.objectContaining({
          id: 'global',
          brideName: 'Alice',
          groomName: 'Bob',
          partner1Name: 'Alice',
          partner2Name: 'Bob',
          baseUrl: 'https://ourwedding.com',
          timezone: 'America/Los_Angeles',
        }),
      });
    });

    test('strips unchanged light preset defaults from themeTokens during setup save', async () => {
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(
        uninitializedConfig,
      );
      (mockPrisma.appConfig.upsert as jest.Mock).mockImplementation(
        async ({ create }) => ({
          ...uninitializedConfig,
          ...create,
          features: '[]',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const req = new NextRequest('http://localhost/api/admin/setup', {
        method: 'POST',
        body: JSON.stringify({
          password: 'secret',
          partner1Name: 'Alice',
          partner2Name: 'Bob',
          weddingDate: '2026-06-20T16:00:00.000Z',
          baseUrl: 'https://ourwedding.com',
          venueName: 'The Glasshouse',
          venueCity: 'Seattle',
          venueState: 'WA',
          themePreset: 'editorial',
          themeTokens: {
            '--card-bg': '#ffffff',
            '--btn-radius': '0.125rem',
            '--custom-hero-gap': '3rem',
          },
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockPrisma.appConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            themePreset: 'editorial',
            themeTokens: {
              '--custom-hero-gap': '3rem',
            },
          }),
        }),
      );
    });

    test('persists trimmed partner1Name and partner2Name and marks isSiteInitialized true', async () => {
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(
        uninitializedConfig,
      );

      let savedRecord: Record<string, unknown> | null = null;
      (mockPrisma.appConfig.upsert as jest.Mock).mockImplementation(
        async ({ create }) => {
          savedRecord = {
            ...uninitializedConfig,
            ...create,
            features: '[]',
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          return savedRecord;
        },
      );

      const req = new NextRequest('http://localhost/api/admin/setup', {
        method: 'POST',
        body: JSON.stringify({
          password: 'secret',
          partner1Name: '  Alex  ',
          partner2Name: '  Sam  ',
          weddingDate: '2026-06-20T16:00:00.000Z',
          baseUrl: '  https://alexandsam.com  ',
          venueName: 'The Glasshouse',
          venueCity: 'Seattle',
          venueState: 'WA',
          timezone: 'America/Los_Angeles',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.partner1Name).toBe('Alex');
      expect(json.partner2Name).toBe('Sam');
      expect(json.brideName).toBe('Alex');
      expect(json.groomName).toBe('Sam');
      expect(json.baseUrl).toBe('https://alexandsam.com');

      expect(savedRecord).not.toBeNull();
      const parsedConfig = AppConfigSchema.parse(savedRecord);
      expect(isSiteInitialized(parsedConfig)).toBe(true);

      (
        globalThis as unknown as { globalFallbackStore?: Map<unknown, unknown> }
      ).globalFallbackStore?.clear();
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(
        savedRecord,
      );
      const statusRes = await GET();
      const statusJson = await statusRes.json();
      expect(statusJson.initialized).toBe(true);
      expect(statusJson.requiresSetup).toBe(false);
    });

    test('synchronizes legacy brideName and groomName from partner names even when empty legacy strings are sent', async () => {
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(
        uninitializedConfig,
      );

      let savedRecord: Record<string, unknown> | null = null;
      (mockPrisma.appConfig.upsert as jest.Mock).mockImplementation(
        async ({ create }) => {
          savedRecord = {
            ...uninitializedConfig,
            ...create,
            features: '[]',
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          return savedRecord;
        },
      );

      const req = new NextRequest('http://localhost/api/admin/setup', {
        method: 'POST',
        body: JSON.stringify({
          password: 'secret',
          partner1Name: 'Jordan',
          partner2Name: 'Taylor',
          brideName: '',
          groomName: '   ',
          weddingDate: '2026-06-20T16:00:00.000Z',
          baseUrl: 'https://jordantaylor.com',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.partner1Name).toBe('Jordan');
      expect(json.partner2Name).toBe('Taylor');
      expect(json.brideName).toBe('Jordan');
      expect(json.groomName).toBe('Taylor');
      expect(isSiteInitialized(AppConfigSchema.parse(savedRecord))).toBe(true);
    });

    test('falls back to trimmed legacy brideName and groomName when partner fields are blank or omitted', async () => {
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(
        uninitializedConfig,
      );

      let savedRecord: Record<string, unknown> | null = null;
      (mockPrisma.appConfig.upsert as jest.Mock).mockImplementation(
        async ({ create }) => {
          savedRecord = {
            ...uninitializedConfig,
            ...create,
            features: '[]',
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          return savedRecord;
        },
      );

      const req = new NextRequest('http://localhost/api/admin/setup', {
        method: 'POST',
        body: JSON.stringify({
          password: 'secret',
          partner1Name: '   ',
          brideName: '  Alice  ',
          groomName: '  Bob  ',
          weddingDate: '2026-06-20T16:00:00.000Z',
          baseUrl: 'https://aliceandbob.com',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.partner1Name).toBe('Alice');
      expect(json.partner2Name).toBe('Bob');
      expect(json.brideName).toBe('Alice');
      expect(json.groomName).toBe('Bob');
      expect(isSiteInitialized(AppConfigSchema.parse(savedRecord))).toBe(true);
    });

    test.each([
      {
        label: 'blank partner1Name',
        payload: {
          partner1Name: '   ',
          partner2Name: 'Sam',
          baseUrl: 'https://ourwedding.com',
        },
      },
      {
        label: 'blank partner2Name without baseUrl',
        payload: { partner1Name: 'Alex', partner2Name: '' },
      },
      {
        label: 'reserved placeholder partner names',
        payload: {
          partner1Name: 'Partner 1',
          partner2Name: 'Partner 2',
          baseUrl: 'https://ourwedding.com',
        },
      },
      {
        label: 'blank baseUrl',
        payload: { partner1Name: 'Alex', partner2Name: 'Sam', baseUrl: '   ' },
      },
      {
        label: 'reserved wedding.example baseUrl',
        payload: {
          partner1Name: 'Alex',
          partner2Name: 'Sam',
          baseUrl: 'https://wedding.example',
        },
      },
      {
        label: 'reserved example.com baseUrl',
        payload: {
          partner1Name: 'Alex',
          partner2Name: 'Sam',
          baseUrl: 'https://example.com',
        },
      },
      {
        label: 'reserved placeholder contactEmail',
        payload: {
          partner1Name: 'Alex',
          partner2Name: 'Sam',
          baseUrl: 'https://ourwedding.com',
          contactEmail: 'hosts@wedding.example',
        },
      },
      {
        label: 'malformed contactEmail',
        payload: {
          partner1Name: 'Alex',
          partner2Name: 'Sam',
          baseUrl: 'https://ourwedding.com',
          contactEmail: 'not-an-email',
        },
      },
    ])(
      'rejects invalid setup payload ($label) with 400 before upserting AppConfig',
      async ({ payload }) => {
        (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(
          uninitializedConfig,
        );

        const req = new NextRequest('http://localhost/api/admin/setup', {
          method: 'POST',
          body: JSON.stringify({
            password: 'secret',
            ...payload,
          }),
        });

        const res = await POST(req);
        expect(res.status).toBe(400);
        expect(mockPrisma.appConfig.upsert).not.toHaveBeenCalled();
      },
    );

    test('uninitialized setup saves themePreset and layout tokens during configuration', async () => {
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(
        uninitializedConfig,
      );

      const mockSavedConfig = {
        id: 'global',
        brideName: 'Alice',
        groomName: 'Bob',
        weddingDate: new Date('2026-06-20T16:00:00.000Z'),
        baseUrl: 'https://ourwedding.com',
        venueName: 'The Glasshouse',
        venueAddress: '123 Main St',
        venueCity: 'Seattle',
        venueState: 'WA',
        venueZip: '98101',
        latitude: 47.6,
        longitude: -122.3,
        storyText: 'Our story...',
        venueDescription: 'Venue description...',
        travelAdvice: 'Fly to SEA',
        heroTitle: 'We Tied the Knot!',
        heroSubtitle: 'Welcome!',
        seoTitle: 'Alice & Bob Wedding',
        seoDescription: 'Join Alice and Bob',
        faviconUrl: '/assets/favicon.png',
        ogImageUrl: '/images/sunset.jpg',
        seoKeywords: 'wedding, seattle',
        colorPrimary: '#B91C1C',
        colorSecondary: '#B45309',
        themePreset: 'romantic',
        layoutContainerMaxWidth: '70rem',
        layoutGridGap: '2rem',
        layoutCardPadding: '2.5rem',
        layoutBorderRadius: '1.5rem',
        timezone: 'America/Los_Angeles',
        showCountdown: true,
        showAddToCalendar: true,
        features: '[]',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrisma.appConfig.upsert as jest.Mock).mockResolvedValue(
        mockSavedConfig,
      );

      const req = new NextRequest('http://localhost/api/admin/setup', {
        method: 'POST',
        body: JSON.stringify({
          password: 'secret',
          brideName: 'Alice',
          groomName: 'Bob',
          weddingDate: '2026-06-20T16:00:00.000Z',
          baseUrl: 'https://ourwedding.com',
          venueName: 'The Glasshouse',
          venueCity: 'Seattle',
          venueState: 'WA',
          themePreset: 'romantic',
          layoutContainerMaxWidth: '70rem',
          layoutGridGap: '2rem',
          layoutCardPadding: '2.5rem',
          layoutBorderRadius: '1.5rem',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockPrisma.appConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            themePreset: 'romantic',
            layoutContainerMaxWidth: '70rem',
            layoutGridGap: '2rem',
            layoutCardPadding: '2.5rem',
            layoutBorderRadius: '1.5rem',
          }),
        }),
      );
    });

    test('replay attack fails with 403 Forbidden once site is initialized and caller is unauthenticated', async () => {
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(
        initializedConfig,
      );

      const req = new NextRequest('http://localhost/api/admin/setup', {
        method: 'POST',
        body: JSON.stringify({
          password: 'secret',
          brideName: 'Attacker',
          groomName: 'Malicious',
          baseUrl: 'https://evil.com',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('Site is already initialized.');
    });

    test('replay setup allows updating configuration when caller is an authenticated admin', async () => {
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(
        initializedConfig,
      );

      const mockSavedConfig = {
        id: 'global',
        brideName: 'Alice Updated',
        groomName: 'Bob Updated',
        weddingDate: new Date('2026-06-20T16:00:00.000Z'),
        baseUrl: 'https://ourwedding.com',
        venueName: 'The Glasshouse',
        venueAddress: '123 Main St',
        venueCity: 'Seattle',
        venueState: 'WA',
        venueZip: '98101',
        latitude: 47.6,
        longitude: -122.3,
        storyText: 'Updated story',
        venueDescription: 'Venue description...',
        travelAdvice: 'Fly to SEA',
        heroTitle: 'We Tied the Knot!',
        heroSubtitle: 'Welcome!',
        seoTitle: 'Alice & Bob Wedding',
        seoDescription: 'Join Alice and Bob',
        faviconUrl: '/assets/favicon.png',
        ogImageUrl: '/images/sunset.jpg',
        seoKeywords: 'wedding, seattle',
        colorPrimary: '#B91C1C',
        colorSecondary: '#B45309',
        timezone: 'America/Los_Angeles',
        showCountdown: true,
        showAddToCalendar: true,
        features: '[]',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrisma.appConfig.upsert as jest.Mock).mockResolvedValue(
        mockSavedConfig,
      );

      const token = await signAdminToken({ isAdmin: true, iat: Date.now() });

      const req = new NextRequest('http://localhost/api/admin/setup', {
        method: 'POST',
        headers: {
          cookie: `admin_auth=${token}`,
        },
        body: JSON.stringify({
          brideName: 'Alice Updated',
          groomName: 'Bob Updated',
          weddingDate: '2026-06-20T16:00:00.000Z',
          baseUrl: 'https://ourwedding.com',
          venueName: 'The Glasshouse',
          venueCity: 'Seattle',
          venueState: 'WA',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.brideName).toBe('Alice Updated');
    });

    test('uninitialized setup succeeds with empty, whitespace, or omitted venue fields and applies TBD fallbacks', async () => {
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(
        uninitializedConfig,
      );

      const mockSavedConfig = {
        ...uninitializedConfig,
        brideName: 'Alice',
        groomName: 'Bob',
        weddingDate: new Date('2026-06-20T16:00:00.000Z'),
        baseUrl: 'https://ourwedding.com',
        venueName: 'TBD',
        venueAddress: 'TBD',
        venueCity: 'TBD',
        venueState: 'TBD',
        venueZip: 'TBD',
      };

      (mockPrisma.appConfig.upsert as jest.Mock).mockResolvedValue(
        mockSavedConfig,
      );

      const req = new NextRequest('http://localhost/api/admin/setup', {
        method: 'POST',
        body: JSON.stringify({
          password: 'secret',
          brideName: 'Alice',
          groomName: 'Bob',
          weddingDate: '2026-06-20T16:00:00.000Z',
          baseUrl: 'https://ourwedding.com',
          venueName: '   ',
          venueAddress: '',
          // venueCity omitted
          venueState: '  ',
          // venueZip omitted
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      expect(mockPrisma.appConfig.upsert).toHaveBeenCalledWith({
        where: { id: 'global' },
        update: expect.objectContaining({
          venueName: 'TBD',
          venueAddress: 'TBD',
          venueCity: 'TBD',
          venueState: 'TBD',
          venueZip: 'TBD',
        }),
        create: expect.objectContaining({
          id: 'global',
          venueName: 'TBD',
          venueAddress: 'TBD',
          venueCity: 'TBD',
          venueState: 'TBD',
          venueZip: 'TBD',
        }),
      });
    });

    test('uninitialized setup saves optional contactEmail when provided', async () => {
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(
        uninitializedConfig,
      );

      const mockSavedConfig = {
        ...uninitializedConfig,
        brideName: 'Alice',
        groomName: 'Bob',
        weddingDate: new Date('2026-06-20T16:00:00.000Z'),
        baseUrl: 'https://ourwedding.com',
        contactEmail: 'hosts@ourwedding.com',
      };

      (mockPrisma.appConfig.upsert as jest.Mock).mockResolvedValue(
        mockSavedConfig,
      );

      const req = new NextRequest('http://localhost/api/admin/setup', {
        method: 'POST',
        body: JSON.stringify({
          password: 'secret',
          partner1Name: 'Alice',
          partner2Name: 'Bob',
          weddingDate: '2026-06-20T16:00:00.000Z',
          baseUrl: 'https://ourwedding.com',
          contactEmail: '  hosts@ourwedding.com  ',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      expect(mockPrisma.appConfig.upsert).toHaveBeenCalledWith({
        where: { id: 'global' },
        update: expect.objectContaining({
          contactEmail: 'hosts@ourwedding.com',
        }),
        create: expect.objectContaining({
          id: 'global',
          contactEmail: 'hosts@ourwedding.com',
        }),
      });
    });

    test('returns 429 on the 6th unauthenticated POST attempt within 15 minutes', async () => {
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(
        uninitializedConfig,
      );

      for (let i = 1; i <= 5; i++) {
        const req = new NextRequest('http://localhost/api/admin/setup', {
          method: 'POST',
          body: JSON.stringify({ password: `wrong-setup-${i}` }),
        });
        const res = await POST(req);
        expect(res.status).toBe(401);
      }

      const req6 = new NextRequest('http://localhost/api/admin/setup', {
        method: 'POST',
        body: JSON.stringify({ password: 'wrong-setup-6' }),
      });
      const res6 = await POST(req6);
      expect(res6.status).toBe(429);
    });
  });
});
