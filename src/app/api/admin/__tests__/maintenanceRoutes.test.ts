/** @jest-environment node */

import { GET } from '../maintenance/export/route';
import { POST } from '../maintenance/import/route';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/core/auth/auth.server';
import { createAuditSnapshot } from '@/lib/audit';
import { decryptBackupData } from '@/utils/backupEncryption';

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

    json() {
      return Promise.resolve(JSON.parse(this.bodyContent));
    }
  }

  const MockNextRequest = jest.fn((input, init) => {
    const requestCookies = new Map();
    if (init?.headers?.cookie) {
      init.headers.cookie.split(';').forEach(c => {
        const [key, value] = c.trim().split('=');
        requestCookies.set(key, { name: key, value });
      });
    }
    return {
      ...init,
      url: input,
      headers: {
        get: (key) => {
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
    weddingPartyMember: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    attraction: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    registryItem: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    contributor: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
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
const { pruneSnapshotsBulk } = require('@/lib/audit');
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

    test('returns 200 with JSON file attachment containing 8 models', async () => {
      const mockAppConfig = [{ id: 'global', brideName: 'Alice' }];
      const mockContentNode = [{ id: 'cn1', body: 'Story' }];
      const mockMedia = [{ id: 'm1', url: 'https://example.com/photo.jpg', isDecorative: false }];
      const mockWeddingParty = [{ id: 'wp1', name: 'Bob' }];
      const mockAttraction = [{ id: 'att1', name: 'Beach' }];
      const mockRegistry = [{ id: 'ri1', name: 'Kitchenware' }];
      const mockContributor = [{ id: 'c1', name: 'John' }];
      const mockSnapshot = [{ id: 'sv1', entityId: 'global' }];

      mockPrisma.appConfig.findMany.mockResolvedValue(mockAppConfig as any);
      mockPrisma.contentNode.findMany.mockResolvedValue(mockContentNode as any);
      mockPrisma.media.findMany.mockResolvedValue(mockMedia as any);
      mockPrisma.weddingPartyMember.findMany.mockResolvedValue(mockWeddingParty as any);
      mockPrisma.attraction.findMany.mockResolvedValue(mockAttraction as any);
      mockPrisma.registryItem.findMany.mockResolvedValue(mockRegistry as any);
      mockPrisma.contributor.findMany.mockResolvedValue(mockContributor as any);
      mockPrisma.snapshotVersion.findMany.mockResolvedValue(mockSnapshot as any);

      const req = new NextRequest('http://localhost/api/admin/maintenance/export');
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/json');
      expect(res.headers.get('Content-Disposition')).toContain('attachment; filename="wedding-backup-');

      const data = await res.json();
      expect(data.encrypted).toBe(true);
      expect(data.algorithm).toBe('AES-GCM');
      expect(typeof data.iv).toBe('string');
      expect(typeof data.tag).toBe('string');
      expect(typeof data.data).toBe('string');

      const decrypted = decryptBackupData(data);

      expect(decrypted).toEqual({
        appConfig: mockAppConfig,
        contentNode: mockContentNode,
        media: mockMedia,
        weddingPartyMember: mockWeddingParty,
        attraction: mockAttraction,
        registryItem: mockRegistry,
        contributor: mockContributor,
        snapshotVersion: mockSnapshot,
      });

      expect(mockCreateAuditSnapshot).toHaveBeenCalledWith(
        'SystemBackup',
        expect.stringMatching(/^export-/),
        expect.objectContaining({ scope: 'full', requestingUser: 'Admin' }),
        'Admin'
      );
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

      mockPrisma.$transaction.mockImplementation(async (callback) => {
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

      mockPrisma.$transaction.mockImplementation(async (callback) => {
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

    test('supports optional fields and exercises all reviveDates branches', async () => {
      const backupWithAllTypes = {
        appConfig: [
          {
            id: 'global',
            brideName: 'Alice',
            createdAt: '2026-06-20T00:00:00.000Z',
            updatedAt: '2026-06-20T00:00:00.000Z',
            nullField: null,
            undefinedField: undefined,
            numberField: 42,
            booleanField: true,
            arrayField: ['2026-06-20T00:00:00.000Z', { nestedDate: '2026-06-20T00:00:00.000Z' }],
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

      mockPrisma.$transaction.mockImplementation(async (callback) => {
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
            nullField: null,
            undefinedField: undefined,
            numberField: 42,
            booleanField: true,
            arrayField: [new Date('2026-06-20T00:00:00.000Z'), { nestedDate: new Date('2026-06-20T00:00:00.000Z') }],
          },
        ],
      });
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

      mockPrisma.$transaction.mockImplementation(async (callback) => {
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
