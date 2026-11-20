/** @jest-environment node */

import { GET } from '../maintenance/export/route';
import { POST } from '../maintenance/import/route';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/core/auth/auth.server';
import { createAuditSnapshot, pruneSnapshotsBulk } from '@/lib/audit';
import { DEFAULT_MODULE_CONFIG } from '@/lib/modules';

jest.mock('next/server', () => {
  class MockNextResponse {
    static json = jest.fn((body, init) => {
      const responseCookies = new Map();
      const headers = new Headers();
      if (init?.headers) {
        Object.entries(init.headers).forEach(([k, v]) => headers.set(k, v as string));
      }
      const cookies = {
        set: jest.fn((key, value, options) => {
          responseCookies.set(key, { name: key, value });
          let cookieString = `${key}=${value}; Path=/`;
          if (options?.expires) cookieString += `; Expires=${options.expires.toUTCString()}`;
          if (options?.maxAge === 0) cookieString += '; Max-Age=0';
          headers.set('set-cookie', cookieString);
        }),
        get: jest.fn((key) => responseCookies.get(key)),
        delete: jest.fn((key) => responseCookies.delete(key)),
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
      if (typeof this.bodyContent === 'string') {
        return JSON.parse(this.bodyContent);
      }
      if (this.bodyContent && typeof (this.bodyContent as any).getReader === 'function') {
        const reader = (this.bodyContent as any).getReader();
        const decoder = new TextDecoder();
        let result = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          result += decoder.decode(value, { stream: true });
        }
        result += decoder.decode();
        return JSON.parse(result);
      }
      return this.bodyContent;
    }
  }

  const MockNextRequest = jest.fn((input, init) => {
    const requestCookies = new Map();
    if (init?.headers?.cookie) {
      init.headers.cookie.split(';').forEach((c: string) => {
        const [key, value] = c.trim().split('=');
        requestCookies.set(key, { name: key, value });
      });
    }
    return {
      ...init,
      url: input,
      headers: {
        get: (key: string) => {
          if (key === 'cookie' && init?.headers) return init.headers.cookie;
          return null;
        }
      },
      cookies: {
        get: jest.fn((key) => requestCookies.get(key)),
        set: jest.fn(),
      },
      json: () => Promise.resolve(init && init.body ? JSON.parse(init.body) : {}),
    };
  });

  return {
    NextResponse: MockNextResponse,
    NextRequest: MockNextRequest,
  };
});

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    appConfig: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    contentNode: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    media: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    seatingTable: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    invitationCode: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    weddingPartyMember: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    attraction: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    registryItem: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    contributor: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    subEvent: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    subEventAccess: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    subEventRsvp: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    broadcastMessage: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    broadcastRecipient: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    snapshotVersion: { findMany: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() },
  },
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

jest.mock('@/lib/audit', () => ({
  createAuditSnapshot: jest.fn().mockResolvedValue(undefined),
  pruneSnapshotsBulk: jest.fn().mockResolvedValue(undefined),
}));

const mockPrisma = prisma as any;
const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;
const mockCreateAuditSnapshot = createAuditSnapshot as jest.MockedFunction<typeof createAuditSnapshot>;
const mockPruneSnapshotsBulk = pruneSnapshotsBulk as jest.MockedFunction<typeof pruneSnapshotsBulk>;

