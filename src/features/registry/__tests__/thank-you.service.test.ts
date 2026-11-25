import { inflateSync } from 'zlib';
import { ThankYouService } from '../thank-you.service';
import { getAppConfig } from '@/lib/config';
import { MultiChannelMessagingProvider } from '@/features/broadcast';

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    partner1Name: 'Alex',
    partner2Name: 'Jordan',
    contactEmail: 'couple@wedding.test',
    emailProvider: 'smtp',
    themePreset: 'classic',
    themeTokens: {},
    colorPrimary: '#B91C1C',
  }),
}));

async function streamToText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join('');
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}

describe('ThankYouService', () => {
  let service: ThankYouService;
  let mockPrisma: any;

  beforeEach(() => {
    let mockData: any[] = [];

    const applyMockWhere = (rows: any[], where?: any) => {
      let results = [...rows];
      if (!where) return results;

      if (where.status?.equals) {
        const eq = where.status.equals.toLowerCase();
        results = results.filter(
          (c) => (c.status || 'CONFIRMED').toLowerCase() === eq
        );
      }

      if (where.NOT?.OR) {
        results = results.filter(
          (c) =>
            c.registryItem?.isSample !== true &&
            c.invitationCode?.isSample !== true &&
            !(typeof c.id === 'string' && c.id.startsWith('sample-contributor-'))
        );
      }

      if (where.thankYouStatus?.equals) {
        const eq = where.thankYouStatus.equals.toLowerCase();
        results = results.filter(
          (c) => (c.thankYouStatus || 'unsent').toLowerCase() === eq
        );
      } else if (where.thankYouStatus?.in) {
        const list = where.thankYouStatus.in.map((s: string) => s.toLowerCase());
        results = results.filter((c) =>
          list.includes((c.thankYouStatus || 'unsent').toLowerCase())
        );
      }

      if (where.OR) {
        const term = where.OR[0].name.contains.toLowerCase();
        results = results.filter(
          (c) =>
            (c.name || '').toLowerCase().includes(term) ||
            (c.registryItem?.name || '').toLowerCase().includes(term)
        );
      }

      return results;
    };

    mockPrisma = {
      contributor: {
        findMany: jest.fn().mockImplementation(async (args?: any) => {
          if (!args || (!args.where && args.skip === undefined && args.take === undefined && !args.cursor)) {
            return mockData;
          }
          let results = applyMockWhere(mockData, args.where);
          if (args.cursor?.id) {
            const cursorIdx = results.findIndex((c) => c.id === args.cursor.id);
            if (cursorIdx !== -1) {
              const skip = args.skip ?? 0;
              results = results.slice(cursorIdx + skip);
            }
          } else if (args.skip) {
            results = results.slice(args.skip);
          }
          const take = args.take ?? 50;
          return results.slice(0, take);
        }),
        count: jest.fn().mockImplementation(async (args?: any) => {
          return applyMockWhere(mockData, args?.where).length;
        }),
        groupBy: jest.fn().mockImplementation(async (args?: any) => {
          const filtered = applyMockWhere(mockData, args?.where);
          const map: Record<string, number> = {};
          for (const c of filtered) {
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
      invitationCode: {
        findUnique: jest.fn(),
        update: jest.fn(),
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
            status: { equals: 'CONFIRMED', mode: 'insensitive' },
            NOT: {
              OR: [
                { registryItem: { isSample: true } },
                { invitationCode: { isSample: true } },
                { id: { startsWith: 'sample-contributor-' } },
              ],
            },
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
        where: {
          status: { equals: 'CONFIRMED', mode: 'insensitive' },
          NOT: {
            OR: [
              { registryItem: { isSample: true } },
              { invitationCode: { isSample: true } },
              { id: { startsWith: 'sample-contributor-' } },
            ],
          },
        },
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

    it('links or unlinks guest household, updates contributor postal fields, and syncs address to linked InvitationCode when requested', async () => {
      const existing = {
        id: 'c1',
        name: 'Alice Johnson',
        amount: 100,
        date: '2026-06-01T00:00:00.000Z',
        thankYouStatus: 'Unsent',
        thankYouSentAt: null,
        thankYouNote: null,
        invitationCodeId: null,
      };

      mockPrisma.contributor.findUnique.mockResolvedValue(existing);
      mockPrisma.invitationCode.findUnique.mockResolvedValue({ id: 'inv-household-1' });
      mockPrisma.invitationCode.update.mockResolvedValue({
        id: 'inv-household-1',
        addressLine1: '500 Oak St',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
        country: 'USA',
      });
      mockPrisma.contributor.update.mockImplementation(({ data }: any) =>
        Promise.resolve({
          ...existing,
          ...data,
          invitationCode: data.invitationCodeId
            ? {
              id: 'inv-household-1',
              code: 'HOUSE1',
              guestName: 'Alice & Family',
              addressLine1: '500 Oak St',
              city: 'Austin',
              state: 'TX',
              zipCode: '78701',
              country: 'USA',
            }
            : null,
        })
      );

      const linked = await service.updateThankYouNote('c1', {
        invitationCodeId: 'inv-household-1',
        addressLine1: ' 500 Oak St ',
        city: ' Austin ',
        state: ' TX ',
        zipCode: ' 78701 ',
        country: ' USA ',
        syncAddressToGuest: true,
      });

      expect(linked.invitationCodeId).toBe('inv-household-1');
      expect(linked.addressLine1).toBe('500 Oak St');
      expect(mockPrisma.invitationCode.update).toHaveBeenCalledWith({
        where: { id: 'inv-household-1' },
        data: {
          addressLine1: '500 Oak St',
          city: 'Austin',
          state: 'TX',
          zipCode: '78701',
          country: 'USA',
        },
      });

      // Unlink household by passing invitationCodeId: null
      const unlinked = await service.updateThankYouNote('c1', {
        invitationCodeId: null,
      });
      expect(unlinked.invitationCodeId).toBeNull();
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

      const stream = service.exportThankYouNotesCsv();
      const csv = await streamToText(stream);

      expect(csv).toContain(
        'Contributor Name,Email,Guest Message,Gift Item,Category,Contribution Amount,Contribution Date,Contribution Status,Thank-You Status,Sent Date,Note Draft'
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

      const stream = service.exportThankYouNotesCsv({ status: 'Unsent' });
      const csv = await streamToText(stream);

      expect(csv).toContain('Bob Smith');
      expect(csv).not.toContain('Alice Johnson');
    });

    it('returns empty CSV header row with trailing newline when no records match', async () => {
      mockPrisma.contributor.findMany.mockResolvedValue([]);

      const stream = service.exportThankYouNotesCsv();
      const csv = await streamToText(stream);

      expect(csv).toBe(
        'Contributor Name,Email,Guest Message,Gift Item,Category,Contribution Amount,Contribution Date,Contribution Status,Thank-You Status,Sent Date,Note Draft,Retailer Order Number,Carrier,Tracking Number,Linked Guest,Address Line 1,Address Line 2,City,State,ZIP Code,Country\n'
      );
    });

    it('exports household postal address columns from linked invitationCode with formula neutralization', async () => {
      mockPrisma.contributor.findMany.mockResolvedValue([
        {
          id: 'c-postal-1',
          name: 'Aunt Clara',
          email: 'clara@example.com',
          message: 'With love',
          amount: 200,
          date: '2026-06-10T00:00:00.000Z',
          thankYouStatus: 'Unsent',
          thankYouSentAt: null,
          thankYouNote: '',
          invitationCode: {
            addressLine1: '742 Evergreen Terrace',
            addressLine2: 'Suite 2B',
            city: 'Springfield',
            state: 'IL',
            zipCode: '62704',
            country: 'USA',
          },
          registryItem: null,
        },
        {
          id: 'c-postal-formula',
          name: 'Formula Postal',
          email: '',
          message: '',
          amount: 50,
          date: '2026-06-11T00:00:00.000Z',
          thankYouStatus: 'Unsent',
          thankYouSentAt: null,
          thankYouNote: '',
          invitationCode: {
            addressLine1: '=CMD()',
            addressLine2: '+Apt 9',
            city: '-Metro',
            state: '@NY',
            zipCode: '=10001',
            country: '+Canada',
          },
          registryItem: null,
        },
      ]);

      const stream = service.exportThankYouNotesCsv();
      const csv = await streamToText(stream);

      expect(csv).toContain('742 Evergreen Terrace,Suite 2B,Springfield,IL,62704,USA');
      expect(csv).toContain('\'=CMD(),\'+Apt 9,\'-Metro,\'@NY,\'=10001,\'+Canada');
    });

    it('exports retailer order number, carrier, and tracking number columns with formula neutralization', async () => {
      mockPrisma.contributor.findMany.mockResolvedValue([
        {
          id: 'c-order-1',
          name: 'Taylor Shipper',
          email: 'taylor@example.com',
          message: 'Enjoy!',
          amount: 120,
          date: '2026-06-05T00:00:00.000Z',
          thankYouStatus: 'Unsent',
          thankYouSentAt: null,
          thankYouNote: '',
          retailerOrderNumber: 'ORD-98765',
          carrier: 'UPS',
          trackingNumber: '1Z999AA10123456784',
          registryItem: { id: 'item-ext', name: 'Espresso Machine', category: 'Kitchen' },
        },
        {
          id: 'c-order-formula',
          name: 'Jordan Safe',
          email: 'jordan@example.com',
          message: '',
          amount: 60,
          date: '2026-06-06T00:00:00.000Z',
          thankYouStatus: 'Unsent',
          thankYouSentAt: null,
          thankYouNote: '',
          retailerOrderNumber: '=HYPERLINK("http://evil")',
          carrier: '+FedEx',
          trackingNumber: '@TRACK123',
          registryItem: { id: 'item-ext', name: 'Kettle', category: 'Kitchen' },
        },
      ]);

      const stream = service.exportThankYouNotesCsv();
      const csv = await streamToText(stream);

      expect(csv).toContain('ORD-98765,UPS,1Z999AA10123456784');
      expect(csv).toContain('\'=HYPERLINK(""http://evil"")');
      expect(csv).toContain('\'+FedEx');
      expect(csv).toContain('\'@TRACK123');
    });

    it('queries database in cursor-paginated chunks of 1000 for high-volume exports', async () => {
      const largeDataset = Array.from({ length: 2500 }, (_, i) => ({
        id: `c_${i + 1}`,
        name: `Contributor ${i + 1}`,
        email: `guest${i + 1}@example.com`,
        amount: 50,
        date: '2026-06-01T00:00:00.000Z',
        thankYouStatus: 'Unsent',
        registryItem: { id: 'item1', name: 'Registry Gift', category: 'General' },
      }));

      mockPrisma.contributor.findMany.mockResolvedValue(largeDataset);

      const stream = service.exportThankYouNotesCsv();
      const csv = await streamToText(stream);

      expect(mockPrisma.contributor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 1000,
          orderBy: { id: 'asc' },
          select: expect.any(Object),
        })
      );
      expect(csv).toContain('Contributor 1');
      expect(csv).toContain('Contributor 2500');
    });

    it('neutralizes formula injection characters across contributor fields', async () => {
      const maliciousContributors = [
        {
          id: 'c-malicious',
          name: '=SUM(1,2)',
          email: '-malicious@example.com',
          message: '+123456789',
          amount: 150,
          date: '2026-06-01T00:00:00.000Z',
          thankYouStatus: '@AdminStatus',
          thankYouSentAt: null,
          thankYouNote: '\tNoteDraft',
          registryItem: { id: 'item1', name: '\rItemName', category: '=Category' },
        },
      ];

      mockPrisma.contributor.findMany.mockResolvedValue(maliciousContributors);

      const stream = service.exportThankYouNotesCsv();
      const csv = await streamToText(stream);

      expect(csv).toContain('\'=SUM(1,2)');
      expect(csv).toContain('\'-malicious@example.com');
      expect(csv).toContain('\'+123456789');
      expect(csv).toContain('\'@AdminStatus');
      expect(csv).toContain('\'\tNoteDraft');
      expect(csv).toContain('"\'\rItemName"');
      expect(csv).toContain('\'=Category');
    });

    it('prefixes whitespace-padded formulas while keeping untrimmed plain ContributionSchema messages unprefixed with standard CSV quoting', async () => {
      const { ContributionSchema } = await import('../schemas');
      const parsedPlain = ContributionSchema.parse({
        itemId: 'item1',
        name: 'Grace Hopper',
        email: 'grace@example.com',
        amount: 125,
        message: '  Wishing you a lifetime of joy,\nlaughter, and adventure!  ',
      });
      const parsedFormula = ContributionSchema.parse({
        itemId: 'item1',
        name: 'Eve Tester',
        email: 'eve@example.com',
        amount: 50,
        message: '  =HYPERLINK("https://evil.example","Click")',
      });

      mockPrisma.contributor.findMany.mockResolvedValue([
        {
          id: 'c-plain-msg',
          name: parsedPlain.name,
          email: parsedPlain.email,
          message: parsedPlain.message,
          amount: parsedPlain.amount,
          date: '2026-06-01T00:00:00.000Z',
          thankYouStatus: 'Unsent',
          registryItem: { id: 'item1', name: 'Vase', category: 'Home' },
        },
        {
          id: 'c-padded-formula',
          name: parsedFormula.name,
          email: parsedFormula.email,
          message: parsedFormula.message,
          amount: parsedFormula.amount,
          date: '2026-06-02T00:00:00.000Z',
          thankYouStatus: 'Unsent',
          registryItem: { id: 'item1', name: 'Vase', category: 'Home' },
        },
      ]);

      const stream = service.exportThankYouNotesCsv();
      const csv = await streamToText(stream);

      expect(csv).toContain(
        '"  Wishing you a lifetime of joy,\nlaughter, and adventure!  "',
      );
      expect(csv).toContain(
        '"\'  =HYPERLINK(""https://evil.example"",""Click"")"',
      );
    });

    it('exports Linked Guest and prefers contributor postal address over linked invitationCode address', async () => {
      mockPrisma.contributor.findMany.mockResolvedValue([
        {
          id: 'c-contrib-addr',
          name: 'Alex Donor',
          email: 'alex@example.com',
          amount: 100,
          date: '2026-06-01T00:00:00.000Z',
          thankYouStatus: 'Unsent',
          addressLine1: '888 Contributor Ln',
          addressLine2: 'Apt 3',
          city: 'Seattle',
          state: 'WA',
          zipCode: '98101',
          country: 'USA',
          invitationCode: {
            guestName: 'Alex Household',
            addressLine1: '111 Old Household Rd',
            city: 'Tacoma',
            state: 'WA',
            zipCode: '98402',
            country: 'USA',
          },
          registryItem: { id: 'item1', name: 'Mixer', category: 'Kitchen' },
        },
        {
          id: 'c-invite-fallback',
          name: 'Sam Guest',
          email: 'sam@example.com',
          amount: 75,
          date: '2026-06-02T00:00:00.000Z',
          thankYouStatus: 'Unsent',
          addressLine1: null,
          invitationCode: {
            guestName: 'Sam & Pat',
            addressLine1: '222 Invite Way',
            addressLine2: null,
            city: 'Austin',
            state: 'TX',
            zipCode: '78701',
            country: 'USA',
          },
          registryItem: { id: 'item2', name: 'Blender', category: 'Kitchen' },
        },
      ]);

      const csv = await streamToText(service.exportThankYouNotesCsv());
      expect(csv).toContain('Alex Household,888 Contributor Ln,Apt 3,Seattle,WA,98101,USA');
      expect(csv).not.toContain('111 Old Household Rd');
      expect(csv).toContain('Sam & Pat,222 Invite Way,,Austin,TX,78701,USA');
    });
  });

  describe('exportThankYouNotesPdf', () => {
    it('includes invitationCode address relation in Prisma findMany queries using explicit select', async () => {
      mockPrisma.contributor.findMany.mockResolvedValue([]);

      const stream = service.exportThankYouNotesPdf();
      await streamToBuffer(stream);

      expect(mockPrisma.contributor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
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

      const stream = service.exportThankYouNotesPdf({ template: 'avery_5160' });
      const pdfBuffer = await streamToBuffer(stream);

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

      const stream = service.exportThankYouNotesPdf({ template: 'avery_5163' });
      const pdfBuffer = await streamToBuffer(stream);

      expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
      expect(pdfBuffer.length).toBeGreaterThan(0);
      expect(pdfBuffer.toString('utf-8', 0, 5)).toBe('%PDF-');
    });

    it('passes explicit or resolved theme options during PDF label export', async () => {
      mockPrisma.contributor.findMany.mockResolvedValue([]);

      const stream = service.exportThankYouNotesPdf({
        template: 'avery_5160',
        themeOptions: {
          fontHeading: 'Playfair Display, serif',
          fontBody: 'Helvetica, sans-serif',
          textColor: '#1f2937',
          primaryColor: '#B91C1C',
        },
      });
      const pdfBuffer = await streamToBuffer(stream);

      expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
      expect(pdfBuffer.toString('utf-8', 0, 5)).toBe('%PDF-');
    });
  });

  describe('sendThankYouEmail', () => {
    it('supports preview, test (to AppConfig.contactEmail), and send modes with sanitized subject and HTML', async () => {
      const sendEmailSpy = jest
        .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
        .mockResolvedValue({ success: true });

      const existing = {
        id: 'c-email-1',
        name: 'Riley <Guest>',
        email: 'riley@example.com',
        amount: 150,
        date: '2026-06-01T00:00:00.000Z',
        thankYouStatus: 'Unsent',
        thankYouSentAt: null,
        thankYouEmailSentAt: null,
        thankYouNote: null,
        registryItem: { id: 'r1', name: 'Espresso Machine', category: 'Kitchen' },
        invitationCode: null,
      };
      mockPrisma.contributor.findUnique.mockResolvedValue(existing);
      mockPrisma.contributor.update.mockImplementation(({ data }: any) =>
        Promise.resolve({
          ...existing,
          ...data,
        })
      );

      try {
        // 1. Preview mode sanitizes subject CRLF/angle brackets and escapes HTML in htmlBody without sending
        const preview = await service.sendThankYouEmail('c-email-1', {
          mode: 'preview',
          subject: 'Thank you!\r\n<script>alert(1)</script>',
          body: 'Dear {{guestName}},\n\nThank you for {{giftName}} ({{amount}})! <b>Love</b>',
        });

        expect(sendEmailSpy).not.toHaveBeenCalled();
        expect(preview.subject).toBe('Thank you!scriptalert(1)/script');
        expect(preview.textBody).toContain('Riley <Guest>');
        expect(preview.textBody).toContain('$150.00');
        expect(preview.htmlBody).toContain('&lt;Guest&gt;');
        expect(preview.htmlBody).toContain('&lt;b&gt;Love&lt;/b&gt;');
        expect(preview.htmlBody).not.toContain('<b>Love</b>');

        // 2. Test mode sends [TEST] email to AppConfig.contactEmail without mutating Contributor status
        const testRes = await service.sendThankYouEmail('c-email-1', {
          mode: 'test',
          subject: 'Thank you for your gift!',
          body: 'Dear {{guestName}}, thank you for the {{giftName}}!',
        });

        expect(testRes.to).toBe('couple@wedding.test');
        expect(testRes.subject).toBe('[TEST] Thank you for your gift!');
        expect(sendEmailSpy).toHaveBeenCalledWith({
          to: 'couple@wedding.test',
          subject: '[TEST] Thank you for your gift!',
          body: 'Dear Riley <Guest>, thank you for the Espresso Machine!',
        });
        expect(mockPrisma.contributor.update).not.toHaveBeenCalled();

        // 3. Send mode dispatches email to contributor, marks Sent, records thankYouEmailSentAt, and snapshots
        const sendRes = await service.sendThankYouEmail('c-email-1', {
          mode: 'send',
          subject: 'Thank you from us!',
          body: 'Dear {{guestName}}, thank you so much for the {{giftName}}!',
        });

        expect(sendRes.to).toBe('riley@example.com');
        expect(sendRes.contributor?.thankYouStatus).toBe('Sent');
        expect(sendRes.contributor?.thankYouSentAt).toBeTruthy();
        expect(sendRes.contributor?.thankYouEmailSentAt).toBeTruthy();
        expect(mockPrisma.snapshotVersion.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              entityType: 'Contributor',
              entityId: 'c-email-1',
            }),
          })
        );
      } finally {
        sendEmailSpy.mockRestore();
      }
    });

    it('rejects test mode when AppConfig.contactEmail is missing and send mode when contributor has no email', async () => {
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        partner1Name: 'Alex',
        partner2Name: 'Jordan',
        contactEmail: '',
      });
      mockPrisma.contributor.findUnique.mockResolvedValue({
        id: 'c-no-email',
        name: 'No Email Guest',
        email: null,
        amount: 50,
        date: '2026-06-01T00:00:00.000Z',
        thankYouStatus: 'Unsent',
        invitationCode: null,
        registryItem: null,
      });

      await expect(
        service.sendThankYouEmail('c-no-email', {
          mode: 'test',
          body: 'Thank you!',
        })
      ).rejects.toThrow(/Configure a couple contact email/i);

      await expect(
        service.sendThankYouEmail('c-no-email', {
          mode: 'send',
          body: 'Thank you!',
        })
      ).rejects.toThrow(/no email address on file/i);
    });
  });

  describe('createOfflineGift and household address linking', () => {
    it('records an offline gift linked to a RegistryItem and InvitationCode under row lock and updates ledger + snapshots', async () => {
      const createdRecord = {
        id: 'c-offline-1',
        name: 'Aunt Clara',
        email: 'clara@example.com',
        amount: 150,
        status: 'CONFIRMED',
        message: 'Check at reception',
        date: new Date('2026-06-15T00:00:00.000Z'),
        thankYouStatus: 'Unsent',
        thankYouSentAt: null,
        thankYouNote: 'Thank you so much!',
        registryItemId: 'item-offline-1',
        invitationCodeId: 'inv-clara',
        registryItem: { id: 'item-offline-1', name: 'Stand Mixer', category: 'Kitchen' },
        invitationCode: {
          id: 'inv-clara',
          code: 'CLARA2026',
          guestName: 'Aunt Clara',
          householdName: 'Clara Household',
          addressLine1: '742 Evergreen Terrace',
          addressLine2: null,
          city: 'Springfield',
          state: 'IL',
          zipCode: '62704',
          country: 'USA',
        },
      };

      const txClient = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'item-offline-1' }]),
        invitationCode: {
          findUnique: jest.fn().mockResolvedValue({ id: 'inv-clara', code: 'CLARA2026' }),
        },
        registryItem: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce({
              id: 'item-offline-1',
              name: 'Stand Mixer',
              price: 150,
              quantity: 1,
              itemType: 'PHYSICAL',
              isGroupGift: false,
            })
            .mockResolvedValueOnce({
              id: 'item-offline-1',
              name: 'Stand Mixer',
              price: 150,
              quantity: 1,
              itemType: 'PHYSICAL',
              isGroupGift: false,
              contributors: [createdRecord],
            }),
          update: jest.fn().mockResolvedValue({
            id: 'item-offline-1',
            name: 'Stand Mixer',
            price: 150,
            quantity: 1,
            purchased: true,
            amountContributed: 150,
            purchaserName: 'Aunt Clara',
          }),
        },
        contributor: {
          create: jest.fn().mockResolvedValue(createdRecord),
        },
        snapshotVersion: {
          create: jest.fn().mockResolvedValue({ id: 'snap-offline-1' }),
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };

      mockPrisma.$transaction = jest.fn((cb: any) => cb(txClient));

      const result = await service.createOfflineGift({
        name: '  Aunt Clara  ',
        email: 'clara@example.com',
        amount: 150,
        message: 'Check at reception',
        registryItemId: 'item-offline-1',
        invitationCodeId: 'inv-clara',
        thankYouNote: 'Thank you so much!',
      });

      expect(txClient.$queryRaw).toHaveBeenCalledTimes(1);
      expect(txClient.contributor.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Aunt Clara',
            amount: 150,
            status: 'CONFIRMED',
            registryItemId: 'item-offline-1',
            invitationCodeId: 'inv-clara',
          }),
        })
      );
      expect(txClient.registryItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-offline-1' },
          data: expect.objectContaining({
            amountContributed: 150,
            purchased: true,
            purchaserName: 'Aunt Clara',
          }),
        })
      );
      expect(txClient.snapshotVersion.create).toHaveBeenCalledTimes(2);
      expect(result.invitationCode?.addressLine1).toBe('742 Evergreen Terrace');
    });

    it('links and unlinks invitationCodeId in updateThankYouNote and rejects unknown household IDs', async () => {
      mockPrisma.invitationCode = {
        findUnique: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({
          id: 'inv-valid',
          code: 'VALID26',
        }),
      };

      mockPrisma.contributor.findUnique.mockResolvedValue({
        id: 'c-unlinked',
        name: 'Guest Without Invite',
        amount: 80,
        date: new Date('2026-06-15T00:00:00.000Z'),
        thankYouStatus: 'Unsent',
        invitationCodeId: null,
      });

      await expect(
        service.updateThankYouNote('c-unlinked', { invitationCodeId: 'inv-missing' })
      ).rejects.toThrow('Invitation code not found');

      mockPrisma.contributor.update.mockResolvedValue({
        id: 'c-unlinked',
        name: 'Guest Without Invite',
        amount: 80,
        date: new Date('2026-06-15T00:00:00.000Z'),
        thankYouStatus: 'Unsent',
        invitationCodeId: 'inv-valid',
        invitationCode: {
          id: 'inv-valid',
          code: 'VALID26',
          guestName: 'Guest Household',
          householdName: 'Guest Family',
          addressLine1: '100 Wedding Blvd',
          addressLine2: null,
          city: 'Denver',
          state: 'CO',
          zipCode: '80202',
          country: 'USA',
        },
      });

      const linked = await service.updateThankYouNote('c-unlinked', {
        invitationCodeId: 'inv-valid',
      });
      expect(mockPrisma.contributor.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'c-unlinked' },
          data: expect.objectContaining({ invitationCodeId: 'inv-valid' }),
        })
      );
      expect(linked.invitationCode?.addressLine1).toBe('100 Wedding Blvd');
      expect(mockPrisma.snapshotVersion.create).toHaveBeenCalled();
    });

    it('persists inline street/city/state/zip/country on Contributor in createOfflineGift without requiring a linked household', async () => {
      const txClient = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'item-1' }]),
        registryItem: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'item-1',
            name: 'Cash Fund',
            price: 500,
            amountContributed: 0,
            isGroupGift: true,
          }),
          update: jest.fn().mockResolvedValue({ id: 'item-1' }),
        },
        invitationCode: {
          findUnique: jest.fn(),
        },
        contributor: {
          create: jest.fn().mockImplementation(async ({ data }: any) => ({
            id: 'c-inline-addr',
            ...data,
            date: new Date('2026-06-20T00:00:00.000Z'),
            registryItem: { id: 'item-1', name: 'Cash Fund', category: 'Travel' },
            invitationCode: null,
          })),
        },
        snapshotVersion: {
          create: jest.fn().mockResolvedValue({ id: 'snap-1' }),
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      mockPrisma.$transaction = jest.fn((fn: any) => fn(txClient));

      const created = await service.createOfflineGift({
        name: 'Uncle George',
        amount: 200,
        registryItemId: 'item-1',
        addressLine1: '  550 Madison Ave  ',
        addressLine2: '  Apt 12B ',
        city: ' New York ',
        state: ' NY ',
        zipCode: ' 10022 ',
        country: ' USA ',
      });

      expect(txClient.contributor.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            addressLine1: '550 Madison Ave',
            addressLine2: 'Apt 12B',
            city: 'New York',
            state: 'NY',
            zipCode: '10022',
            country: 'USA',
          }),
        })
      );
      expect(created.addressLine1).toBe('550 Madison Ave');
      expect(created.city).toBe('New York');
    });
  });

  describe('Confirmed-only default filtering, sample suppression, and PDF household deduplication', () => {
    it('excludes RESERVED, CANCELLED, REFUNDED, and live sample records from default queue and ProgressMetrics while allowing secondary inspection', async () => {
      mockPrisma.contributor.findMany.mockResolvedValue([
        {
          id: 'c-confirmed-unsent',
          name: 'Real Confirmed Guest',
          amount: 120,
          status: 'CONFIRMED',
          date: '2026-06-10T00:00:00.000Z',
          thankYouStatus: 'Unsent',
          registryItem: { id: 'r1', name: 'Blender', category: 'Kitchen', isSample: false },
        },
        {
          id: 'c-reserved',
          name: 'Pending Checkout Guest',
          amount: 75,
          status: 'RESERVED',
          date: '2026-06-11T00:00:00.000Z',
          thankYouStatus: 'Unsent',
          registryItem: { id: 'r2', name: 'Toaster', category: 'Kitchen', isSample: false },
        },
        {
          id: 'c-cancelled',
          name: 'Voided Claim Guest',
          amount: 90,
          status: 'CANCELLED',
          date: '2026-06-12T00:00:00.000Z',
          thankYouStatus: 'Not Needed',
          registryItem: { id: 'r3', name: 'Kettle', category: 'Kitchen', isSample: false },
        },
        {
          id: 'c-refunded',
          name: 'Refunded Guest',
          amount: 150,
          status: 'REFUNDED',
          date: '2026-06-13T00:00:00.000Z',
          thankYouStatus: 'Not Needed',
          registryItem: { id: 'r4', name: 'Mixer', category: 'Kitchen', isSample: false },
        },
        {
          id: 'sample-contributor-demo-1',
          name: 'Seeded Demo Contributor',
          amount: 50,
          status: 'CONFIRMED',
          date: '2026-06-14T00:00:00.000Z',
          thankYouStatus: 'Sent',
          registryItem: { id: 'r5', name: 'Plates', category: 'Kitchen', isSample: false },
        },
        {
          id: 'c-sample-item',
          name: 'Sample Registry Contributor',
          amount: 60,
          status: 'CONFIRMED',
          date: '2026-06-15T00:00:00.000Z',
          thankYouStatus: 'Sent',
          registryItem: { id: 'r-sample', name: 'Sample Gift', category: 'Kitchen', isSample: true },
        },
        {
          id: 'c-sample-invite',
          name: 'Sample Invite Contributor',
          amount: 80,
          status: 'CONFIRMED',
          date: '2026-06-16T00:00:00.000Z',
          thankYouStatus: 'Sent',
          invitationCode: { id: 'inv-sample', isSample: true },
          registryItem: { id: 'r6', name: 'Glasses', category: 'Kitchen', isSample: false },
        },
      ]);

      const defaultQueue = await service.getThankYouNotes();
      expect(defaultQueue.items.map((i: { id: string }) => i.id)).toEqual(['c-confirmed-unsent']);
      // 0 confirmed gifts thanked => 0% completion (not inflated by CANCELLED/REFUNDED "Not Needed" or sample "Sent")
      expect(defaultQueue.metrics).toEqual({
        total: 1,
        sent: 0,
        unsent: 1,
        notNeeded: 0,
        thanked: 0,
        completionPercentage: 0,
      });

      // Secondary filter inspects RESERVED claims without polluting ProgressMetrics
      const reservedQueue = await service.getThankYouNotes({ contributorStatus: 'RESERVED' });
      expect(reservedQueue.items.map((i: { id: string }) => i.id)).toEqual(['c-reserved']);
      expect(reservedQueue.metrics.total).toBe(1);
      expect(reservedQueue.metrics.completionPercentage).toBe(0);

      // ALL lifecycle states still suppresses live sample records
      const allLifecycleQueue = await service.getThankYouNotes({ contributorStatus: 'ALL' });
      expect(allLifecycleQueue.items.map((i: { id: string }) => i.id)).toEqual([
        'c-confirmed-unsent',
        'c-reserved',
        'c-cancelled',
        'c-refunded',
      ]);

      // CSV export excludes unfulfilled/sample rows by default, and includes Contribution Status when ALL is requested
      const defaultCsv = await streamToText(service.exportThankYouNotesCsv());
      expect(defaultCsv).toContain('Real Confirmed Guest');
      expect(defaultCsv).not.toContain('Pending Checkout Guest');
      expect(defaultCsv).not.toContain('Voided Claim Guest');
      expect(defaultCsv).not.toContain('Seeded Demo Contributor');

      const allCsv = await streamToText(
        service.exportThankYouNotesCsv({ contributorStatus: 'ALL' })
      );
      expect(allCsv).toContain('Pending Checkout Guest');
      expect(allCsv).toContain('RESERVED');
      expect(allCsv).toContain('CANCELLED');
      expect(allCsv).not.toContain('Seeded Demo Contributor');
    });

    it('retains sample records when STATIC_EXPORT=true', async () => {
      const prevStatic = process.env.STATIC_EXPORT;
      process.env.STATIC_EXPORT = 'true';
      try {
        mockPrisma.contributor.findMany.mockResolvedValue([
          {
            id: 'sample-contributor-1',
            name: 'Static Demo Guest',
            amount: 100,
            status: 'CONFIRMED',
            date: '2026-06-10T00:00:00.000Z',
            thankYouStatus: 'Sent',
          },
        ]);

        const res = await service.getThankYouNotes();
        expect(res.items).toHaveLength(1);
        expect(res.items[0].id).toBe('sample-contributor-1');
      } finally {
        if (prevStatic === undefined) {
          delete process.env.STATIC_EXPORT;
        } else {
          process.env.STATIC_EXPORT = prevStatic;
        }
      }
    });

    it('skips unaddressed labels by default and deduplicates multi-gift households by invitationCodeId or normalized address', async () => {
      mockPrisma.contributor.findMany.mockResolvedValue([
        {
          id: 'c-hh1-gift1',
          name: 'Sarah Jenkins',
          status: 'CONFIRMED',
          date: '2026-06-01T00:00:00.000Z',
          thankYouStatus: 'Unsent',
          invitationCodeId: 'inv-jenkins',
          invitationCode: {
            id: 'inv-jenkins',
            householdName: 'The Jenkins Family',
            addressLine1: '742 Evergreen Terrace',
            city: 'Springfield',
            state: 'IL',
            zipCode: '62704',
            country: 'USA',
          },
        },
        {
          id: 'c-hh1-gift2',
          name: 'Mark Jenkins',
          status: 'CONFIRMED',
          date: '2026-06-02T00:00:00.000Z',
          thankYouStatus: 'Unsent',
          invitationCodeId: 'inv-jenkins',
          invitationCode: {
            id: 'inv-jenkins',
            householdName: 'The Jenkins Family',
            addressLine1: '742 Evergreen Terrace',
            city: 'Springfield',
            state: 'IL',
            zipCode: '62704',
            country: 'USA',
          },
        },
        {
          id: 'c-addr-dup-1',
          name: 'Cousin Vinny',
          status: 'CONFIRMED',
          date: '2026-06-03T00:00:00.000Z',
          thankYouStatus: 'Unsent',
          addressLine1: '100 Main St',
          city: 'Brooklyn',
          state: 'NY',
          zipCode: '11201',
          country: 'USA',
        },
        {
          id: 'c-addr-dup-2',
          name: 'Mona Lisa Vito',
          status: 'CONFIRMED',
          date: '2026-06-04T00:00:00.000Z',
          thankYouStatus: 'Unsent',
          addressLine1: '  100 MAIN ST ',
          city: 'brooklyn',
          state: 'ny',
          zipCode: '11201',
          country: 'usa',
        },
        {
          id: 'c-unaddressed',
          name: 'Unaddressed Donor',
          status: 'CONFIRMED',
          date: '2026-06-05T00:00:00.000Z',
          thankYouStatus: 'Unsent',
        },
      ]);

      const extractDecompressedPdfStreams = (pdfBuf: Buffer): string => {
        const raw = pdfBuf.toString('latin1');
        const lines: string[] = [];
        const regex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(raw)) !== null) {
          let inflated = match[1];
          try {
            inflated = inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
          } catch {
            // Uncompressed stream
          }
          // Extract text runs from [(...) num (...) / <hex> ...] TJ and (...) Tj / <hex> Tj
          const textOpRegex = /\[((?:\\.|[^\]])*)\]\s*TJ|\(((?:\\.|[^)])*)\)\s*Tj|<([0-9a-fA-F]+)>\s*Tj/g;
          let op: RegExpExecArray | null;
          while ((op = textOpRegex.exec(inflated)) !== null) {
            if (op[1] !== undefined) {
              const segRegex = /\(((?:\\.|[^)])*)\)|<([0-9a-fA-F]+)>/g;
              let seg: RegExpExecArray | null;
              let joined = '';
              while ((seg = segRegex.exec(op[1])) !== null) {
                if (seg[1] !== undefined) {
                  joined += seg[1];
                } else if (seg[2] !== undefined) {
                  joined += Buffer.from(seg[2], 'hex').toString('latin1');
                }
              }
              lines.push(joined);
            } else if (op[2] !== undefined) {
              lines.push(op[2]);
            } else if (op[3] !== undefined) {
              lines.push(Buffer.from(op[3], 'hex').toString('latin1'));
            }
          }
        }
        return lines.join('\n');
      };

      // Default call (skipUnaddressed defaults to true):
      // - Unaddressed Donor is skipped (no "Address Pending")
      // - 2 gifts from inv-jenkins -> 1 label
      // - 2 gifts sharing normalized "100 Main St, Brooklyn, NY 11201" -> 1 label
      const defaultPdfBytes = await streamToBuffer(service.exportThankYouNotesPdf());
      expect(defaultPdfBytes.toString('utf-8', 0, 5)).toBe('%PDF-');

      const defaultDecompressed = extractDecompressedPdfStreams(defaultPdfBytes);
      expect(defaultDecompressed).not.toContain('Address Pending');
      expect(defaultDecompressed).not.toContain('Unaddressed Donor');
      expect((defaultDecompressed.match(/742 Evergreen Terrace/g) || []).length).toBe(1);
      expect((defaultDecompressed.match(/100 Main St/gi) || []).length).toBe(1);

      // Explicit skipUnaddressed: false includes "Address Pending" for Unaddressed Donor
      const includeUnaddressedBytes = await streamToBuffer(
        service.exportThankYouNotesPdf({ skipUnaddressed: false })
      );
      expect(includeUnaddressedBytes.toString('utf-8', 0, 5)).toBe('%PDF-');

      const includeDecompressed = extractDecompressedPdfStreams(includeUnaddressedBytes);
      expect(includeDecompressed).toContain('Address Pending');
      expect(includeDecompressed).toContain('Unaddressed Donor');
    });
  });
});
