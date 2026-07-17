/** @jest-environment node */

import { GET, PUT } from '../settings/route';
import { NextRequest } from 'next/server';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    appConfig: {
      update: jest.fn(),
    },
    snapshotVersion: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
  toPublicAppConfig: jest.fn((config) => {
    return config;
  }),
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

jest.mock('next/cache', () => ({
  revalidatePath: jest.fn(),
}));

import { prisma } from '@/lib/prisma';
import { getAppConfig, toPublicAppConfig } from '@/lib/config';
import { isAdminRequest } from '@/core/auth/auth.server';
import { revalidatePath } from 'next/cache';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockGetAppConfig = getAppConfig as jest.MockedFunction<typeof getAppConfig>;
const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;
const mockRevalidatePath = revalidatePath as jest.MockedFunction<typeof revalidatePath>;

const validConfigData = {
  brideName: 'TestBride',
  groomName: 'TestGroom',
  weddingDate: '2026-06-20T00:00:00.000Z',
  baseUrl: 'https://example.com',
  venueName: 'Test Venue',
  venueAddress: '123 Test St',
  venueCity: 'TestCity',
  venueState: 'TS',
  venueZip: '12345',
  latitude: 44.5,
  longitude: -93.5,
  storyText: 'Our story',
  venueDescription: 'A lovely place',
  travelAdvice: 'Fly here',
  heroTitle: 'Welcome',
  heroSubtitle: 'Join us',
  seoTitle: 'Test Wedding',
  seoDescription: 'Test description',
  faviconUrl: '/custom/favicon.ico',
  ogImageUrl: '/custom/og-image.jpg',
  seoKeywords: '{{brideName}} wedding, {{groomName}} wedding',
};

const updatedConfig = {
  id: 'global',
  ...validConfigData,
  weddingDate: new Date(validConfigData.weddingDate),
  showCountdown: true,
  showAddToCalendar: true,
  features: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeAuthReq(body?: object) {
  return new NextRequest('http://localhost/api/admin/settings', {
    method: body ? 'PUT' : 'GET',
    headers: { cookie: 'admin_auth=valid-token' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeUnauthReq() {
  return new NextRequest('http://localhost/api/admin/settings', {
    method: 'GET',
  });
}

describe('GET /api/admin/settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(false);
  });

  it('returns 401 when no auth cookie is present', async () => {
    const req = makeUnauthReq();
    const res = await GET(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 401 when token verification fails', async () => {
    mockIsAdminRequest.mockResolvedValue(false);
    const req = makeAuthReq();
    const res = await GET(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('returns config when authenticated', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    mockGetAppConfig.mockResolvedValue(updatedConfig as any);

    const req = makeAuthReq();
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockGetAppConfig).toHaveBeenCalled();
    expect(toPublicAppConfig).toHaveBeenCalledWith(updatedConfig);
  });
});

describe('PUT /api/admin/settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(false);
    (mockPrisma.appConfig.update as jest.Mock).mockResolvedValue(updatedConfig);
    (mockPrisma.snapshotVersion.create as jest.Mock).mockResolvedValue({});
    (mockPrisma.snapshotVersion.findMany as jest.Mock).mockResolvedValue([]);
  });

  it('returns 401 when not authenticated', async () => {
    const req = makeUnauthReq();
    const res = await PUT(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 401 when token is invalid', async () => {
    mockIsAdminRequest.mockResolvedValue(false);
    const req = makeAuthReq(validConfigData);
    const res = await PUT(req);

    expect(res.status).toBe(401);
  });

  it('persists faviconUrl to database', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = makeAuthReq({
      ...validConfigData,
      faviconUrl: '/uploads/abc123.ico',
    });
    await PUT(req);

    expect(mockPrisma.appConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          faviconUrl: '/uploads/abc123.ico',
        }),
      })
    );
  });

  it('persists ogImageUrl to database', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = makeAuthReq({
      ...validConfigData,
      ogImageUrl: '/uploads/def456.jpg',
    });
    await PUT(req);

    expect(mockPrisma.appConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ogImageUrl: '/uploads/def456.jpg',
        }),
      })
    );
  });

  it('persists seoKeywords to database', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = makeAuthReq({
      ...validConfigData,
      seoKeywords: '{{brideName}} and {{groomName}} wedding, wedding website',
    });
    await PUT(req);

    expect(mockPrisma.appConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          seoKeywords: '{{brideName}} and {{groomName}} wedding, wedding website',
        }),
      })
    );
  });

  it('persists all three new fields together', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = makeAuthReq({
      ...validConfigData,
      faviconUrl: '/uploads/favicon.ico',
      ogImageUrl: '/uploads/og.jpg',
      seoKeywords: 'custom keyword one, custom keyword two',
    });
    await PUT(req);

    expect(mockPrisma.appConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          faviconUrl: '/uploads/favicon.ico',
          ogImageUrl: '/uploads/og.jpg',
          seoKeywords: 'custom keyword one, custom keyword two',
        }),
      })
    );
  });

  it('calls revalidatePath("/", "layout") after successful update', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = makeAuthReq(validConfigData);
    await PUT(req);

    expect(mockRevalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('returns 400 for invalid latitude', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = makeAuthReq({
      ...validConfigData,
      latitude: 'not-a-number',
    });
    const res = await PUT(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid coordinate format/);
  });

  it('returns 400 for invalid longitude', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = makeAuthReq({
      ...validConfigData,
      longitude: 'bad-coord',
    });
    const res = await PUT(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid coordinate format/);
  });


  it('does not call revalidatePath when update fails with invalid coordinates', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = makeAuthReq({
      ...validConfigData,
      latitude: 'invalid-coord',
    });
    await PUT(req);

    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it('returns 500 when prisma update throws', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    (mockPrisma.appConfig.update as jest.Mock).mockRejectedValue(new Error('DB connection failed'));

    const req = makeAuthReq(validConfigData);
    const res = await PUT(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('DB connection failed');
  });

  it('does not call revalidatePath when prisma throws', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    (mockPrisma.appConfig.update as jest.Mock).mockRejectedValue(new Error('DB error'));

    const req = makeAuthReq(validConfigData);
    await PUT(req);

    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it('returns the public config on success', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = makeAuthReq(validConfigData);
    const res = await PUT(req);

    expect(res.status).toBe(200);
    expect(toPublicAppConfig).toHaveBeenCalledWith(updatedConfig);
  });
});