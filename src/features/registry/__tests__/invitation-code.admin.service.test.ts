import { InvitationCodeAdminService } from '../invitation-code.admin.service';

describe('InvitationCodeAdminService', () => {
  let service: InvitationCodeAdminService;
  let mockPrismaClient: any;

  beforeEach(() => {
    mockPrismaClient = {
      invitationCode: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new InvitationCodeAdminService();
    // Inject mock client into repo
    service.repo.client = mockPrismaClient;
  });

  describe('validate', () => {
    it('passes for valid invitation code data', async () => {
      await expect(
        (service as any).validate({
          guestName: 'Alice Smith',
          code: 'ALICE123',
          email: 'alice@example.com',
          plusOneAllocations: 2,
        })
      ).resolves.not.toThrow();
    });

    it('throws error when guestName is missing or empty', async () => {
      await expect(
        (service as any).validate({ guestName: '', code: 'ALICE123' })
      ).rejects.toThrow('Validation Error: Guest name is required.');

      await expect(
        (service as any).validate({ code: 'ALICE123' })
      ).rejects.toThrow('Validation Error: Guest name is required.');
    });

    it('throws error when code is empty string', async () => {
      await expect(
        (service as any).validate({ guestName: 'Alice Smith', code: '' })
      ).rejects.toThrow('Validation Error: Code cannot be empty.');
    });

    it('throws error for invalid email format', async () => {
      await expect(
        (service as any).validate({ guestName: 'Alice Smith', code: 'A1', email: 'not-an-email' })
      ).rejects.toThrow('Validation Error: Invalid email format.');
    });

    it('throws error for negative plus-one allocation', async () => {
      await expect(
        (service as any).validate({ guestName: 'Alice Smith', code: 'A1', plusOneAllocations: -1 })
      ).rejects.toThrow('Validation Error: Plus-one allocation must be a non-negative integer.');
    });
  });

  describe('preSave', () => {
    it('trims and converts custom code to uppercase', async () => {
      mockPrismaClient.invitationCode.findUnique.mockResolvedValue(null);
      const data = { guestName: 'Alice', code: '  alice999  ' };
      const processed = await (service as any).preSave(data, mockPrismaClient);

      expect(processed.code).toBe('ALICE999');
      expect(mockPrismaClient.invitationCode.findUnique).toHaveBeenCalledWith({
        where: { code: 'ALICE999' },
      });
    });

    it('generates a random 8-character uppercase alphanumeric code if code is not provided', async () => {
      mockPrismaClient.invitationCode.findUnique.mockResolvedValue(null);
      const data = { guestName: 'Bob' };
      const processed = await (service as any).preSave(data, mockPrismaClient);

      expect(processed.code).toHaveLength(8);
      expect(processed.code).toMatch(/^[A-Z0-9]{8}$/);
      expect(mockPrismaClient.invitationCode.findUnique).toHaveBeenCalledWith({
        where: { code: processed.code },
      });
    });

    it('retries up to 10 times if generated random code collides with an existing one', async () => {
      // First 2 calls return an existing invitation code record, 3rd returns null (unique)
      mockPrismaClient.invitationCode.findUnique
        .mockResolvedValueOnce({ id: 'collided-1', code: 'ABC' })
        .mockResolvedValueOnce({ id: 'collided-2', code: 'DEF' })
        .mockResolvedValue(null);

      const data = { guestName: 'Bob' };
      const processed = await (service as any).preSave(data, mockPrismaClient);

      expect(processed.code).toHaveLength(8);
      expect(mockPrismaClient.invitationCode.findUnique).toHaveBeenCalledTimes(3);
    });

    it('throws error if random code generation fails after 10 attempts', async () => {
      // Always return an existing record to simulate collision 10 times
      mockPrismaClient.invitationCode.findUnique.mockResolvedValue({ id: 'always-collided' });

      const data = { guestName: 'Bob' };
      await expect(
        (service as any).preSave(data, mockPrismaClient)
      ).rejects.toThrow('Failed to generate a unique invitation code.');
    });
  });

  describe('importBatch', () => {
    beforeEach(() => {
      mockPrismaClient.snapshotVersion = {
        create: jest.fn().mockResolvedValue({ id: 'snap-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      };
    });

    it('imports batch of valid guest records successfully including extra fields', async () => {
      mockPrismaClient.invitationCode.findMany.mockResolvedValue([]);
      mockPrismaClient.invitationCode.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'new-id', ...args.data })
      );

      const records = [
        {
          guestName: 'John Doe',
          code: 'JOHN100',
          email: 'john@example.com',
          dietaryNotes: 'Gluten Free',
          plusOneAllocations: 1,
          extraFields: { Table: '5' },
        },
        { guestName: 'Jane Smith', code: '' },
      ];

      const result = await service.importBatch(records, 'skip');

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(0);
      expect(mockPrismaClient.invitationCode.create).toHaveBeenCalledTimes(2);
      expect(mockPrismaClient.invitationCode.create).toHaveBeenNthCalledWith(1, {
        data: {
          guestName: 'John Doe',
          code: 'JOHN100',
          email: 'john@example.com',
          dietaryNotes: 'Gluten Free',
          plusOneAllocations: 1,
          extraFields: { Table: '5' },
          used: false,
        },
      });
    });

    it('skips duplicate codes when collisionStrategy is skip', async () => {
      mockPrismaClient.invitationCode.findMany.mockResolvedValue([
        { id: '1', code: 'EXISTING1', guestName: 'Old Guest' },
      ]);

      const records = [
        { guestName: 'New Guest 1', code: 'EXISTING1' },
        { guestName: 'New Guest 2', code: 'NEWCODE1' },
      ];

      const result = await service.importBatch(records, 'skip');

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
      expect(mockPrismaClient.invitationCode.create).toHaveBeenCalledTimes(1);
    });

    it('updates existing record including extra fields when collisionStrategy is update', async () => {
      mockPrismaClient.invitationCode.findMany.mockResolvedValue([
        { id: '1', code: 'EXISTING1', guestName: 'Old Guest' },
      ]);
      mockPrismaClient.invitationCode.update.mockResolvedValue({ id: '1', guestName: 'Updated Name' });

      const records = [
        {
          guestName: 'Updated Name',
          code: 'EXISTING1',
          email: 'updated@example.com',
          dietaryNotes: 'Vegan',
          plusOneAllocations: 2,
          extraFields: { Group: 'VIP' },
        },
      ];

      const result = await service.importBatch(records, 'update');

      expect(result.updated).toBe(1);
      expect(result.imported).toBe(0);
      expect(mockPrismaClient.invitationCode.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: {
          guestName: 'Updated Name',
          email: 'updated@example.com',
          dietaryNotes: 'Vegan',
          plusOneAllocations: 2,
          extraFields: { Group: 'VIP' },
        },
      });
    });

    it('throws error when collisionStrategy is reject and duplicate code is detected', async () => {
      mockPrismaClient.invitationCode.findMany.mockResolvedValue([
        { id: '1', code: 'EXISTING1', guestName: 'Old Guest' },
      ]);

      const records = [
        { guestName: 'Conflict Guest', code: 'EXISTING1' },
      ];

      await expect(service.importBatch(records, 'reject')).rejects.toThrow(
        'Duplicate invitation code found: EXISTING1'
      );
    });

    it('throws error if row contains invalid email in importBatch', async () => {
      mockPrismaClient.invitationCode.findMany.mockResolvedValue([]);

      const records = [
        { guestName: 'Bad Email Guest', code: 'CODE1', email: 'invalid-email' },
      ];

      await expect(service.importBatch(records, 'skip')).rejects.toThrow(
        'Validation Error: Row 1 has an invalid email format.'
      );
    });
  });
});
