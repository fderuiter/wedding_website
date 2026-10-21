/** @jest-environment node */

jest.mock('@/features/registry/service', () => ({
  registryService: {
    createItem: jest.fn(),
    getAllItems: jest.fn(),
    getItemById: jest.fn(),
    updateItem: jest.fn(),
  },
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

// Mock prisma for restore test
jest.mock('@/lib/prisma', () => ({
  prisma: {
    snapshotVersion: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    registryItem: {
      upsert: jest.fn(),
    },
    media: {
      upsert: jest.fn(),
    },
  },
}));

import { POST as addItemPOST, GET as getItemsGET } from '@/app/api/registry/items/route';
import { POST as restorePOST } from '@/app/api/admin/versions/[id]/restore/route';
// eslint-disable-next-line no-restricted-imports
import { registryService } from '@/features/registry/service';
import { isAdminRequest } from '@/core/auth/auth.server';
import { prisma } from '@/lib/prisma';
import { NextRequest } from 'next/server';

const mockCreateItem = registryService.createItem as jest.Mock;
const mockGetAllItems = registryService.getAllItems as jest.Mock;
const mockIsAdminRequest = isAdminRequest as jest.Mock;

describe('Unified Schema Contracts and Adapter Middleware Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Routing adapter middleware - Request payload validation', () => {
    it('validates standard active request payload (v2)', async () => {
      mockIsAdminRequest.mockResolvedValue(true);
      mockCreateItem.mockResolvedValue({
        id: 'item-123',
        name: 'Standard Toaster',
        price: 99.99,
        quantity: 2,
        category: 'Kitchen',
        description: 'Cozy toast',
        imageUrl: '/images/toaster.png',
        vendorUrl: 'https://example.com/toaster',
        isGroupGift: true,
        purchased: false,
        purchaserName: null,
        amountContributed: 0,
        contributors: [],
      });

      const activePayload = {
        name: 'Standard Toaster',
        price: 99.99,
        quantity: 2,
        category: 'Kitchen',
        description: 'Cozy toast',
        imageUrl: '/images/toaster.png',
        imageAlt: undefined,
        imageDecorative: undefined,
        vendorUrl: 'https://example.com/toaster',
        isGroupGift: true,
      };

      const req = new Request('http://localhost/api/registry/items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-version': 'v1',
        },
        body: JSON.stringify(activePayload),
      }) as unknown as NextRequest;

      const res = await addItemPOST(req, {} as any);
      expect(res.status).toBe(201);

      expect(mockCreateItem).toHaveBeenCalledWith({
        itemType: 'PHYSICAL',
        paymentHandleType: undefined,
        paymentHandle: undefined,
        name: 'Standard Toaster',
        price: 99.99,
        quantity: 2,
        category: 'Kitchen',
        description: 'Cozy toast',
        imageUrl: '/images/toaster.png',
        imageAlt: undefined,
        imageDecorative: undefined,
        vendorUrl: 'https://example.com/toaster',
        isGroupGift: true,
        isMostWanted: false,
        displayOrder: 0,
      });

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.item).toEqual(
        expect.objectContaining({
          name: 'Standard Toaster',
          price: 99.99,
          quantity: 2,
          category: 'Kitchen',
        })
      );
      expect(res.headers.get('x-api-version')).toBe('v2');
    });

    it('returns standard 400 Bad Request error when payload misses mandatory properties', async () => {
      mockIsAdminRequest.mockResolvedValue(true);
      
      const incompletePayload = {
        price: 99.99, // missing name, quantity, category
      };

      const req = new Request('http://localhost/api/registry/items', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(incompletePayload),
      }) as unknown as NextRequest;

      const res = await addItemPOST(req, {} as any);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error).toBe('Validation Error');
    });
  });

  describe('Response pipeline transformation - Versioned Response matching', () => {
    it('returns v2 format for standard active requests', async () => {
      mockGetAllItems.mockResolvedValue([
        {
          id: 'item-1',
          name: 'Modern Mixer',
          price: 249.99,
          quantity: 1,
          category: 'Kitchen',
          description: 'A helper',
          imageUrl: '/images/mixer.png',
          vendorUrl: 'https://example.com/mixer',
          isGroupGift: false,
          purchased: false,
        },
      ]);

      const req = new Request('http://localhost/api/registry/items', {
        method: 'GET',
      }) as unknown as NextRequest;

      const res = await getItemsGET(req, {} as any);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data[0]).toHaveProperty('name', 'Modern Mixer');
      expect(json.data[0]).toHaveProperty('price', 249.99);
      expect(json.data[0]).not.toHaveProperty('legacy_name');
      expect(res.headers.get('x-api-version')).toBe('v2');
    });

    it('returns standard v2 format even when legacy version query parameter is supplied', async () => {
      mockGetAllItems.mockResolvedValue([
        {
          id: 'item-1',
          name: 'Modern Mixer',
          price: 249.99,
          quantity: 1,
          category: 'Kitchen',
          description: 'A helper',
          imageUrl: '/images/mixer.png',
          vendorUrl: 'https://example.com/mixer',
          isGroupGift: false,
          purchased: false,
        },
      ]);

      const req = new Request('http://localhost/api/registry/items?version=v1', {
        method: 'GET',
      }) as unknown as NextRequest;

      const res = await getItemsGET(req, {} as any);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data[0]).toHaveProperty('name', 'Modern Mixer');
      expect(json.data[0]).toHaveProperty('price', 249.99);
      expect(json.data[0]).not.toHaveProperty('legacy_name');
      expect(res.headers.get('x-api-version')).toBe('v2');
    });
  });

  describe('Version restoration - Older database snapshot mapping during rollback', () => {
    it('successfully processes and maps older snapshot objects containing retired fields', async () => {
      const olderSnapshotData = {
        legacy_name: 'Old Gold Ring',
        legacy_price: 500,
        qty: 1, // retired field name (vs quantity)
        group: 'Jewelry', // retired field name (vs category)
        details: 'Wedding band', // retired field name (vs description)
        mediaId: 'image-ring', // retired field name (vs imageId)
        legacy_vendorUrl: 'https://jewelry.example.com',
        legacy_isGroupGift: false,
      };

      const mockSnapshotVersion = {
        id: 'snapshot-v1',
        entityType: 'RegistryItem',
        entityId: 'registry-item-1',
        data: olderSnapshotData,
        createdAt: new Date(),
      };

      (prisma.snapshotVersion.findUnique as jest.Mock).mockResolvedValue(mockSnapshotVersion);
      (prisma.snapshotVersion.create as jest.Mock).mockResolvedValue({ id: 'new-snapshot' });
      (prisma.registryItem.upsert as jest.Mock).mockResolvedValue({});

      const req = new Request('http://localhost/api/admin/versions/snapshot-v1/restore', {
        method: 'POST',
      }) as unknown as NextRequest;

      const res = await restorePOST(req, { params: Promise.resolve({ id: 'snapshot-v1' }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.restoredTo).toBe('snapshot-v1');

      // Verify that the upsert was called with properties mapped perfectly to standard active schema requirements
      expect(prisma.registryItem.upsert).toHaveBeenCalledWith({
        where: { id: 'registry-item-1' },
        update: {
          itemType: 'PHYSICAL',
          paymentHandleType: null,
          paymentHandle: null,
          name: 'Old Gold Ring',
          price: 500,
          quantity: 1,
          category: 'Jewelry',
          description: 'Wedding band',
          imageId: 'image-ring',
          vendorUrl: 'https://jewelry.example.com',
          isGroupGift: false,
          isMostWanted: false,
          displayOrder: 0,
          purchased: false,
          purchaserName: undefined,
          amountContributed: 0,
        },
        create: {
          id: 'registry-item-1',
          itemType: 'PHYSICAL',
          paymentHandleType: null,
          paymentHandle: null,
          name: 'Old Gold Ring',
          price: 500,
          quantity: 1,
          category: 'Jewelry',
          description: 'Wedding band',
          imageId: 'image-ring',
          vendorUrl: 'https://jewelry.example.com',
          isGroupGift: false,
          isMostWanted: false,
          displayOrder: 0,
          purchased: false,
          purchaserName: undefined,
          amountContributed: 0,
        },
      });
    });

    it('successfully processes and maps Media snapshot objects during rollback', async () => {
      const mediaSnapshotData = {
        url: 'https://example.com/photo.jpg',
        altText: 'A beautiful photo',
        isDecorative: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const mockSnapshotVersion = {
        id: 'snapshot-m1',
        entityType: 'Media',
        entityId: 'media-1',
        data: mediaSnapshotData,
        createdAt: new Date(),
      };

      (prisma.snapshotVersion.findUnique as jest.Mock).mockResolvedValue(mockSnapshotVersion);
      (prisma.snapshotVersion.create as jest.Mock).mockResolvedValue({ id: 'new-snapshot' });
      (prisma.media.upsert as jest.Mock).mockResolvedValue({});

      const req = new Request('http://localhost/api/admin/versions/snapshot-m1/restore', {
        method: 'POST',
      }) as unknown as NextRequest;

      const res = await restorePOST(req, { params: Promise.resolve({ id: 'snapshot-m1' }) });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.restoredTo).toBe('snapshot-m1');

      // Verify that the upsert was called with properties mapped perfectly
      expect(prisma.media.upsert).toHaveBeenCalledWith({
        where: { id: 'media-1' },
        update: {
          url: 'https://example.com/photo.jpg',
          altText: 'A beautiful photo',
          isDecorative: false,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
        create: {
          id: 'media-1',
          url: 'https://example.com/photo.jpg',
          altText: 'A beautiful photo',
          isDecorative: false,
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        },
      });
    });
  });
});
