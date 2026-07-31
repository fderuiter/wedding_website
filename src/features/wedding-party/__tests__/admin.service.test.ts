/** @jest-environment node */

import { WeddingPartyAdminService } from '../admin.service';
import { createAuditSnapshot } from '@/lib/audit';

const mockTxWeddingPartyMemberCreate = jest.fn();
const mockTxWeddingPartyMemberUpdate = jest.fn();
const mockTxMediaCreate = jest.fn();
const mockTxMediaUpdate = jest.fn();
const mockTxSnapshotVersionCreate = jest.fn();

jest.mock('@/lib/prisma', () => {
  const mockTx = {
    weddingPartyMember: {
      create: (...args: any[]) => mockTxWeddingPartyMemberCreate(...args),
      update: (...args: any[]) => mockTxWeddingPartyMemberUpdate(...args),
    },
    media: {
      create: (...args: any[]) => mockTxMediaCreate(...args),
      update: (...args: any[]) => mockTxMediaUpdate(...args),
    },
    snapshotVersion: {
      create: (...args: any[]) => mockTxSnapshotVersionCreate(...args),
    },
  };

  return {
    prisma: {
      weddingPartyMember: {
        create: jest.fn(),
        update: jest.fn(),
      },
      media: {
        create: jest.fn(),
        update: jest.fn(),
      },
      snapshotVersion: {
        create: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(mockTx)),
    },
  };
});

jest.mock('@/lib/audit', () => ({
  createAuditSnapshot: jest.fn(),
}));

describe('WeddingPartyAdminService - Atomic Transactions & Auditing', () => {
  let service: WeddingPartyAdminService;

  beforeEach(() => {
    service = new WeddingPartyAdminService();
    jest.clearAllMocks();
  });

  it('should successfully create a wedding party member with a photo and log audits', async () => {
    const input = {
      name: 'John Doe',
      role: 'Groomsman',
      bio: 'Best friend of the groom.',
      order: 1,
      photoUrl: 'http://example.com/photo.jpg',
      photoAlt: 'Some Alt',
      photoDecorative: false,
    };

    mockTxMediaCreate.mockResolvedValue({
      id: 'media-123',
      url: 'http://example.com/photo.jpg',
      altText: 'Some Alt',
      isDecorative: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockTxWeddingPartyMemberCreate.mockResolvedValue({
      id: 'member-123',
      name: 'John Doe',
      role: 'Groomsman',
      bio: 'Best friend of the groom.',
      order: 1,
      photoId: 'media-123',
    });

    const result = await service.create(input, 'Coordinator');

    expect(result).toEqual({
      id: 'member-123',
      name: 'John Doe',
      role: 'Groomsman',
      bio: 'Best friend of the groom.',
      order: 1,
      photoId: 'media-123',
    });

    // Verify handleMediaFields did its job: media creation and audit snapshot
    expect(mockTxMediaCreate).toHaveBeenCalledWith({
      data: {
        url: 'http://example.com/photo.jpg',
        altText: 'Some Alt',
        isDecorative: false,
      },
    });

    expect(createAuditSnapshot).toHaveBeenCalledWith(
      'Media',
      'media-123',
      expect.any(Object),
      'Coordinator',
      expect.any(Object)
    );

    // Verify wedding party member creation and audit snapshot
    expect(mockTxWeddingPartyMemberCreate).toHaveBeenCalledWith({
      data: {
        name: 'John Doe',
        role: 'Groomsman',
        bio: 'Best friend of the groom.',
        order: 1,
        photoId: 'media-123',
      },
    });

    expect(createAuditSnapshot).toHaveBeenCalledWith(
      'WeddingPartyMember',
      'member-123',
      expect.any(Object),
      'Coordinator',
      expect.any(Object)
    );
  });

  it('should roll back completely when wedding party member creation fails', async () => {
    const input = {
      name: 'John Doe',
      role: 'Groomsman',
      bio: 'Best friend of the groom.',
      order: 1,
      photoUrl: 'http://example.com/photo.jpg',
      photoAlt: 'Some Alt',
      photoDecorative: false,
    };

    mockTxMediaCreate.mockResolvedValue({
      id: 'media-123',
      url: 'http://example.com/photo.jpg',
      altText: 'Some Alt',
      isDecorative: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Simulate database constraint failure on member creation
    mockTxWeddingPartyMemberCreate.mockRejectedValue(new Error('DB Constraint Violation'));

    await expect(service.create(input, 'Coordinator')).rejects.toThrow('DB Constraint Violation');
  });

  it('should successfully update a wedding party member with an existing photo', async () => {
    const input = {
      name: 'John Doe Updated',
      role: 'Groomsman',
      bio: 'Best friend of the groom.',
      order: 1,
      photoId: 'media-123',
      photoUrl: 'http://example.com/photo-updated.jpg',
      photoAlt: 'Updated Alt',
      photoDecorative: false,
    };

    mockTxMediaUpdate.mockResolvedValue({
      id: 'media-123',
      url: 'http://example.com/photo-updated.jpg',
      altText: 'Updated Alt',
      isDecorative: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockTxWeddingPartyMemberUpdate.mockResolvedValue({
      id: 'member-123',
      name: 'John Doe Updated',
      role: 'Groomsman',
      bio: 'Best friend of the groom.',
      order: 1,
      photoId: 'media-123',
    });

    const result = await service.update('member-123', input, 'Coordinator');

    expect(result).toEqual({
      id: 'member-123',
      name: 'John Doe Updated',
      role: 'Groomsman',
      bio: 'Best friend of the groom.',
      order: 1,
      photoId: 'media-123',
    });

    expect(mockTxMediaUpdate).toHaveBeenCalledWith({
      where: { id: 'media-123' },
      data: {
        url: 'http://example.com/photo-updated.jpg',
        altText: 'Updated Alt',
        isDecorative: false,
      },
    });

    expect(createAuditSnapshot).toHaveBeenCalledWith(
      'Media',
      'media-123',
      expect.any(Object),
      'Coordinator',
      expect.any(Object)
    );
  });

  it('should throw and not proceed if input validation fails', async () => {
    const invalidInput = {
      name: '', // Invalid name or missing fields
      role: 'Groomsman',
    };

    await expect(service.create(invalidInput, 'Coordinator')).rejects.toThrow('Validation Error');
    expect(mockTxMediaCreate).not.toHaveBeenCalled();
    expect(mockTxWeddingPartyMemberCreate).not.toHaveBeenCalled();
  });

  it('should roll back completely when media creation fails', async () => {
    const input = {
      name: 'John Doe',
      role: 'Groomsman',
      bio: 'Best friend of the groom.',
      order: 1,
      photoUrl: 'http://example.com/photo.jpg',
      photoAlt: 'Some Alt',
      photoDecorative: false,
    };

    // Simulate database constraint failure on media creation
    mockTxMediaCreate.mockRejectedValue(new Error('Media Creation Failed'));

    await expect(service.create(input, 'Coordinator')).rejects.toThrow('Media Creation Failed');
    expect(mockTxWeddingPartyMemberCreate).not.toHaveBeenCalled();
  });
});
