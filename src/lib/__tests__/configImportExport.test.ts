/** @jest-environment node */

import { GET } from '@/app/api/admin/maintenance/export/route';
import { POST } from '@/app/api/admin/maintenance/import/route';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/core/auth/auth.server';

jest.mock('next/server', () => {
  class MockNextResponse {
    static json = jest.fn((body, init) => {
      const responseCookies = new Map();
      const headers = new Headers();
      if (init?.headers) {
        Object.entries(init.headers).forEach(([k, v]) => headers.set(k, v as string));
      }
      const cookies = {
        set: jest.fn(),
        get: jest.fn(),
        delete: jest.fn(),
      };
      return {
        status: init?.status || 200,
        headers: headers,
        json: () => Promise.resolve(body),
        cookies: cookies,
      };
    });

    status: number;
    headers: Headers;
    bodyContent: string;

    constructor(body: string, init?: any) {
      this.bodyContent = body;
      this.status = init?.status || 200;
      this.headers = new Headers();
      if (init?.headers) {
        Object.entries(init.headers).forEach(([k, v]) => {
          this.headers.set(k, v as string);
        });
      }
    }

    async json() {
      return JSON.parse(this.bodyContent);
    }
  }

  return {
    NextRequest: jest.fn().mockImplementation((url, init) => ({
      url,
      nextUrl: new URL(url),
      method: init?.method || 'GET',
      headers: new Headers(init?.headers || { host: 'localhost' }),
      json: () => Promise.resolve(JSON.parse(init?.body || '{}')),
    })),
    NextResponse: MockNextResponse,
  };
});

jest.mock('@/lib/prisma', () => ({
  prisma: {
    appConfig: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    contentNode: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    media: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    weddingPartyMember: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    attraction: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    registryItem: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    contributor: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    snapshotVersion: { findMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(true),
}));

describe('Configuration Import/Export & Upgrade Safety', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    (isAdminRequest as jest.Mock).mockResolvedValue(true);
  });

  it('GET /api/admin/maintenance/export includes version metadata and excludes secret values', async () => {
    (prisma.appConfig.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'global',
        brideName: 'Alice',
        groomName: 'Bob',
        weddingDate: new Date('2026-06-20T00:00:00.000Z'),
        baseUrl: 'http://localhost:3000',
        venueName: 'The Venue',
        venueAddress: '123 St',
        venueCity: 'City',
        venueState: 'ST',
        venueZip: '12345',
        latitude: 10,
        longitude: 20,
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
        colorPrimary: '#B91C1C',
        colorSecondary: '#B45309',
        timezone: 'UTC',
        showCountdown: true,
        showAddToCalendar: true,
        features: '[]',
        createdAt: new Date(),
        updatedAt: new Date(),
        subdomain: null,
        adminPassword: 'SuperSecretPasswordDoNotExport',
        databaseUrl: 'postgres://user:pass@localhost:5432/db',
      },
    ]);
    (prisma.contentNode.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.media.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.weddingPartyMember.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.attraction.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.registryItem.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.contributor.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.snapshotVersion.findMany as jest.Mock).mockResolvedValue([]);

    const req = new NextRequest('http://localhost/api/admin/maintenance/export', { method: 'GET' });
    const response = await GET(req);

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.version).toBe('1.0');
    expect(body.schemaVersion).toBe('1.0');
    expect(body.exportedAt).toBeDefined();

    const exportedAppConfig = body.appConfig[0];
    expect(exportedAppConfig.brideName).toBe('Alice');
    expect(exportedAppConfig.adminPassword).toBeUndefined();
    expect(exportedAppConfig.databaseUrl).toBeUndefined();
  });

  it('POST /api/admin/maintenance/import accepts versioned backup payloads and validates schema', async () => {
    const validBackupPayload = {
      version: '1.0',
      schemaVersion: '1.0',
      exportedAt: new Date().toISOString(),
      appConfig: [
        {
          id: 'global',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          brideName: 'Jane',
          groomName: 'John',
          weddingDate: new Date().toISOString(),
        },
      ],
      contentNode: [],
      media: [],
      weddingPartyMember: [],
      attraction: [],
      registryItem: [],
      contributor: [],
    };

    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
      const mockTx = {
        contributor: { deleteMany: jest.fn(), createMany: jest.fn() },
        registryItem: { deleteMany: jest.fn(), createMany: jest.fn() },
        attraction: { deleteMany: jest.fn(), createMany: jest.fn() },
        weddingPartyMember: { deleteMany: jest.fn(), createMany: jest.fn() },
        media: { deleteMany: jest.fn(), createMany: jest.fn() },
        contentNode: { deleteMany: jest.fn(), createMany: jest.fn() },
        appConfig: { deleteMany: jest.fn(), createMany: jest.fn() },
      };
      return await cb(mockTx);
    });

    const req = new NextRequest('http://localhost/api/admin/maintenance/import', {
      method: 'POST',
      body: JSON.stringify(validBackupPayload),
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
