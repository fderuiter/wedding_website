/** @jest-environment node */

import { GET as getVersions } from '../versions/route';
import { POST as restoreVersion } from '../versions/[id]/restore/route';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/core/auth/auth.server';
import { toPublicAppConfig } from '@/lib/config';

// Mock dependency modules
jest.mock('@/lib/prisma', () => ({
  prisma: {
    snapshotVersion: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    appConfig: {
      upsert: jest.fn(),
    },
    contentNode: {
      upsert: jest.fn(),
    },
    weddingPartyMember: {
      upsert: jest.fn(),
    },
    attraction: {
      upsert: jest.fn(),
    },
    registryItem: {
      upsert: jest.fn(),
    },
    contributor: {
      upsert: jest.fn(),
    },
    media: {
      upsert: jest.fn(),
    },
  },
}));

jest.mock('@/lib/config', () => ({
  toPublicAppConfig: jest.fn((config) => ({ ...config, sanitized: true })),
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;
const mockToPublicAppConfig = toPublicAppConfig as jest.MockedFunction<typeof toPublicAppConfig>;

describe('GET /api/admin/versions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockIsAdminRequest.mockResolvedValue(false);
    const req = new NextRequest('http://localhost/api/admin/versions', { method: 'GET' });
    const res = await getVersions(req, {});

    expect(res.status).toBe(401);
  });

  it('returns versions and sanitizes AppConfig versions', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const mockVersions = [
      {
        id: 'v1',
        entityType: 'AppConfig',
        entityId: 'global',
        data: { brideName: 'Alice', groomName: 'Bob' },
        createdAt: new Date(),
      },
      {
        id: 'v2',
        entityType: 'ContentNode',
        entityId: 'node-1',
        data: { text: 'Hello' },
        createdAt: new Date(),
      },
    ];
    (mockPrisma.snapshotVersion.findMany as jest.Mock).mockResolvedValue(mockVersions);

    const req = new NextRequest('http://localhost/api/admin/versions?entityType=AppConfig&entityId=global', { method: 'GET' });
    const res = await getVersions(req, {});

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data[0].data.sanitized).toBe(true);
    expect(json.data[1].data).toEqual({ text: 'Hello' });

    expect(mockPrisma.snapshotVersion.findMany).toHaveBeenCalledWith({
      where: { entityType: 'AppConfig', entityId: 'global' },
      orderBy: { createdAt: 'desc' },
    });
  });
});

