import { ThankYouService } from '../thank-you.service';

describe('ThankYouService', () => {
  let service: ThankYouService;
  let mockPrisma: any;

  beforeEach(() => {
    let mockData: any[] = [];

    mockPrisma = {
      contributor: {
        findMany: jest.fn().mockImplementation(async (args?: any) => {
          if (!args || (!args.where && args.skip === undefined && args.take === undefined)) {
            return mockData;
          }
          let results = [...mockData];
          if (args.where?.thankYouStatus?.equals) {
            const eq = args.where.thankYouStatus.equals.toLowerCase();
            results = results.filter(
              (c) => (c.thankYouStatus || 'unsent').toLowerCase() === eq
            );
          } else if (args.where?.thankYouStatus?.in) {
            const list = args.where.thankYouStatus.in.map((s: string) => s.toLowerCase());
            results = results.filter((c) =>
              list.includes((c.thankYouStatus || 'unsent').toLowerCase())
            );
          }
          if (args.where?.OR) {
            const term = args.where.OR[0].name.contains.toLowerCase();
            results = results.filter(
              (c) =>
                (c.name || '').toLowerCase().includes(term) ||
                (c.registryItem?.name || '').toLowerCase().includes(term)
            );
          }
          const skip = args.skip ?? 0;
          const take = args.take ?? 50;
          return results.slice(skip, skip + take);
        }),
        count: jest.fn().mockImplementation(async (args?: any) => {
          let results = [...mockData];
          if (args?.where?.thankYouStatus?.equals) {
            const eq = args.where.thankYouStatus.equals.toLowerCase();
            results = results.filter(
              (c) => (c.thankYouStatus || 'unsent').toLowerCase() === eq
            );
          } else if (args?.where?.thankYouStatus?.in) {
            const list = args.where.thankYouStatus.in.map((s: string) => s.toLowerCase());
            results = results.filter((c) =>
              list.includes((c.thankYouStatus || 'unsent').toLowerCase())
            );
          }
          if (args?.where?.OR) {
            const term = args.where.OR[0].name.contains.toLowerCase();
            results = results.filter(
              (c) =>
                (c.name || '').toLowerCase().includes(term) ||
                (c.registryItem?.name || '').toLowerCase().includes(term)
            );
          }
          return results.length;
        }),
        groupBy: jest.fn().mockImplementation(async () => {
          const map: Record<string, number> = {};
          for (const c of mockData) {
            const st = c.thankYouStatus || 'Unsent';
            map[st] = (map[st] || 0) + 1;
          }
          return Object.entries(map).map(([st, count]) => ({
            thankYouStatus: st,
            _count: { _all: count },
          }));
        }),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      snapshotVersion: {
        create: jest.fn().mockResolvedValue({ id: 'snapshot-1' }),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    // Helper method for setting mock dataset
    mockPrisma.contributor.findMany.mockResolvedValue = (data: any[]) => {
      mockData = data;
      return mockPrisma.contributor.findMany;
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

    it('applies Prisma skip and take clauses based on page and pageSize parameters', async () => {
      mockPrisma.contributor.findMany.mockResolvedValue([]);

      const result = await service.getThankYouNotes({ page: 2, pageSize: 15 });

      expect(mockPrisma.contributor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 15,
          take: 15,
        })
      );
      expect(result.pagination).toEqual({
        page: 2,
        pageSize: 15,
        totalItems: 0,
        totalPages: 1,
      });
    });

    it('uses default pagination options skip: 0 and take: 50 when omitted', async () => {
      mockPrisma.contributor.findMany.mockResolvedValue([]);

      await service.getThankYouNotes();

      expect(mockPrisma.contributor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 50,
        })
      );
    });

    it('pushes status and search filters down to Prisma where clause with case-insensitive conditions', async () => {
      mockPrisma.contributor.findMany.mockResolvedValue([]);

      await service.getThankYouNotes({ status: 'Unsent', search: 'Coffee' });

      expect(mockPrisma.contributor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            thankYouStatus: { equals: 'Unsent', mode: 'insensitive' },
            OR: [
              { name: { contains: 'Coffee', mode: 'insensitive' } },
              { registryItem: { name: { contains: 'Coffee', mode: 'insensitive' } } },
            ],
          },
        })
      );
      expect(mockPrisma.contributor.groupBy).toHaveBeenCalledWith({
        by: ['thankYouStatus'],
        _count: { _all: true },
      });
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
      expect(mockPrisma.snapshotVersion.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            entityType: 'Contributor',
            entityId: 'c1',
            author: 'Admin',
          }),
          expect.objectContaining({
            entityType: 'Contributor',
            entityId: 'c2',
            author: 'Admin',
          }),
        ]),
      });
      expect(mockPrisma.snapshotVersion.createMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('exportThankYouNotesCsv', () => {
    it('formats records into RFC 4180 CSV strings with standard headers', async () => {
      const sampleContributors = [
        {
          id: 'c1',
          name: 'Alice Johnson',
          email: 'alice@example.com',
          amount: 100,
          date: '2026-06-01T00:00:00.000Z',
          thankYouStatus: 'Sent',
          thankYouSentAt: '2026-06-02T00:00:00.000Z',
          thankYouNote: 'Thank you for the coffee maker,\nit is awesome!',
          registryItem: { id: 'item1', name: 'Coffee Maker', category: 'Kitchen' },
        },
      ];

      mockPrisma.contributor.findMany.mockResolvedValue(sampleContributors);

      const csv = await service.exportThankYouNotesCsv();

      expect(csv).toContain(
        'Contributor Name,Email,Guest Message,Gift Item,Category,Contribution Amount,Contribution Date,Thank-You Status,Sent Date,Note Draft'
      );
      expect(csv).toContain('Alice Johnson');
      expect(csv).toContain('alice@example.com');
      expect(csv).toContain('Coffee Maker');
      expect(csv).toContain('Kitchen');
      expect(csv).toContain('100');
      expect(csv).toContain('"Thank you for the coffee maker,\nit is awesome!"');
    });

    it('filters records by status when status filter option is specified', async () => {
      const sampleContributors = [
        {
          id: 'c1',
          name: 'Alice Johnson',
          amount: 100,
          date: '2026-06-01T00:00:00.000Z',
          thankYouStatus: 'Sent',
          registryItem: { id: 'item1', name: 'Coffee Maker', category: 'Kitchen' },
        },
        {
          id: 'c2',
          name: 'Bob Smith',
          amount: 50,
          date: '2026-06-02T00:00:00.000Z',
          thankYouStatus: 'Unsent',
          registryItem: { id: 'item2', name: 'Toaster', category: 'Kitchen' },
        },
      ];

      mockPrisma.contributor.findMany.mockResolvedValue(sampleContributors);

      const csv = await service.exportThankYouNotesCsv({ status: 'Unsent' });

      expect(csv).toContain('Bob Smith');
      expect(csv).not.toContain('Alice Johnson');
    });

    it('returns empty CSV header row with trailing newline when no records match', async () => {
      mockPrisma.contributor.findMany.mockResolvedValue([]);

      const csv = await service.exportThankYouNotesCsv();

      expect(csv).toBe(
        'Contributor Name,Email,Guest Message,Gift Item,Category,Contribution Amount,Contribution Date,Thank-You Status,Sent Date,Note Draft\n'
      );
    });
  });

  describe('exportThankYouNotesPdf', () => {
    it('includes invitationCode address relation in Prisma findMany queries', async () => {
      mockPrisma.contributor.findMany.mockResolvedValue([]);

      await service.exportThankYouNotesPdf();

      expect(mockPrisma.contributor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            invitationCode: expect.objectContaining({
              select: expect.objectContaining({
                addressLine1: true,
                addressLine2: true,
                city: true,
                state: true,
                zipCode: true,
                country: true,
              }),
            }),
          }),
        })
      );
    });

    it('generates valid PDF binary buffer for Avery 5160 template with address data', async () => {
      const sampleContributors = [
        {
          id: 'c1',
          name: 'Jane Doe',
          amount: 100,
          date: new Date().toISOString(),
          thankYouStatus: 'Unsent',
          invitationCode: {
            id: 'inv1',
            code: 'GUEST123',
            guestName: 'Jane Doe',
            addressLine1: '123 Main St',
            addressLine2: 'Apt 4B',
            city: 'Austin',
            state: 'TX',
            zipCode: '78701',
            country: 'USA',
          },
        },
      ];

      mockPrisma.contributor.findMany.mockResolvedValue(sampleContributors);

      const pdfBuffer = await service.exportThankYouNotesPdf({ template: 'avery_5160' });

      expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
      expect(pdfBuffer.length).toBeGreaterThan(0);
      expect(pdfBuffer.toString('utf-8', 0, 5)).toBe('%PDF-');
    });

    it('generates valid PDF binary buffer for Avery 5163 template', async () => {
      const sampleContributors = [
        {
          id: 'c1',
          name: 'John Smith',
          amount: 150,
          date: new Date().toISOString(),
          thankYouStatus: 'Unsent',
          invitationCode: {
            id: 'inv2',
            code: 'GUEST456',
            guestName: 'John Smith',
            addressLine1: '456 Oak Ave',
            addressLine2: null,
            city: 'Seattle',
            state: 'WA',
            zipCode: '98101',
            country: 'USA',
          },
        },
      ];

      mockPrisma.contributor.findMany.mockResolvedValue(sampleContributors);

      const pdfBuffer = await service.exportThankYouNotesPdf({ template: 'avery_5163' });

      expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
      expect(pdfBuffer.length).toBeGreaterThan(0);
      expect(pdfBuffer.toString('utf-8', 0, 5)).toBe('%PDF-');
    });

    it('provides exportThankYouNotesLabels alias for backwards compatibility', async () => {
      mockPrisma.contributor.findMany.mockResolvedValue([]);

      const pdfBuffer = await service.exportThankYouNotesLabels({ template: 'avery_5160' });

      expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    });

    it('passes explicit or resolved theme options during PDF label export', async () => {
      mockPrisma.contributor.findMany.mockResolvedValue([]);

      const pdfBuffer = await service.exportThankYouNotesPdf({
        template: 'avery_5160',
        themeOptions: {
          fontHeading: 'Playfair Display, serif',
          fontBody: 'Helvetica, sans-serif',
          textColor: '#1f2937',
          primaryColor: '#B91C1C',
        },
      });

      expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
      expect(pdfBuffer.toString('utf-8', 0, 5)).toBe('%PDF-');
    });
  });
});