describe('Maintenance API Routes Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(true); // Default to admin authorized
  });

  describe('GET /api/admin/maintenance/export', () => {
    test('requires admin authorization', async () => {
      mockIsAdminRequest.mockResolvedValue(false);
      const req = new NextRequest('http://localhost/api/admin/maintenance/export');
      const res = await GET(req);

      expect(res.status).toBe(401);
    });

    test('returns 200 with JSON file attachment containing all 15 models in schemaVersion 2.0', async () => {
      const mockAppConfig = [{ id: 'global', brideName: 'Alice' }];
      const mockContentNode = [{ id: 'cn1', type: 'FAQ', tags: ['FAQ'], data: { q: 'When?' } }];
      const mockMedia = [{ id: 'm1', url: 'https://example.com/photo.jpg', isDecorative: false }];
      const mockSeatingTable = [{ id: 'st1', name: 'Table 1', capacity: 8 }];
      const mockInvitationCode = [{ id: 'ic1', code: 'INV001', guestName: 'Sam', tableId: 'st1' }];
      const mockWeddingParty = [{ id: 'wp1', name: 'Bob' }];
      const mockAttraction = [{ id: 'att1', name: 'Beach' }];
      const mockRegistry = [{ id: 'ri1', name: 'Kitchenware' }];
      const mockContributor = [{ id: 'c1', name: 'John', invitationCodeId: 'ic1' }];
      const mockSubEvent = [{ id: 'se1', title: 'Ceremony' }];
      const mockSubEventAccess = [{ id: 'sea1', subEventId: 'se1', invitationCodeId: 'ic1' }];
      const mockSubEventRsvp = [{ id: 'rsvp1', subEventId: 'se1', invitationCodeId: 'ic1', status: 'attending' }];
      const mockBroadcastMessage = [{ id: 'bm1', channel: 'EMAIL', body: 'Hello guests' }];
      const mockBroadcastRecipient = [{ id: 'br1', broadcastId: 'bm1', guestName: 'Sam', destination: 'sam@example.com' }];
      const mockSnapshot = [{ id: 'sv1', entityType: 'Media', entityId: 'm1', data: {} }];

      mockPrisma.appConfig.findMany.mockResolvedValue(mockAppConfig as any);
      mockPrisma.contentNode.findMany.mockResolvedValue(mockContentNode as any);
      mockPrisma.media.findMany.mockResolvedValue(mockMedia as any);
      mockPrisma.seatingTable.findMany.mockResolvedValue(mockSeatingTable as any);
      mockPrisma.invitationCode.findMany.mockResolvedValue(mockInvitationCode as any);
      mockPrisma.weddingPartyMember.findMany.mockResolvedValue(mockWeddingParty as any);
      mockPrisma.attraction.findMany.mockResolvedValue(mockAttraction as any);
      mockPrisma.registryItem.findMany.mockResolvedValue(mockRegistry as any);
      mockPrisma.contributor.findMany.mockResolvedValue(mockContributor as any);
      mockPrisma.subEvent.findMany.mockResolvedValue(mockSubEvent as any);
      mockPrisma.subEventAccess.findMany.mockResolvedValue(mockSubEventAccess as any);
      mockPrisma.subEventRsvp.findMany.mockResolvedValue(mockSubEventRsvp as any);
      mockPrisma.broadcastMessage.findMany.mockResolvedValue(mockBroadcastMessage as any);
      mockPrisma.broadcastRecipient.findMany.mockResolvedValue(mockBroadcastRecipient as any);
      mockPrisma.snapshotVersion.findMany.mockResolvedValue(mockSnapshot as any);

      const req = new NextRequest('http://localhost/api/admin/maintenance/export');
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/json');
      expect(res.headers.get('Content-Disposition')).toContain('attachment; filename="wedding-backup-');

      const data = await res.json();
      expect(data).toEqual({
        version: '2.0',
        schemaVersion: '2.0',
        exportedAt: expect.any(String),
        appConfig: mockAppConfig,
        contentNode: mockContentNode,
        media: mockMedia,
        seatingTable: mockSeatingTable,
        invitationCode: mockInvitationCode,
        weddingPartyMember: mockWeddingParty,
        attraction: mockAttraction,
        registryItem: mockRegistry,
        contributor: mockContributor,
        subEvent: mockSubEvent,
        subEventAccess: mockSubEventAccess,
        subEventRsvp: mockSubEventRsvp,
        broadcastMessage: mockBroadcastMessage,
        broadcastRecipient: mockBroadcastRecipient,
        snapshotVersion: mockSnapshot,
      });
    });

    test('fetches records sequentially using cursor pagination across multiple chunks', async () => {
      const chunk1 = Array.from({ length: 100 }, (_, i) => ({ id: `ri_${i + 1}`, name: `Item ${i + 1}` }));
      const chunk2 = Array.from({ length: 50 }, (_, i) => ({ id: `ri_${i + 101}`, name: `Item ${i + 101}` }));

      mockPrisma.appConfig.findMany.mockResolvedValue([]);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);
      mockPrisma.media.findMany.mockResolvedValue([]);
      mockPrisma.seatingTable.findMany.mockResolvedValue([]);
      mockPrisma.invitationCode.findMany.mockResolvedValue([]);
      mockPrisma.weddingPartyMember.findMany.mockResolvedValue([]);
      mockPrisma.attraction.findMany.mockResolvedValue([]);
      mockPrisma.registryItem.findMany
        .mockResolvedValueOnce(chunk1 as any)
        .mockResolvedValueOnce(chunk2 as any);
      mockPrisma.contributor.findMany.mockResolvedValue([]);
      mockPrisma.subEvent.findMany.mockResolvedValue([]);
      mockPrisma.subEventAccess.findMany.mockResolvedValue([]);
      mockPrisma.subEventRsvp.findMany.mockResolvedValue([]);
      mockPrisma.broadcastMessage.findMany.mockResolvedValue([]);
      mockPrisma.broadcastRecipient.findMany.mockResolvedValue([]);
      mockPrisma.snapshotVersion.findMany.mockResolvedValue([]);

      const req = new NextRequest('http://localhost/api/admin/maintenance/export');
      const res = await GET(req);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.registryItem).toHaveLength(150);
      expect(data.registryItem[0].id).toBe('ri_1');
      expect(data.registryItem[149].id).toBe('ri_150');

      expect(mockPrisma.registryItem.findMany).toHaveBeenNthCalledWith(1, {
        take: 100,
        orderBy: { id: 'asc' },
      });
      expect(mockPrisma.registryItem.findMany).toHaveBeenNthCalledWith(2, {
        take: 100,
        orderBy: { id: 'asc' },
        cursor: { id: 'ri_100' },
        skip: 1,
      });
    });

    test('redacts raw provider secrets and strips virtual DTO keys while retaining non-secret delivery settings', async () => {
      mockPrisma.appConfig.findMany.mockResolvedValue([
        {
          id: 'global',
          brideName: 'Alice',
          adminPassword: 'SuperSecretPassword',
          databaseUrl: 'postgres://secret:password@localhost/db',
          multisiteEnabled: true,
          typographyScale: { heading: '2rem' },
          modules: { rsvp: true },
          emailProvider: 'smtp',
          smtpHost: 'smtp.example.invalid',
          smtpPort: 587,
          smtpUser: 'mailer@example.invalid',
          smtpFrom: 'noreply@example.invalid',
          smtpSecure: true,
          smtpPass: 'smtp-secret-pass',
          resendApiKey: 're_secret',
          resendFrom: 'updates@example.invalid',
          sendgridApiKey: 'SG.secret',
          sendgridFrom: 'hello@example.invalid',
          smsProvider: 'twilio',
          twilioAccountSid: 'AC_PUBLIC_SID',
          twilioFromNumber: '+15551234567',
          twilioAuthToken: 'twilio-secret-token',
          broadcastBatchSize: 40,
          broadcastBatchDelayMs: 750,
        },
      ] as any);
      mockPrisma.contentNode.findMany.mockResolvedValue([]);
      mockPrisma.media.findMany.mockResolvedValue([]);
      mockPrisma.seatingTable.findMany.mockResolvedValue([]);
      mockPrisma.invitationCode.findMany.mockResolvedValue([]);
      mockPrisma.weddingPartyMember.findMany.mockResolvedValue([]);
      mockPrisma.attraction.findMany.mockResolvedValue([]);
      mockPrisma.registryItem.findMany.mockResolvedValue([]);
      mockPrisma.contributor.findMany.mockResolvedValue([]);
      mockPrisma.subEvent.findMany.mockResolvedValue([]);
      mockPrisma.subEventAccess.findMany.mockResolvedValue([]);
      mockPrisma.subEventRsvp.findMany.mockResolvedValue([]);
      mockPrisma.broadcastMessage.findMany.mockResolvedValue([]);
      mockPrisma.broadcastRecipient.findMany.mockResolvedValue([]);
      mockPrisma.snapshotVersion.findMany.mockResolvedValue([
        {
          id: 'sv-config',
          entityType: 'AppConfig',
          entityId: 'global',
          data: {
            id: 'global',
            brideName: 'Alice',
            multisiteEnabled: true,
            smtpHost: 'smtp.historical.invalid',
            smtpPass: 'historical-smtp-secret',
            twilioAccountSid: 'AC_HISTORICAL_SID',
            twilioAuthToken: 'historical-twilio-secret',
          },
        },
      ] as any);

      const req = new NextRequest('http://localhost/api/admin/maintenance/export');
      const res = await GET(req);

      const data = await res.json();
      expect(data.appConfig[0].brideName).toBe('Alice');
      expect(data.appConfig[0].emailProvider).toBe('smtp');
      expect(data.appConfig[0].smtpHost).toBe('smtp.example.invalid');
      expect(data.appConfig[0].smtpUser).toBe('mailer@example.invalid');
      expect(data.appConfig[0].twilioAccountSid).toBe('AC_PUBLIC_SID');
      expect(data.appConfig[0].twilioFromNumber).toBe('+15551234567');
      expect(data.appConfig[0].broadcastBatchSize).toBe(40);
      expect(data.appConfig[0].broadcastBatchDelayMs).toBe(750);
      expect(data.appConfig[0].multisiteEnabled).toBeUndefined();
      expect(data.appConfig[0].typographyScale).toBeUndefined();
      expect(data.appConfig[0].modules).toEqual(DEFAULT_MODULE_CONFIG);
      expect(data.appConfig[0].adminPassword).toBeUndefined();
      expect(data.appConfig[0].databaseUrl).toBeUndefined();
      expect(data.appConfig[0].smtpPass).toBeUndefined();
      expect(data.appConfig[0].resendApiKey).toBeUndefined();
      expect(data.appConfig[0].sendgridApiKey).toBeUndefined();
      expect(data.appConfig[0].twilioAuthToken).toBeUndefined();
      expect(data.snapshotVersion[0].data.brideName).toBe('Alice');
      expect(data.snapshotVersion[0].data.smtpHost).toBe('smtp.historical.invalid');
      expect(data.snapshotVersion[0].data.twilioAccountSid).toBe('AC_HISTORICAL_SID');
      expect(data.snapshotVersion[0].data.multisiteEnabled).toBeUndefined();
      expect(data.snapshotVersion[0].data.smtpPass).toBeUndefined();
      expect(data.snapshotVersion[0].data.twilioAuthToken).toBeUndefined();
    });
  });

  describe('POST /api/admin/maintenance/import', () => {
    test('requires admin authorization', async () => {
      mockIsAdminRequest.mockResolvedValue(false);
      const req = new NextRequest('http://localhost/api/admin/maintenance/import', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const res = await POST(req);

      expect(res.status).toBe(401);
    });

    test('rejects import if required structures (appConfig, registryItem) are missing', async () => {
      const invalidBackup = {
        weddingPartyMember: [{ id: 'wp1', name: 'Only Wedding Party' }],
      };

      const req = new NextRequest('http://localhost/api/admin/maintenance/import', {
        method: 'POST',
        body: JSON.stringify(invalidBackup),
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      // Wait, let's verify if the error is "Invalid backup file structure" or "Validation Error" (Zod validation is run before structural checks).
      // Since ImportBackupSchema has optional arrays, validation passes, and then the structural check throws 'Invalid backup file structure'.
      expect(body.error).toBe('Invalid backup file structure');
    });

    test('executes transaction to clear old records and bulk inserts backup successfully', async () => {
      const validBackup = {
        appConfig: [
          {
            id: 'global',
            brideName: 'Alice',
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
        contentNode: [
          {
            id: 'cn1',
            type: 'FAQ',
            tags: ['FAQ'],
            data: { question: 'What is the dress code?', answer: 'Semi-formal' },
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
        media: [
          {
            id: 'm1',
            url: 'https://example.com/photo.jpg',
            isDecorative: false,
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          }
        ],
        weddingPartyMember: [
          {
            id: 'wp1',
            name: 'Bob',
            role: 'Best Man',
            bio: 'Best Man Bio',
            photoId: 'photo-id',
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
        attraction: [
          {
            id: 'att1',
            name: 'Coaster',
            description: 'Coaster Description',
            category: 'Fun',
            website: 'https://coaster.com',
            directions: 'Ride instructions',
            latitude: 41.8781,
            longitude: -87.6298,
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
        registryItem: [
          {
            id: 'ri1',
            name: 'Plates',
            description: 'Ceramic Plates',
            category: 'Kitchen',
            price: 50,
            imageId: 'image-id',
            quantity: 2,
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
        contributor: [
          {
            id: 'c1',
            name: 'John',
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
      };

      // Mock database transaction client
      const mockTx = {
        contributor: { deleteMany: jest.fn(), createMany: jest.fn() },
        registryItem: { deleteMany: jest.fn(), createMany: jest.fn() },
        attraction: { deleteMany: jest.fn(), createMany: jest.fn() },
        weddingPartyMember: { deleteMany: jest.fn(), createMany: jest.fn() },
        media: { deleteMany: jest.fn(), createMany: jest.fn() },
        contentNode: { deleteMany: jest.fn(), createMany: jest.fn() },
        appConfig: { deleteMany: jest.fn(), createMany: jest.fn() },
      };

      mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockTx) => unknown) => {
        return callback(mockTx);
      });

      const req = new NextRequest('http://localhost/api/admin/maintenance/import', {
        method: 'POST',
        body: JSON.stringify(validBackup),
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ success: true });

      // Verify that deleteMany was called for all 7 tables in the correct order or transaction scope
      expect(mockTx.contributor.deleteMany).toHaveBeenCalled();
      expect(mockTx.registryItem.deleteMany).toHaveBeenCalled();
      expect(mockTx.attraction.deleteMany).toHaveBeenCalled();
      expect(mockTx.weddingPartyMember.deleteMany).toHaveBeenCalled();
      expect(mockTx.media.deleteMany).toHaveBeenCalled();
      expect(mockTx.contentNode.deleteMany).toHaveBeenCalled();
      expect(mockTx.appConfig.deleteMany).toHaveBeenCalled();

      // Verify that createMany was called with correctly revived Date objects
      expect(mockTx.appConfig.createMany).toHaveBeenCalledWith({
        data: [
          {
            id: 'global',
            brideName: 'Alice',
            createdAt: new Date('2026-06-20T00:00:00.000Z'),
            updatedAt: new Date('2026-06-20T00:00:00.000Z'),
          },
        ],
      });
      expect(mockTx.contentNode.createMany).toHaveBeenCalledWith({
        data: [
          {
            id: 'cn1',
            type: 'FAQ',
            tags: ['FAQ'],
            data: { question: 'What is the dress code?', answer: 'Semi-formal' },
            createdAt: new Date('2026-06-20T00:00:00.000Z'),
            updatedAt: new Date('2026-06-20T00:00:00.000Z'),
          },
        ],
      });
      expect(mockTx.media.createMany).toHaveBeenCalledWith({
        data: [
          {
            id: 'm1',
            url: 'https://example.com/photo.jpg',
            isDecorative: false,
            createdAt: new Date('2026-06-20T00:00:00.000Z'),
            updatedAt: new Date('2026-06-20T00:00:00.000Z'),
          },
        ],
      });
      expect(mockTx.weddingPartyMember.createMany).toHaveBeenCalledWith({
        data: [
          {
            id: 'wp1',
            name: 'Bob',
            role: 'Best Man',
            bio: 'Best Man Bio',
            photoId: 'photo-id',
            createdAt: new Date('2026-06-20T00:00:00.000Z'),
            updatedAt: new Date('2026-06-20T00:00:00.000Z'),
          },
        ],
      });
      expect(mockTx.attraction.createMany).toHaveBeenCalledWith({
        data: [
          {
            id: 'att1',
            name: 'Coaster',
            description: 'Coaster Description',
            category: 'Fun',
            website: 'https://coaster.com',
            directions: 'Ride instructions',
            latitude: 41.8781,
            longitude: -87.6298,
            createdAt: new Date('2026-06-20T00:00:00.000Z'),
            updatedAt: new Date('2026-06-20T00:00:00.000Z'),
          },
        ],
      });
      expect(mockTx.registryItem.createMany).toHaveBeenCalledWith({
        data: [
          {
            id: 'ri1',
            name: 'Plates',
            description: 'Ceramic Plates',
            category: 'Kitchen',
            price: 50,
            imageId: 'image-id',
            quantity: 2,
            createdAt: new Date('2026-06-20T00:00:00.000Z'),
            updatedAt: new Date('2026-06-20T00:00:00.000Z'),
          },
        ],
      });
      expect(mockTx.contributor.createMany).toHaveBeenCalledWith({
        data: [
          {
            id: 'c1',
            name: 'John',
            createdAt: new Date('2026-06-20T00:00:00.000Z'),
            updatedAt: new Date('2026-06-20T00:00:00.000Z'),
          },
        ],
      });

      // Wait a tick to let background microtasks/audit logs run
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Assert background audit logs are created in bulk
      expect(mockPrisma.snapshotVersion.createMany).toHaveBeenCalledWith({
        data: [
          {
            entityType: 'AppConfig',
            entityId: 'global',
            data: {
              id: 'global',
              brideName: 'Alice',
              createdAt: new Date('2026-06-20T00:00:00.000Z'),
              updatedAt: new Date('2026-06-20T00:00:00.000Z'),
            },
            author: 'Admin/BulkImport',
          },
          {
            entityType: 'ContentNode',
            entityId: 'cn1',
            data: {
              id: 'cn1',
              type: 'FAQ',
              tags: ['FAQ'],
              data: { question: 'What is the dress code?', answer: 'Semi-formal' },
              createdAt: new Date('2026-06-20T00:00:00.000Z'),
              updatedAt: new Date('2026-06-20T00:00:00.000Z'),
            },
            author: 'Admin/BulkImport',
          },
          {
            entityType: 'WeddingPartyMember',
            entityId: 'wp1',
            data: {
              id: 'wp1',
              name: 'Bob',
              role: 'Best Man',
              bio: 'Best Man Bio',
              photoId: 'photo-id',
              createdAt: new Date('2026-06-20T00:00:00.000Z'),
              updatedAt: new Date('2026-06-20T00:00:00.000Z'),
            },
            author: 'Admin/BulkImport',
          },
          {
            entityType: 'Attraction',
            entityId: 'att1',
            data: {
              id: 'att1',
              name: 'Coaster',
              description: 'Coaster Description',
              category: 'Fun',
              website: 'https://coaster.com',
              directions: 'Ride instructions',
              latitude: 41.8781,
              longitude: -87.6298,
              createdAt: new Date('2026-06-20T00:00:00.000Z'),
              updatedAt: new Date('2026-06-20T00:00:00.000Z'),
            },
            author: 'Admin/BulkImport',
          },
          {
            entityType: 'RegistryItem',
            entityId: 'ri1',
            data: {
              id: 'ri1',
              name: 'Plates',
              description: 'Ceramic Plates',
              category: 'Kitchen',
              price: 50,
              imageId: 'image-id',
              quantity: 2,
              createdAt: new Date('2026-06-20T00:00:00.000Z'),
              updatedAt: new Date('2026-06-20T00:00:00.000Z'),
            },
            author: 'Admin/BulkImport',
          },
        ]
      });

      // Assert bulk pruning is triggered
      expect(mockPruneSnapshotsBulk).toHaveBeenCalledWith([
        { entityType: 'AppConfig', entityId: 'global' },
        { entityType: 'ContentNode', entityId: 'cn1' },
        { entityType: 'WeddingPartyMember', entityId: 'wp1' },
        { entityType: 'Attraction', entityId: 'att1' },
        { entityType: 'RegistryItem', entityId: 'ri1' },
      ]);
    });

    test('re-throws transaction execution errors and handles rollbacks', async () => {
      const validBackup = {
        appConfig: [
          {
            id: 'global',
            brideName: 'Alice',
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
        registryItem: [
          {
            id: 'ri1',
            name: 'Plates',
            description: 'Ceramic Plates',
            category: 'Kitchen',
            price: 50,
            imageId: 'image-id',
            quantity: 2,
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
      };

      mockPrisma.$transaction.mockRejectedValue(new Error('Transaction Failed'));

      const req = new NextRequest('http://localhost/api/admin/maintenance/import', {
        method: 'POST',
        body: JSON.stringify(validBackup),
      });
      const res = await POST(req);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Transaction Failed');
    });

    test('returns 400 when importing a Photo ContentNode with parent or percent-encoded traversal URL', async () => {
      for (const badUrl of ['/../canary-outside-public.txt', '/%2e%2e/canary-outside-public.txt']) {
        const backupWithBadPhoto = {
          appConfig: [
            {
              id: 'global',
              brideName: 'Alice',
              createdAt: '2026-06-20T00:00:00.000Z',
              updatedAt: '2026-06-20T00:00:00.000Z',
            },
          ],
          contentNode: [
            {
              id: 'photo-bad',
              type: 'Photo',
              tags: ['gallery'],
              data: { url: badUrl, status: 'PENDING', isVisible: false },
              createdAt: '2026-06-20T00:00:00.000Z',
              updatedAt: '2026-06-20T00:00:00.000Z',
            },
          ],
          registryItem: [],
        };

        const req = new NextRequest('http://localhost/api/admin/maintenance/import', {
          method: 'POST',
          body: JSON.stringify(backupWithBadPhoto),
        });
        const res = await POST(req);
        expect(res.status).toBe(400);
      }
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    test('handles errors during bulk import audit snapshot creation', async () => {
      const validBackup = {
        appConfig: [
          {
            id: 'global',
            brideName: 'Alice',
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
        registryItem: [
          {
            id: 'ri1',
            name: 'Plates',
            description: 'Ceramic Plates',
            category: 'Kitchen',
            price: 50,
            imageId: 'image-id',
            quantity: 2,
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
      };

      const mockTx = {
        contributor: { deleteMany: jest.fn(), createMany: jest.fn() },
        registryItem: { deleteMany: jest.fn(), createMany: jest.fn() },
        attraction: { deleteMany: jest.fn(), createMany: jest.fn() },
        weddingPartyMember: { deleteMany: jest.fn(), createMany: jest.fn() },
        media: { deleteMany: jest.fn(), createMany: jest.fn() },
        contentNode: { deleteMany: jest.fn(), createMany: jest.fn() },
        appConfig: { deleteMany: jest.fn(), createMany: jest.fn() },
      };

      mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockTx) => unknown) => {
        return callback(mockTx);
      });

      mockCreateAuditSnapshot.mockRejectedValueOnce(new Error('Audit Failed'));
      mockPrisma.snapshotVersion.createMany.mockRejectedValueOnce(new Error('Audit Failed'));
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const req = new NextRequest('http://localhost/api/admin/maintenance/import', {
        method: 'POST',
        body: JSON.stringify(validBackup),
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ success: true });

      // Wait a tick to let background microtasks/audit logs run and throw/catch error
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    test('strips unknown fields via DatabaseBackupSchema and exercises all reviveDates branches', async () => {
      const backupWithAllTypes = {
        appConfig: [
          {
            id: 'global',
            brideName: 'Alice',
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
            multisiteEnabled: true,
            nullField: null,
            undefinedField: undefined,
            numberField: 42,
            booleanField: true,
            arrayField: ['2026-06-20T00:00:00.000Z', { nestedDate: '2026-06-20T00:00:00.000Z' }],
          },
        ],
        contentNode: [
          {
            id: 'cn-dates',
            type: 'Timeline',
            tags: ['schedule'],
            data: {
              nullField: null,
              numberField: 42,
              booleanField: true,
              items: ['2026-06-20T00:00:00.000Z', { nestedDate: '2026-06-20T00:00:00.000Z' }],
            },
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
        registryItem: [
          {
            id: 'ri1',
            name: 'Plates',
            description: 'Ceramic Plates',
            category: 'Kitchen',
            price: 50,
            imageId: 'image-id',
            quantity: 2,
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
      };

      const mockTx = {
        contributor: { deleteMany: jest.fn(), createMany: jest.fn() },
        registryItem: { deleteMany: jest.fn(), createMany: jest.fn() },
        attraction: { deleteMany: jest.fn(), createMany: jest.fn() },
        weddingPartyMember: { deleteMany: jest.fn(), createMany: jest.fn() },
        media: { deleteMany: jest.fn(), createMany: jest.fn() },
        contentNode: { deleteMany: jest.fn(), createMany: jest.fn() },
        appConfig: { deleteMany: jest.fn(), createMany: jest.fn() },
      };

      mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockTx) => unknown) => {
        return callback(mockTx);
      });

      const req = new NextRequest('http://localhost/api/admin/maintenance/import', {
        method: 'POST',
        body: JSON.stringify(backupWithAllTypes),
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ success: true });

      expect(mockTx.appConfig.createMany).toHaveBeenCalledWith({
        data: [
          {
            id: 'global',
            brideName: 'Alice',
            createdAt: new Date('2026-06-20T00:00:00.000Z'),
            updatedAt: new Date('2026-06-20T00:00:00.000Z'),
          },
        ],
      });
    });

    test('imports legacy 1.0 backup by stripping virtual fields, preserving live provider secrets, and clearing orphaned invitationCodeId links', async () => {
      const legacyBackup = {
        version: '1.0',
        schemaVersion: '1.0',
        appConfig: [
          {
            id: 'global',
            partner1Name: 'Alex',
            partner2Name: 'Taylor',
            multisiteEnabled: false,
            typographyScale: { display: '3rem' },
            spacingScale: { section: '4rem' },
            borderTreatment: { radius: '1rem' },
            brandDimensions: { logoWidth: '120px' },
            modules: { registry: true },
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
        registryItem: [
          {
            id: 'ri1',
            name: 'Honeymoon Fund',
            description: 'Flights and hotel',
            category: 'Travel',
            price: 500,
            imageId: 'm1',
            quantity: 1,
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
        contributor: [
          {
            id: 'c-orphan',
            name: 'Guest Contributor',
            amount: 100,
            registryItemId: 'ri1',
            invitationCodeId: 'missing-invitation-id',
            thankYouStatus: 'Sent',
            thankYouNote: 'Thank you so much!',
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
      };

      const callOrder: string[] = [];
      const makeTrackedModel = (name: string) => ({
        deleteMany: jest.fn(async () => {
          callOrder.push(`delete:${name}`);
        }),
        createMany: jest.fn(async () => {
          callOrder.push(`create:${name}`);
        }),
      });

      const mockTx = {
        broadcastRecipient: makeTrackedModel('broadcastRecipient'),
        broadcastMessage: makeTrackedModel('broadcastMessage'),
        subEventRsvp: makeTrackedModel('subEventRsvp'),
        subEventAccess: makeTrackedModel('subEventAccess'),
        subEvent: makeTrackedModel('subEvent'),
        contributor: makeTrackedModel('contributor'),
        registryItem: makeTrackedModel('registryItem'),
        invitationCode: makeTrackedModel('invitationCode'),
        seatingTable: makeTrackedModel('seatingTable'),
        attraction: makeTrackedModel('attraction'),
        weddingPartyMember: makeTrackedModel('weddingPartyMember'),
        media: makeTrackedModel('media'),
        contentNode: makeTrackedModel('contentNode'),
        appConfig: {
          ...makeTrackedModel('appConfig'),
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'global',
              smtpPass: 'existing-smtp-pass',
              resendApiKey: 'existing-resend-key',
              sendgridApiKey: '',
              twilioAuthToken: 'existing-twilio-token',
            },
          ]),
        },
      };

      mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockTx) => unknown) => {
        return callback(mockTx);
      });

      const req = new NextRequest('http://localhost/api/admin/maintenance/import', {
        method: 'POST',
        body: JSON.stringify(legacyBackup),
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(mockTx.appConfig.createMany).toHaveBeenCalledWith({
        data: [
          {
            id: 'global',
            partner1Name: 'Alex',
            partner2Name: 'Taylor',
            modules: DEFAULT_MODULE_CONFIG,
            showCountdown: true,
            showAddToCalendar: true,
            smtpPass: 'existing-smtp-pass',
            resendApiKey: 'existing-resend-key',
            twilioAuthToken: 'existing-twilio-token',
            createdAt: new Date('2026-06-20T00:00:00.000Z'),
            updatedAt: new Date('2026-06-20T00:00:00.000Z'),
          },
        ],
      });
      expect(mockTx.contributor.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            id: 'c-orphan',
            registryItemId: 'ri1',
            invitationCodeId: null,
            thankYouStatus: 'Sent',
            thankYouNote: 'Thank you so much!',
          }),
        ],
      });
      expect(callOrder.slice(0, 14)).toEqual([
        'delete:broadcastRecipient',
        'delete:broadcastMessage',
        'delete:subEventRsvp',
        'delete:subEventAccess',
        'delete:subEvent',
        'delete:contributor',
        'delete:registryItem',
        'delete:invitationCode',
        'delete:seatingTable',
        'delete:attraction',
        'delete:weddingPartyMember',
        'delete:media',
        'delete:contentNode',
        'delete:appConfig',
      ]);
    });

    test('supports empty appConfig and registryItem arrays', async () => {
      const emptyBackup = {
        appConfig: [],
        registryItem: [],
      };

      const mockTx = {
        contributor: { deleteMany: jest.fn(), createMany: jest.fn() },
        registryItem: { deleteMany: jest.fn(), createMany: jest.fn() },
        attraction: { deleteMany: jest.fn(), createMany: jest.fn() },
        weddingPartyMember: { deleteMany: jest.fn(), createMany: jest.fn() },
        media: { deleteMany: jest.fn(), createMany: jest.fn() },
        contentNode: { deleteMany: jest.fn(), createMany: jest.fn() },
        appConfig: { deleteMany: jest.fn(), createMany: jest.fn() },
      };

      mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockTx) => unknown) => {
        return callback(mockTx);
      });

      const req = new NextRequest('http://localhost/api/admin/maintenance/import', {
        method: 'POST',
        body: JSON.stringify(emptyBackup),
      });
      const res = await POST(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ success: true });

      expect(mockTx.appConfig.createMany).not.toHaveBeenCalled();
      expect(mockTx.registryItem.createMany).not.toHaveBeenCalled();
    });

    test('rejects backup with out-of-range numeric fields', async () => {
      const invalidBackup = {
        appConfig: [
          {
            id: 'global',
            brideName: 'Alice',
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
        registryItem: [
          {
            id: 'ri1',
            name: 'Plates',
            description: 'Ceramic Plates',
            category: 'Kitchen',
            price: -5.0, // Invalid: negative price
            imageId: 'image-id',
            quantity: 2,
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
      };

      const req = new NextRequest('http://localhost/api/admin/maintenance/import', {
        method: 'POST',
        body: JSON.stringify(invalidBackup),
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Validation Error');
      expect(body.error).toContain('registryItem.0.price');
    });

    test('rejects backup with malformed email addresses', async () => {
      const invalidBackup = {
        appConfig: [
          {
            id: 'global',
            brideName: 'Alice',
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
        registryItem: [],
        contributor: [
          {
            id: 'c1',
            name: 'John',
            email: 'not-an-email', // Invalid email format
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
      };

      const req = new NextRequest('http://localhost/api/admin/maintenance/import', {
        method: 'POST',
        body: JSON.stringify(invalidBackup),
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Validation Error');
      expect(body.error).toContain('contributor.0.email');
    });

    test('rejects backup with missing database-required columns', async () => {
      const invalidBackup = {
        appConfig: [
          {
            id: 'global',
            brideName: 'Alice',
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
        registryItem: [],
        weddingPartyMember: [
          {
            id: 'wp1',
            // Missing required 'name' field
            role: 'Best Man',
            bio: 'Bio text',
            photoId: 'photo-id',
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
      };

      const req = new NextRequest('http://localhost/api/admin/maintenance/import', {
        method: 'POST',
        body: JSON.stringify(invalidBackup),
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Validation Error');
      expect(body.error).toContain('weddingPartyMember.0.name');
    });

    test('rejection of invalid imports leaves the existing system database untouched', async () => {
      const invalidBackup = {
        appConfig: [
          {
            id: 'global',
            brideName: 'Alice',
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
        registryItem: [
          {
            id: 'ri1',
            name: 'Plates',
            description: 'Ceramic Plates',
            category: 'Kitchen',
            price: 50,
            imageId: 'image-id',
            quantity: -10, // Invalid: negative quantity
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
          },
        ],
      };

      const req = new NextRequest('http://localhost/api/admin/maintenance/import', {
        method: 'POST',
        body: JSON.stringify(invalidBackup),
      });
      const res = await POST(req);

      expect(res.status).toBe(400);

      // Verify transaction was never initialized
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