describe('POST /api/admin/versions/[id]/restore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    mockIsAdminRequest.mockResolvedValue(false);
    const req = new NextRequest('http://localhost/api/admin/versions/v123/restore', { method: 'POST' });
    const res = await restoreVersion(req, { params: Promise.resolve({ id: 'v123' }) });

    expect(res.status).toBe(401);
  });

  it('returns 404 when version is not found', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    (mockPrisma.snapshotVersion.findUnique as jest.Mock).mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/admin/versions/v123/restore', { method: 'POST' });
    const res = await restoreVersion(req, { params: Promise.resolve({ id: 'v123' }) });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe('Version not found');
  });

  it('restores AppConfig and creates a rollback snapshot', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const mockAppConfigSnapshot = {
      brideName: 'Alice',
      groomName: 'Bob',
      weddingDate: '2026-06-20T00:00:00.000Z',
      baseUrl: 'https://wedding.example.com',
      venueName: 'The Castle',
      latitude: 45.0,
      longitude: -93.0,
      storyText: 'Once upon a time',
      features: ['rsvp'],
    };

    const mockVersion = {
      id: 'v-app-config',
      entityType: 'AppConfig',
      entityId: 'global',
      data: mockAppConfigSnapshot,
    };

    (mockPrisma.snapshotVersion.findUnique as jest.Mock).mockResolvedValue(mockVersion);
    (mockPrisma.appConfig.upsert as jest.Mock).mockResolvedValue({});
    (mockPrisma.snapshotVersion.create as jest.Mock).mockResolvedValue({});

    const req = new NextRequest('http://localhost/api/admin/versions/v-app-config/restore', { method: 'POST' });
    const res = await restoreVersion(req, { params: Promise.resolve({ id: 'v-app-config' }) });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.restoredTo).toBe('v-app-config');

    expect(mockPrisma.appConfig.upsert).toHaveBeenCalledWith({
      where: { id: 'global' },
      update: expect.objectContaining({
        brideName: 'Alice',
        groomName: 'Bob',
        latitude: 45.0,
        longitude: -93.0,
      }),
      create: expect.objectContaining({
        id: 'global',
        brideName: 'Alice',
        groomName: 'Bob',
      }),
    });

    expect(mockPrisma.snapshotVersion.create).toHaveBeenCalledWith({
      data: {
        entityType: 'AppConfig',
        entityId: 'global',
        data: mockAppConfigSnapshot,
        author: 'Admin (Rollback)',
      },
    });
  });

  it('restores ContentNode successfully', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const mockContentSnapshot = {
      type: 'text-block',
      tags: ['hero'],
      data: { body: 'Hello world' },
    };

    const mockVersion = {
      id: 'v-content',
      entityType: 'ContentNode',
      entityId: 'hero-block',
      data: mockContentSnapshot,
    };

    (mockPrisma.snapshotVersion.findUnique as jest.Mock).mockResolvedValue(mockVersion);
    (mockPrisma.contentNode.upsert as jest.Mock).mockResolvedValue({});

    const req = new NextRequest('http://localhost/api/admin/versions/v-content/restore', { method: 'POST' });
    const res = await restoreVersion(req, { params: Promise.resolve({ id: 'v-content' }) });

    expect(res.status).toBe(200);
    expect(mockPrisma.contentNode.upsert).toHaveBeenCalledWith({
      where: { id: 'hero-block' },
      update: mockContentSnapshot,
      create: { id: 'hero-block', ...mockContentSnapshot },
    });
  });

  it('restores WeddingPartyMember successfully', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const mockMemberSnapshot = {
      name: 'Best Man',
      role: 'Groomsman',
      bio: 'Best friend',
      photoId: 'photo-1',
      link: 'https://link.com',
      order: 1,
    };

    const mockVersion = {
      id: 'v-member',
      entityType: 'WeddingPartyMember',
      entityId: 'member-1',
      data: mockMemberSnapshot,
    };

    (mockPrisma.snapshotVersion.findUnique as jest.Mock).mockResolvedValue(mockVersion);
    (mockPrisma.weddingPartyMember.upsert as jest.Mock).mockResolvedValue({});

    const req = new NextRequest('http://localhost/api/admin/versions/v-member/restore', { method: 'POST' });
    const res = await restoreVersion(req, { params: Promise.resolve({ id: 'v-member' }) });

    expect(res.status).toBe(200);
    expect(mockPrisma.weddingPartyMember.upsert).toHaveBeenCalledWith({
      where: { id: 'member-1' },
      update: mockMemberSnapshot,
      create: { id: 'member-1', ...mockMemberSnapshot },
    });
  });

  it('restores Attraction successfully', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const mockAttractionSnapshot = {
      name: 'Grand Canyon',
      description: 'Big hole',
      imageId: 'img-123',
      category: 'Sightseeing',
      website: 'https://nps.gov',
      directions: 'Go west',
      latitude: 36.0544,
      longitude: -112.1401,
      isVisible: true,
    };

    const mockVersion = {
      id: 'v-attr',
      entityType: 'Attraction',
      entityId: 'attr-1',
      data: mockAttractionSnapshot,
    };

    (mockPrisma.snapshotVersion.findUnique as jest.Mock).mockResolvedValue(mockVersion);
    (mockPrisma.attraction.upsert as jest.Mock).mockResolvedValue({});

    const req = new NextRequest('http://localhost/api/admin/versions/v-attr/restore', { method: 'POST' });
    const res = await restoreVersion(req, { params: Promise.resolve({ id: 'v-attr' }) });

    expect(res.status).toBe(200);
    expect(mockPrisma.attraction.upsert).toHaveBeenCalledWith({
      where: { id: 'attr-1' },
      update: mockAttractionSnapshot,
      create: { id: 'attr-1', ...mockAttractionSnapshot },
    });
  });

  it('restores RegistryItem successfully', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const mockRegistrySnapshot = {
      name: 'Kitchen Mixer',
      description: 'For baking',
      category: 'Home',
      price: 299.99,
      imageId: 'mixer-img',
      vendorUrl: 'https://vendor.com/mixer',
      quantity: 1,
      isGroupGift: true,
      purchased: false,
      purchaserName: 'Bob',
      amountContributed: 50.0,
    };

    const mockVersion = {
      id: 'v-reg',
      entityType: 'RegistryItem',
      entityId: 'reg-mixer',
      data: mockRegistrySnapshot,
    };

    (mockPrisma.snapshotVersion.findUnique as jest.Mock).mockResolvedValue(mockVersion);
    (mockPrisma.registryItem.upsert as jest.Mock).mockResolvedValue({});

    const req = new NextRequest('http://localhost/api/admin/versions/v-reg/restore', { method: 'POST' });
    const res = await restoreVersion(req, { params: Promise.resolve({ id: 'v-reg' }) });

    expect(res.status).toBe(200);
    expect(mockPrisma.registryItem.upsert).toHaveBeenCalledWith({
      where: { id: 'reg-mixer' },
      update: mockRegistrySnapshot,
      create: { id: 'reg-mixer', ...mockRegistrySnapshot },
    });
  });

  it('restores Contributor successfully', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const mockContributorSnapshot = {
      name: 'Charlie Brown',
      email: 'charlie@brown.com',
      isPlusOne: false,
      amount: 100.0,
      date: '2026-06-15T12:00:00.000Z',
      registryItemId: 'reg-mixer',
    };

    const mockVersion = {
      id: 'v-contrib',
      entityType: 'Contributor',
      entityId: 'contrib-1',
      data: mockContributorSnapshot,
    };

    (mockPrisma.snapshotVersion.findUnique as jest.Mock).mockResolvedValue(mockVersion);
    (mockPrisma.contributor.upsert as jest.Mock).mockResolvedValue({});

    const req = new NextRequest('http://localhost/api/admin/versions/v-contrib/restore', { method: 'POST' });
    const res = await restoreVersion(req, { params: Promise.resolve({ id: 'v-contrib' }) });

    expect(res.status).toBe(200);
    expect(mockPrisma.contributor.upsert).toHaveBeenCalledWith({
      where: { id: 'contrib-1' },
      update: expect.objectContaining({
        name: 'Charlie Brown',
        amount: 100.0,
      }),
      create: expect.objectContaining({
        id: 'contrib-1',
        name: 'Charlie Brown',
      }),
    });
  });

  it('restores Media successfully', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const mockMediaSnapshot = {
      url: 'https://images.com/sunset.jpg',
      altText: 'A beautiful sunset',
      isDecorative: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };

    const mockVersion = {
      id: 'v-media',
      entityType: 'Media',
      entityId: 'media-sunset',
      data: mockMediaSnapshot,
    };

    (mockPrisma.snapshotVersion.findUnique as jest.Mock).mockResolvedValue(mockVersion);
    (mockPrisma.media.upsert as jest.Mock).mockResolvedValue({});

    const req = new NextRequest('http://localhost/api/admin/versions/v-media/restore', { method: 'POST' });
    const res = await restoreVersion(req, { params: Promise.resolve({ id: 'v-media' }) });

    expect(res.status).toBe(200);
    expect(mockPrisma.media.upsert).toHaveBeenCalledWith({
      where: { id: 'media-sunset' },
      update: {
        url: 'https://images.com/sunset.jpg',
        altText: 'A beautiful sunset',
        isDecorative: false,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
      create: {
        id: 'media-sunset',
        url: 'https://images.com/sunset.jpg',
        altText: 'A beautiful sunset',
        isDecorative: false,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      },
    });
  });

  it('throws 400 bad request for unsupported entity type', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const mockVersion = {
      id: 'v-unsupported',
      entityType: 'UnsupportedType',
      entityId: 'unsupported-id',
      data: {},
    };

    (mockPrisma.snapshotVersion.findUnique as jest.Mock).mockResolvedValue(mockVersion);

    const req = new NextRequest('http://localhost/api/admin/versions/v-unsupported/restore', { method: 'POST' });
    const res = await restoreVersion(req, { params: Promise.resolve({ id: 'v-unsupported' }) });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe('Unsupported entity type');
  });
});
