/** @jest-environment node */

import { GET as getVersions } from '../versions/route';
import { POST as restoreVersion } from '../versions/[id]/restore/route';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { toPublicAppConfig } from '@/lib/config';
import { isAdminRequest } from '@/core/auth/auth.server';

// Mock dependency modules
jest.mock('@/lib/prisma', () => ({
  prisma: {
    snapshotVersion: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
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
      findUnique: jest.fn(),
    },
    contributor: {
      upsert: jest.fn(),
    },
    media: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
    invitationCode: {
      upsert: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    seatingTable: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
    subEvent: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
    subEventAccess: {
      upsert: jest.fn(),
    },
    subEventRsvp: {
      upsert: jest.fn(),
    },
    broadcastMessage: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
    broadcastRecipient: {
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
const mockToPublicAppConfig = toPublicAppConfig as jest.MockedFunction<typeof toPublicAppConfig>;
const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;

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
        data: { partner1Name: 'Alice', partner2Name: 'Bob', brideName: 'Alice', groomName: 'Bob' },
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
    (mockPrisma.snapshotVersion.count as jest.Mock).mockResolvedValue(2);
    (mockPrisma.snapshotVersion.findMany as jest.Mock).mockResolvedValue(mockVersions);

    const req = new NextRequest('http://localhost/api/admin/versions?entityType=AppConfig&entityId=global', { method: 'GET' });
    const res = await getVersions(req, {});

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.items[0].data.sanitized).toBe(true);
    expect(json.data.items[1].data).toEqual({ text: 'Hello' });

    expect(mockPrisma.snapshotVersion.findMany).toHaveBeenCalledWith({
      where: { entityType: 'AppConfig', entityId: 'global' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      skip: 0,
    });
  });

  it('strips messaging secrets from AppConfig snapshots via real toPublicAppConfig', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const actualConfig = jest.requireActual('@/lib/config');
    mockToPublicAppConfig.mockImplementationOnce((cfg: any) => actualConfig.toPublicAppConfig(cfg));

    (mockPrisma.snapshotVersion.count as jest.Mock).mockResolvedValue(1);
    (mockPrisma.snapshotVersion.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'v-secrets',
        entityType: 'AppConfig',
        entityId: 'global',
        data: {
          id: 'global',
          partner1Name: 'Casey',
          partner2Name: 'Jordan',
          weddingDate: '2026-06-20T16:00:00.000Z',
          smtpHost: 'smtp.example.invalid',
          smtpUser: 'mailer@example.invalid',
          smtpPass: 'secret-smtp-pass',
          resendApiKey: 're_secret',
          sendgridApiKey: 'SG.secret',
          twilioAccountSid: 'AC_SECRET_SID',
          twilioAuthToken: 'twilio-secret-token',
        },
        createdAt: new Date(),
      },
    ]);

    const req = new NextRequest('http://localhost/api/admin/versions?entityType=AppConfig&entityId=global', { method: 'GET' });
    const res = await getVersions(req, {});

    expect(res.status).toBe(200);
    const json = await res.json();
    const itemData = json.data.items[0].data;
    expect(itemData.partner1Name).toBe('Casey');
    expect(new Date(itemData.weddingDate).toISOString()).toBe('2026-06-20T16:00:00.000Z');
    expect(itemData.smtpHost).toBeUndefined();
    expect(itemData.smtpUser).toBeUndefined();
    expect(itemData.smtpPass).toBeUndefined();
    expect(itemData.resendApiKey).toBeUndefined();
    expect(itemData.sendgridApiKey).toBeUndefined();
    expect(itemData.twilioAccountSid).toBeUndefined();
    expect(itemData.twilioAuthToken).toBeUndefined();
  });

  it('masks contributor email addresses in Contributor and RegistryItem version history payloads', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const mockVersions = [
      {
        id: 'v-contrib',
        entityType: 'Contributor',
        entityId: 'c1',
        data: { name: 'John Doe', email: 'john.doe@example.com', amount: 50 },
        createdAt: new Date(),
      },
      {
        id: 'v-reg',
        entityType: 'RegistryItem',
        entityId: 'r1',
        data: {
          name: 'Mixer',
          contributors: [
            { name: 'Jane Smith', email: 'jane.smith@example.com', amount: 100 },
          ],
        },
        createdAt: new Date(),
      },
    ];
    (mockPrisma.snapshotVersion.count as jest.Mock).mockResolvedValue(2);
    (mockPrisma.snapshotVersion.findMany as jest.Mock).mockResolvedValue(mockVersions);

    const req = new NextRequest('http://localhost/api/admin/versions', { method: 'GET' });
    const res = await getVersions(req, {});

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    const contribData = json.data.items[0].data;
    expect(contribData.email).not.toBe('john.doe@example.com');
    expect(contribData.email).toContain('***');

    const regData = json.data.items[1].data;
    expect(regData.contributors[0].email).not.toBe('jane.smith@example.com');
    expect(regData.contributors[0].email).toContain('***');
  });

  it('defaults to limit 50 and page 1 with take 50 and skip 0', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    (mockPrisma.snapshotVersion.count as jest.Mock).mockResolvedValue(120);
    (mockPrisma.snapshotVersion.findMany as jest.Mock).mockResolvedValue([]);

    const req = new NextRequest('http://localhost/api/admin/versions', { method: 'GET' });
    const res = await getVersions(req, {});

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.pagination).toEqual({
      total: 120,
      totalCount: 120,
      page: 1,
      currentPage: 1,
      limit: 50,
      pageSize: 50,
      totalPages: 3,
      isPaginated: true,
    });

    expect(mockPrisma.snapshotVersion.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      take: 50,
      skip: 0,
    });
  });

  it('clamps limit to 100 when limit=200 is specified', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    (mockPrisma.snapshotVersion.count as jest.Mock).mockResolvedValue(150);
    (mockPrisma.snapshotVersion.findMany as jest.Mock).mockResolvedValue([]);

    const req = new NextRequest('http://localhost/api/admin/versions?limit=200', { method: 'GET' });
    const res = await getVersions(req, {});

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.pagination.limit).toBe(100);

    expect(mockPrisma.snapshotVersion.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      skip: 0,
    });
  });

  it('computes correct skip and take for custom page and limit', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    (mockPrisma.snapshotVersion.count as jest.Mock).mockResolvedValue(60);
    (mockPrisma.snapshotVersion.findMany as jest.Mock).mockResolvedValue([]);

    const req = new NextRequest('http://localhost/api/admin/versions?page=2&limit=20', { method: 'GET' });
    const res = await getVersions(req, {});

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.pagination).toEqual({
      total: 60,
      totalCount: 60,
      page: 2,
      currentPage: 2,
      limit: 20,
      pageSize: 20,
      totalPages: 3,
      isPaginated: true,
    });

    expect(mockPrisma.snapshotVersion.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: 'desc' },
      take: 20,
      skip: 20,
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
      partner1Name: 'Alice',
      partner2Name: 'Bob',
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
        partner1Name: 'Alice',
        partner2Name: 'Bob',
        brideName: 'Alice',
        groomName: 'Bob',
        latitude: 45.0,
        longitude: -93.0,
      }),
      create: expect.objectContaining({
        id: 'global',
        partner1Name: 'Alice',
        partner2Name: 'Bob',
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
      itemType: 'PHYSICAL',
      paymentHandleType: null,
      paymentHandle: null,
      name: 'Kitchen Mixer',
      description: 'For baking',
      category: 'Home',
      price: 299.99,
      imageId: 'mixer-img',
      vendorUrl: 'https://vendor.com/mixer',
      quantity: 1,
      isGroupGift: true,
      isMostWanted: false,
      displayOrder: 0,
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

  it('restores legacy RegistryItem successfully resolving fallbacks', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const mockLegacyRegistrySnapshot = {
      legacy_name: 'Legacy Mixer',
      title: 'Old Title',
      itemName: 'Old Name',
      legacy_description: 'Legacy details',
      details: 'Old Details',
      legacy_category: 'Legacy Group',
      group: 'Old Group',
      legacy_price: 199.99,
      cost: 150,
      priceAmount: 160,
      legacy_imageId: 'legacy-img',
      mediaId: 'old-media',
      legacy_vendorUrl: 'https://legacy-vendor.com',
      legacy_quantity: 2,
      qty: 3,
      itemCount: 4,
      legacy_isGroupGift: true,
      purchased: true,
      purchaserName: 'Alice',
      amountContributed: 40.0,
    };

    const mockVersion = {
      id: 'v-legacy-reg',
      entityType: 'RegistryItem',
      entityId: 'reg-legacy-mixer',
      data: mockLegacyRegistrySnapshot,
    };

    (mockPrisma.snapshotVersion.findUnique as jest.Mock).mockResolvedValue(mockVersion);
    (mockPrisma.registryItem.upsert as jest.Mock).mockResolvedValue({});

    const req = new NextRequest('http://localhost/api/admin/versions/v-legacy-reg/restore', { method: 'POST' });
    const res = await restoreVersion(req, { params: Promise.resolve({ id: 'v-legacy-reg' }) });

    expect(res.status).toBe(200);
    const expectedTranslatedData = {
      itemType: 'PHYSICAL',
      paymentHandleType: null,
      paymentHandle: null,
      name: 'Legacy Mixer',
      description: 'Legacy details',
      category: 'Legacy Group',
      price: 199.99,
      imageId: 'legacy-img',
      vendorUrl: 'https://legacy-vendor.com',
      quantity: 2,
      isGroupGift: true,
      isMostWanted: false,
      displayOrder: 0,
      purchased: true,
      purchaserName: 'Alice',
      amountContributed: 40.0,
    };
    expect(mockPrisma.registryItem.upsert).toHaveBeenCalledWith({
      where: { id: 'reg-legacy-mixer' },
      update: expectedTranslatedData,
      create: { id: 'reg-legacy-mixer', ...expectedTranslatedData },
    });
  });

  it('restores registry items with alternative older custom fields', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const mockOlderSnapshot = {
      title: 'Old Title',
      details: 'Old Details',
      group: 'Old Group',
      cost: 150,
      mediaId: 'old-media',
      qty: 3,
    };

    const mockVersion = {
      id: 'v-older-reg',
      entityType: 'RegistryItem',
      entityId: 'reg-older-mixer',
      data: mockOlderSnapshot,
    };

    (mockPrisma.snapshotVersion.findUnique as jest.Mock).mockResolvedValue(mockVersion);
    (mockPrisma.registryItem.upsert as jest.Mock).mockResolvedValue({});

    const req = new NextRequest('http://localhost/api/admin/versions/v-older-reg/restore', { method: 'POST' });
    const res = await restoreVersion(req, { params: Promise.resolve({ id: 'v-older-reg' }) });

    expect(res.status).toBe(200);
    const expectedTranslatedData = {
      itemType: 'PHYSICAL',
      paymentHandleType: null,
      paymentHandle: null,
      name: 'Old Title',
      description: 'Old Details',
      category: 'Old Group',
      price: 150,
      imageId: 'old-media',
      vendorUrl: null,
      quantity: 3,
      isGroupGift: false,
      isMostWanted: false,
      displayOrder: 0,
      purchased: false,
      purchaserName: undefined,
      amountContributed: 0,
    };
    expect(mockPrisma.registryItem.upsert).toHaveBeenCalledWith({
      where: { id: 'reg-older-mixer' },
      update: expectedTranslatedData,
      create: { id: 'reg-older-mixer', ...expectedTranslatedData },
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

  it('preserves brand media, layout tokens, and non-secret delivery settings without overwriting omitted secrets on AppConfig rollback', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const fullAppConfigSnapshot = {
      partner1Name: 'Alex',
      partner2Name: 'Taylor',
      contactEmail: 'couple@example.com',
      brandMonogram: 'A&T',
      brandLogoUrl: '/images/logo.svg',
      brandLogoAlt: 'Couple Logo',
      heroImageUrl: '/images/hero.jpg',
      heroImageAlt: 'Sunset portrait',
      brandWatermarkUrl: '/images/watermark.svg',
      brandWatermarkAlt: 'Watermark',
      badgeGraphicUrl: '/images/badge.svg',
      badgeGraphicAlt: 'Crest',
      layoutContainerMaxWidth: '72rem',
      layoutGridGap: '2rem',
      layoutCardPadding: '2.5rem',
      layoutBorderRadius: '0.75rem',
      emailProvider: 'smtp',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpUser: 'mailer',
      smtpPass: '',
      twilioAccountSid: 'AC_RESTORED',
      twilioAuthToken: '',
    };

    (mockPrisma.snapshotVersion.findUnique as jest.Mock).mockResolvedValue({
      id: 'v-app-full',
      entityType: 'AppConfig',
      entityId: 'global',
      data: fullAppConfigSnapshot,
    });
    (mockPrisma.appConfig.upsert as jest.Mock).mockResolvedValue({});

    const req = new NextRequest('http://localhost/api/admin/versions/v-app-full/restore', { method: 'POST' });
    const res = await restoreVersion(req, { params: Promise.resolve({ id: 'v-app-full' }) });

    expect(res.status).toBe(200);
    const upsertArg = (mockPrisma.appConfig.upsert as jest.Mock).mock.calls[0][0];
    expect(upsertArg.update).toMatchObject({
      contactEmail: 'couple@example.com',
      brandMonogram: 'A&T',
      brandLogoUrl: '/images/logo.svg',
      brandLogoAlt: 'Couple Logo',
      heroImageUrl: '/images/hero.jpg',
      heroImageAlt: 'Sunset portrait',
      brandWatermarkUrl: '/images/watermark.svg',
      brandWatermarkAlt: 'Watermark',
      badgeGraphicUrl: '/images/badge.svg',
      badgeGraphicAlt: 'Crest',
      layoutContainerMaxWidth: '72rem',
      layoutGridGap: '2rem',
      layoutCardPadding: '2.5rem',
      layoutBorderRadius: '0.75rem',
      emailProvider: 'smtp',
      smtpHost: 'smtp.example.com',
      twilioAccountSid: 'AC_RESTORED',
    });
    expect(upsertArg.update.smtpPass).toBeUndefined();
    expect(upsertArg.update.twilioAuthToken).toBeUndefined();
  });

  it('preserves hotel block details on Attraction and thank-you metadata on Contributor rollback', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    (mockPrisma.media.findUnique as jest.Mock).mockResolvedValue({ id: 'img-hotel' });
    (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue({ id: 'inv-guest-1' });
    (mockPrisma.registryItem.findUnique as jest.Mock).mockResolvedValue({ id: 'reg-1' });
    (mockPrisma.attraction.upsert as jest.Mock).mockResolvedValue({});
    (mockPrisma.contributor.upsert as jest.Mock).mockResolvedValue({});

    const hotelSnapshot = {
      name: 'Harbor Hotel',
      description: 'Room block venue',
      imageId: 'img-hotel',
      category: 'Hotel',
      website: 'https://harbor.example.com',
      directions: 'Downtown waterfront',
      latitude: 41.88,
      longitude: -87.62,
      isVisible: true,
      promoCode: 'WED2026',
      bookingUrl: 'https://harbor.example.com/book',
      roomRate: '$189/night',
      cutoffDate: '2026-08-01',
      shuttleInfo: 'Shuttle departs at 4:15 PM',
      isSample: false,
    };

    (mockPrisma.snapshotVersion.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'v-hotel',
      entityType: 'Attraction',
      entityId: 'attr-hotel',
      data: hotelSnapshot,
    });

    const attrRes = await restoreVersion(
      new NextRequest('http://localhost/api/admin/versions/v-hotel/restore', { method: 'POST' }),
      { params: Promise.resolve({ id: 'v-hotel' }) },
    );
    expect(attrRes.status).toBe(200);
    expect(mockPrisma.attraction.upsert).toHaveBeenCalledWith({
      where: { id: 'attr-hotel' },
      update: hotelSnapshot,
      create: { id: 'attr-hotel', ...hotelSnapshot },
    });

    const contributorSnapshot = {
      name: 'Jordan Lee',
      email: 'jordan@example.com',
      isPlusOne: false,
      amount: 150,
      coverFee: true,
      feeAmount: 4.5,
      message: 'Congratulations!',
      date: '2026-06-15T12:00:00.000Z',
      thankYouStatus: 'Sent',
      thankYouSentAt: '2026-06-20T15:00:00.000Z',
      thankYouNote: 'Thank you for your generous gift!',
      stripePaymentIntentId: 'pi_test_123',
      stripeChargeId: 'ch_test_123',
      transactionTimestamp: '2026-06-15T12:00:05.000Z',
      registryItemId: 'reg-1',
      invitationCodeId: 'inv-guest-1',
    };

    (mockPrisma.snapshotVersion.findUnique as jest.Mock).mockResolvedValueOnce({
      id: 'v-contrib-full',
      entityType: 'Contributor',
      entityId: 'contrib-full',
      data: contributorSnapshot,
    });

    const contribRes = await restoreVersion(
      new NextRequest('http://localhost/api/admin/versions/v-contrib-full/restore', { method: 'POST' }),
      { params: Promise.resolve({ id: 'v-contrib-full' }) },
    );
    expect(contribRes.status).toBe(200);
    expect(mockPrisma.contributor.upsert).toHaveBeenCalledWith({
      where: { id: 'contrib-full' },
      update: expect.objectContaining({
        coverFee: true,
        feeAmount: 4.5,
        message: 'Congratulations!',
        thankYouStatus: 'Sent',
        thankYouSentAt: new Date('2026-06-20T15:00:00.000Z'),
        thankYouNote: 'Thank you for your generous gift!',
        stripePaymentIntentId: 'pi_test_123',
        stripeChargeId: 'ch_test_123',
        transactionTimestamp: new Date('2026-06-15T12:00:05.000Z'),
        invitationCodeId: 'inv-guest-1',
      }),
      create: expect.objectContaining({
        id: 'contrib-full',
        invitationCodeId: 'inv-guest-1',
      }),
    });
  });

  it('restores InvitationCode, SeatingTable, SubEvent, SubEventAccess, SubEventRsvp, BroadcastMessage, and BroadcastRecipient versions', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    (mockPrisma.seatingTable.findUnique as jest.Mock).mockResolvedValue({ id: 'table-1' });
    (mockPrisma.invitationCode.findUnique as jest.Mock).mockResolvedValue({ id: 'inv-1' });
    (mockPrisma.invitationCode.upsert as jest.Mock).mockResolvedValue({});
    (mockPrisma.seatingTable.upsert as jest.Mock).mockResolvedValue({});
    (mockPrisma.subEvent.upsert as jest.Mock).mockResolvedValue({});
    (mockPrisma.subEventAccess.upsert as jest.Mock).mockResolvedValue({});
    (mockPrisma.subEventRsvp.upsert as jest.Mock).mockResolvedValue({});
    (mockPrisma.broadcastMessage.upsert as jest.Mock).mockResolvedValue({});
    (mockPrisma.broadcastRecipient.upsert as jest.Mock).mockResolvedValue({});

    const cases = [
      {
        id: 'v-table',
        entityType: 'SeatingTable',
        entityId: 'table-1',
        data: { name: 'Head Table', shape: 'rectangle', capacity: 10, x: 50, y: 60 },
      },
      {
        id: 'v-invite',
        entityType: 'InvitationCode',
        entityId: 'inv-1',
        data: {
          code: 'GUEST01',
          guestName: 'Sam Rivera',
          email: 'sam@example.com',
          dietaryNotes: 'Vegetarian',
          plusOneAllocations: 1,
          partyTags: ['vip'],
          tableId: 'table-1',
          seatNumber: 3,
        },
      },
      {
        id: 'v-subevent',
        entityType: 'SubEvent',
        entityId: 'se-1',
        data: {
          title: 'Welcome Reception',
          description: 'Drinks on the terrace',
          startTime: '2026-09-18T18:00:00.000Z',
          locationName: 'Rooftop',
          isPrivate: true,
        },
      },
      {
        id: 'v-access',
        entityType: 'SubEventAccess',
        entityId: 'sea-1',
        data: { subEventId: 'se-1', invitationCodeId: 'inv-1' },
      },
      {
        id: 'v-rsvp',
        entityType: 'SubEventRsvp',
        entityId: 'rsvp-1',
        data: { subEventId: 'se-1', invitationCodeId: 'inv-1', status: 'attending', plusOneCount: 1 },
      },
      {
        id: 'v-bcast',
        entityType: 'BroadcastMessage',
        entityId: 'bm-1',
        data: { channel: 'EMAIL', subject: 'Reminder', body: 'Doors open at 6 PM', status: 'SENT' },
      },
      {
        id: 'v-recip',
        entityType: 'BroadcastRecipient',
        entityId: 'br-1',
        data: {
          broadcastId: 'bm-1',
          invitationCodeId: 'inv-1',
          guestName: 'Sam Rivera',
          destination: 'sam@example.com',
          status: 'SENT',
        },
      },
    ];

    for (const versionCase of cases) {
      (mockPrisma.snapshotVersion.findUnique as jest.Mock).mockResolvedValueOnce(versionCase);
      const res = await restoreVersion(
        new NextRequest(`http://localhost/api/admin/versions/${versionCase.id}/restore`, { method: 'POST' }),
        { params: Promise.resolve({ id: versionCase.id }) },
      );
      expect(res.status).toBe(200);
    }

    expect(mockPrisma.seatingTable.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.invitationCode.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.subEvent.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.subEventAccess.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.subEventRsvp.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.broadcastMessage.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.broadcastRecipient.upsert).toHaveBeenCalledTimes(1);
  });
});
