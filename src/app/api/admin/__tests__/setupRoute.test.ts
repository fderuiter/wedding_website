/** @jest-environment node */

import { NextRequest } from 'next/server';
import { GET, POST } from '../setup/route';
import { signAdminToken } from '@/core/auth/auth.server';
import { prisma } from '@/lib/prisma';

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
    // Valid scrypt hash for password 'secret'
    process.env.ADMIN_PASSWORD = 'scrypt:8R6mvU36W2Cqp3C8vq+r1g==:XlhFCFplIJUauzo9FzPUPVgA5458RRwbTpQtFCRWjoLN4AI6VCH76jOksMQdQX/5f45ALowp67Xxo58mFrcb3g==';
  });

  describe('GET /api/admin/setup', () => {
    test('returns initialized false when site is uninitialized', async () => {
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(uninitializedConfig);

      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.initialized).toBe(false);
      expect(json.requiresSetup).toBe(true);
    });

    test('returns initialized true when site is fully initialized', async () => {
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(initializedConfig);

      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.initialized).toBe(true);
      expect(json.requiresSetup).toBe(false);
    });
  });

  describe('POST /api/admin/setup', () => {
    test('uninitialized setup fails when wrong password is provided', async () => {
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(uninitializedConfig);

      const req = new NextRequest('http://localhost/api/admin/setup', {
        method: 'POST',
        body: JSON.stringify({ password: 'wrongpassword' }),
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('Invalid admin password.');
    });

    test('uninitialized setup succeeds and returns session cookie with correct password', async () => {
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(uninitializedConfig);

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
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(uninitializedConfig);

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
        timezone: 'America/Los_Angeles',
        showCountdown: true,
        showAddToCalendar: true,
        features: '[]',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockPrisma.appConfig.upsert as jest.Mock).mockResolvedValue(mockSavedConfig);

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
    });

    test('replay attack fails with 403 Forbidden once site is initialized and caller is unauthenticated', async () => {
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(initializedConfig);

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
      (mockPrisma.appConfig.findUnique as jest.Mock).mockResolvedValue(initializedConfig);

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

      (mockPrisma.appConfig.upsert as jest.Mock).mockResolvedValue(mockSavedConfig);

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
  });
});
