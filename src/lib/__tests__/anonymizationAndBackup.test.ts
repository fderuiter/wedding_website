/**
 * @jest-environment node
 */

import { sanitizeSnapshotPayload, sanitizeAuthor, createAuditSnapshot, purgeOrphanedContributors } from '@/lib/audit';
import { encryptBackupData, decryptBackupData } from '@/utils/backupEncryption';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    snapshotVersion: {
      create: jest.fn().mockResolvedValue({ id: 'snapshot-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    contributor: {
      deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  },
}));

const mockPrisma = prisma as any;

describe('Immutable Privacy & Anonymized Snapshots Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sanitizeSnapshotPayload', () => {
    it('strips guest email addresses and anonymizes purchaserName and contributor names', () => {
      const rawPayload = {
        id: 'registry-1',
        name: 'Honeymoon Fund',
        purchaserName: 'Jane Doe',
        contributors: [
          {
            id: 'c-1',
            name: 'John Smith',
            email: 'john@example.com',
            amount: 100,
            date: new Date('2026-08-01T10:00:00.000Z'),
          },
        ],
      };

      const sanitized = sanitizeSnapshotPayload(rawPayload);

      expect(sanitized.purchaserName).toBe('Anonymous');
      expect(sanitized.contributors[0].name).toBe('Anonymous');
      expect(sanitized.contributors[0].email).toBeUndefined();
      expect(sanitized.contributors[0].amount).toBe(100);
      expect(sanitized.contributors[0].date).toEqual(new Date('2026-08-01T10:00:00.000Z'));
    });

    it('anonymizes standalone contributor object and deletes email', () => {
      const rawContributor = {
        id: 'c-2',
        name: 'Bob Miller',
        email: 'bob@example.com',
        amount: 250,
        registryItemId: 'item-1',
      };

      const sanitized = sanitizeSnapshotPayload(rawContributor);

      expect(sanitized.name).toBe('Anonymous');
      expect(sanitized.email).toBeUndefined();
      expect(sanitized.amount).toBe(250);
    });

    it('preserves Date instances without converting them to empty objects', () => {
      const now = new Date();
      const payload = { createdAt: now };
      const sanitized = sanitizeSnapshotPayload(payload);

      expect(sanitized.createdAt).toEqual(now);
      expect(sanitized.createdAt instanceof Date).toBe(true);
    });
  });

  describe('sanitizeAuthor', () => {
    it('returns Anonymous when author contains email or guest identifier', () => {
      expect(sanitizeAuthor('john@example.com')).toBe('Anonymous');
      expect(sanitizeAuthor('Guest')).toBe('Anonymous');
      expect(sanitizeAuthor('Contributor')).toBe('Anonymous');
      expect(sanitizeAuthor('Guest/Contributor')).toBe('Anonymous');
      expect(sanitizeAuthor('Guest/User')).toBe('Anonymous');
    });

    it('returns System when author is falsy', () => {
      expect(sanitizeAuthor('')).toBe('System');
      expect(sanitizeAuthor(undefined)).toBe('System');
    });

    it('preserves admin and system author names', () => {
      expect(sanitizeAuthor('Admin')).toBe('Admin');
      expect(sanitizeAuthor('Admin/BulkImport')).toBe('Admin/BulkImport');
      expect(sanitizeAuthor('System')).toBe('System');
    });
  });

  describe('createAuditSnapshot', () => {
    it('sanitizes data payload and author when creating snapshot', async () => {
      const rawData = {
        id: 'ri-100',
        purchaserName: 'Alice Guest',
        email: 'alice@example.com',
      };

      await createAuditSnapshot('RegistryItem', 'ri-100', rawData, 'alice@example.com');

      expect(mockPrisma.snapshotVersion.create).toHaveBeenCalledWith({
        data: {
          entityType: 'RegistryItem',
          entityId: 'ri-100',
          data: {
            id: 'ri-100',
            purchaserName: 'Anonymous',
          },
          author: 'Anonymous',
        },
      });
    });
  });

  describe('purgeOrphanedContributors', () => {
    it('deletes contributors without linked registry items', async () => {
      await purgeOrphanedContributors();

      expect(mockPrisma.contributor.deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { registryItemId: null },
            {
              registryItem: {
                is: null,
              },
            },
          ],
        },
      });
    });
  });
});

describe('AES-GCM Backup Encryption & Decryption', () => {
  it('encrypts raw backup object with AES-GCM and decrypts back to original structure', () => {
    const backupData = {
      appConfig: [{ id: 'global', brideName: 'Alice' }],
      registryItem: [{ id: 'ri-1', name: 'Toaster', price: 50 }],
    };

    const encrypted = encryptBackupData(backupData);

    expect(encrypted.encrypted).toBe(true);
    expect(encrypted.algorithm).toBe('AES-GCM');
    expect(typeof encrypted.iv).toBe('string');
    expect(typeof encrypted.tag).toBe('string');
    expect(typeof encrypted.data).toBe('string');

    const decrypted = decryptBackupData(encrypted);

    expect(decrypted).toEqual(backupData);
  });

  it('returns unencrypted payload as-is if encrypted flag is absent', () => {
    const rawBackup = {
      appConfig: [{ id: 'global' }],
    };

    expect(decryptBackupData(rawBackup)).toBe(rawBackup);
  });
});
