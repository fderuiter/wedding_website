import { ThankYouService } from '../thank-you.service';

describe('ThankYouService', () => {
  let service: ThankYouService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      contributor: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      snapshotVersion: {
        create: jest.fn().mockResolvedValue({ id: 'snapshot-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    service = new ThankYouService(mockPrisma);
  });

  describe('getThankYouNotes', () => {
    it('calculates correct summary progress metrics and returns items', async () => {
      const sampleContributors = [
        {
          id: 'c1',
          name: 'Alice Johnson',
          amount: 100,
          date: new Date().toISOString(),
          thankYouStatus: 'Sent',
          thankYouSentAt: new Date().toISOString(),
          thankYouNote: 'Card sent via mail',
          registryItem: { id: 'item1', name: 'Coffee Maker', category: 'Kitchen' },
        },
        {
          id: 'c2',
          name: 'Bob Smith',
          amount: 50,
          date: new Date().toISOString(),
          thankYouStatus: 'Unsent',
          thankYouSentAt: null,
          thankYouNote: null,
          registryItem: { id: 'item2', name: 'Toaster', category: 'Kitchen' },
        },
        {
          id: 'c3',
          name: 'Charlie Brown',
          amount: 200,
          date: new Date().toISOString(),
          thankYouStatus: 'Not Needed',
          thankYouSentAt: null,
          thankYouNote: 'verbal thank you',
          registryItem: { id: 'item1', name: 'Coffee Maker', category: 'Kitchen' },
        },
      ];

      mockPrisma.contributor.findMany.mockResolvedValue(sampleContributors);

      const result = await service.getThankYouNotes();

      expect(result.metrics.total).toBe(3);
      expect(result.metrics.sent).toBe(1);
      expect(result.metrics.unsent).toBe(1);
      expect(result.metrics.notNeeded).toBe(1);
      expect(result.metrics.thanked).toBe(2);
      expect(result.metrics.completionPercentage).toBe(67);
      expect(result.items.length).toBe(3);
    });

    it('filters items by status Unsent', async () => {
      const sampleContributors = [
        {
          id: 'c1',
          name: 'Alice Johnson',
          amount: 100,
          date: new Date().toISOString(),
          thankYouStatus: 'Sent',
          registryItem: { id: 'item1', name: 'Coffee Maker', category: 'Kitchen' },
        },
        {
          id: 'c2',
          name: 'Bob Smith',
          amount: 50,
          date: new Date().toISOString(),
          thankYouStatus: 'Unsent',
          registryItem: { id: 'item2', name: 'Toaster', category: 'Kitchen' },
        },
      ];

      mockPrisma.contributor.findMany.mockResolvedValue(sampleContributors);

      const result = await service.getThankYouNotes({ status: 'Unsent' });

      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe('c2');
      expect(result.metrics.total).toBe(2); // Metrics still reflect overall total
    });

    it('filters items by search query matching contributor name or gift title', async () => {
      const sampleContributors = [
        {
          id: 'c1',
          name: 'Alice Johnson',
          amount: 100,
          date: new Date().toISOString(),
          thankYouStatus: 'Sent',
          registryItem: { id: 'item1', name: 'Coffee Maker', category: 'Kitchen' },
        },
        {
          id: 'c2',
          name: 'Bob Smith',
          amount: 50,
          date: new Date().toISOString(),
          thankYouStatus: 'Unsent',
          registryItem: { id: 'item2', name: 'Blender', category: 'Kitchen' },
        },
      ];

      mockPrisma.contributor.findMany.mockResolvedValue(sampleContributors);

      const searchResult1 = await service.getThankYouNotes({ search: 'coffee' });
      expect(searchResult1.items.length).toBe(1);
      expect(searchResult1.items[0].id).toBe('c1');

      const searchResult2 = await service.getThankYouNotes({ search: 'Bob' });
      expect(searchResult2.items.length).toBe(1);
      expect(searchResult2.items[0].id).toBe('c2');
    });
  });

  describe('updateThankYouNote', () => {
    it('updates status and automatically sets sentAt when status changes to Sent', async () => {
      const existing = {
        id: 'c1',
        name: 'Alice Johnson',
        amount: 100,
        date: new Date().toISOString(),
        thankYouStatus: 'Unsent',
        thankYouSentAt: null,
        thankYouNote: null,
      };

      mockPrisma.contributor.findUnique.mockResolvedValue(existing);
      mockPrisma.contributor.update.mockImplementation(({ data }: any) =>
        Promise.resolve({
          ...existing,
          ...data,
          date: existing.date,
          registryItem: { id: 'item1', name: 'Coffee Maker', category: 'Kitchen' },
        })
      );

      const updated = await service.updateThankYouNote('c1', {
        thankYouStatus: 'Sent',
        thankYouNote: 'Warm thank you note sent!',
      });

      expect(updated.thankYouStatus).toBe('Sent');
      expect(updated.thankYouNote).toBe('Warm thank you note sent!');
      expect(updated.thankYouSentAt).not.toBeNull();
      expect(mockPrisma.snapshotVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entityType: 'Contributor',
            entityId: 'c1',
          }),
        })
      );
    });
  });

  describe('batchUpdateThankYouNotes', () => {
    it('performs bulk status update and creates audit snapshots', async () => {
      const mockRecords = [
        {
          id: 'c1',
          name: 'Alice Johnson',
          amount: 100,
          date: new Date().toISOString(),
          thankYouStatus: 'Sent',
          thankYouSentAt: new Date().toISOString(),
          registryItem: { id: 'item1', name: 'Coffee Maker' },
        },
        {
          id: 'c2',
          name: 'Bob Smith',
          amount: 50,
          date: new Date().toISOString(),
          thankYouStatus: 'Sent',
          thankYouSentAt: new Date().toISOString(),
          registryItem: { id: 'item2', name: 'Toaster' },
        },
      ];

      mockPrisma.contributor.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.contributor.findMany.mockResolvedValue(mockRecords);

      const result = await service.batchUpdateThankYouNotes(['c1', 'c2'], 'Sent');

      expect(result.length).toBe(2);
      expect(mockPrisma.contributor.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['c1', 'c2'] } },
        data: expect.objectContaining({ thankYouStatus: 'Sent' }),
      });
      expect(mockPrisma.snapshotVersion.create).toHaveBeenCalledTimes(2);
    });
  });
});
