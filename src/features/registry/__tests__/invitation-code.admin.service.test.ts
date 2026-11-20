import { InvitationCodeAdminService } from '../invitation-code.admin.service';

describe('InvitationCodeAdminService', () => {
  let service: InvitationCodeAdminService;
  let mockPrismaClient: any;

  beforeEach(() => {
    mockPrismaClient = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      invitationCode: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        createMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      contributor: {
        updateMany: jest.fn(),
      },
      subEventAccess: {
        deleteMany: jest.fn(),
      },
      subEventRsvp: {
        deleteMany: jest.fn(),
      },
      broadcastRecipient: {
        updateMany: jest.fn(),
      },
      snapshotVersion: {
        create: jest.fn().mockResolvedValue({ id: 'snap-1' }),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
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

    it('throws error for plusOneFirstName or plusOneLastName over 100 characters', async () => {
      const longName = 'A'.repeat(101);
      await expect(
        (service as any).validate({ guestName: 'Alice Smith', code: 'A1', plusOneFirstName: longName })
      ).rejects.toThrow('Validation Error: Plus-one first name must be under 100 characters.');

      await expect(
        (service as any).validate({ guestName: 'Alice Smith', code: 'A1', plusOneLastName: longName })
      ).rejects.toThrow('Validation Error: Plus-one last name must be under 100 characters.');
    });
  });

  describe('preSave', () => {
    it('trims companion names and coerces empty strings to null', async () => {
      mockPrismaClient.invitationCode.findUnique.mockResolvedValue(null);
      const data = {
        guestName: 'Alice',
        code: '  alice999  ',
        plusOneFirstName: '  Jane  ',
        plusOneLastName: '   ',
      };
      const processed = await (service as any).preSave(data, mockPrismaClient);

      expect(processed.guestName).toBe('Alice');
      expect(processed.code).toBe('ALICE999');
      expect(processed.plusOneFirstName).toBe('Jane');
      expect(processed.plusOneLastName).toBeNull();
    });

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
      mockPrismaClient.invitationCode.createMany.mockResolvedValue({ count: 2 });

      const records = [
        {
          guestName: 'John Doe',
          code: 'JOHN100',
          email: 'john@example.com',
          dietaryNotes: 'Gluten Free',
          plusOneAllocations: 1,
          plusOneFirstName: 'Sarah',
          plusOneLastName: 'Doe',
          extraFields: { Table: '5' },
        },
        { guestName: 'Jane Smith', code: '' },
      ];

      const result = await service.importBatch(records, 'skip');

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);
      expect(result.imported).toBe(2);
      expect(result.skipped).toBe(0);
      expect(mockPrismaClient.invitationCode.createMany).toHaveBeenCalledTimes(1);
      const createManyCall = mockPrismaClient.invitationCode.createMany.mock.calls[0][0];
      expect(createManyCall.data).toHaveLength(2);
      expect(createManyCall.data[0]).toEqual({
        guestName: 'John Doe',
        code: 'JOHN100',
        email: 'john@example.com',
        householdName: null,
        partyGroup: null,
        partyTags: [],
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        zipCode: null,
        country: null,
        dietaryNotes: 'Gluten Free',
        plusOneAllocations: 1,
        plusOneFirstName: 'Sarah',
        plusOneLastName: 'Doe',
        extraFields: { Table: '5' },
        used: false,
      });
      expect(createManyCall.data[1].guestName).toBe('Jane Smith');
      expect(createManyCall.data[1].code).toMatch(/^[A-Z0-9]{8}$/);
    });

    it('skips duplicate codes when collisionStrategy is skip', async () => {
      mockPrismaClient.invitationCode.findMany.mockResolvedValue([
        { id: '1', code: 'EXISTING1', guestName: 'Old Guest' },
      ]);
      mockPrismaClient.invitationCode.createMany.mockResolvedValue({ count: 1 });

      const records = [
        { guestName: 'New Guest 1', code: 'EXISTING1' },
        { guestName: 'New Guest 2', code: 'NEWCODE1' },
      ];

      const result = await service.importBatch(records, 'skip');

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
      expect(mockPrismaClient.invitationCode.createMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaClient.invitationCode.createMany).toHaveBeenCalledWith({
        data: [
          {
            guestName: 'New Guest 2',
            code: 'NEWCODE1',
            email: null,
            householdName: null,
            partyGroup: null,
            partyTags: [],
            addressLine1: null,
            addressLine2: null,
            city: null,
            state: null,
            zipCode: null,
            country: null,
            dietaryNotes: null,
            plusOneAllocations: 0,
            plusOneFirstName: null,
            plusOneLastName: null,
            extraFields: undefined,
            used: false,
          },
        ],
      });
    });

    it('updates existing record including extra fields when collisionStrategy is update', async () => {
      mockPrismaClient.invitationCode.findMany.mockResolvedValue([
        { id: '1', code: 'EXISTING1', guestName: 'Old Guest' },
      ]);
      mockPrismaClient.$executeRaw.mockResolvedValue(1);

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
      expect(mockPrismaClient.invitationCode.createMany).not.toHaveBeenCalled();
      expect(mockPrismaClient.invitationCode.update).not.toHaveBeenCalled();
      expect(mockPrismaClient.$executeRaw).toHaveBeenCalledTimes(1);

      const rawQuery = mockPrismaClient.$executeRaw.mock.calls[0][0];
      expect(rawQuery.sql).toContain('UPDATE "InvitationCode" AS t');
      expect(rawQuery.sql).toContain('WHERE t."id" = v."id"');
      expect(rawQuery.values).toContain('1');
      expect(rawQuery.values).toContain('Updated Name');
      expect(rawQuery.values).toContain('updated@example.com');
      expect(rawQuery.values).toContain('Vegan');
      expect(rawQuery.values).toContain(2);
      expect(rawQuery.values).toContain(JSON.stringify({ Group: 'VIP' }));
    });

    it('processes bulk updates in a single raw SQL execution', async () => {
      // Simulate 60 existing records in DB to exceed previous chunk boundaries
      const dbRecords = Array.from({ length: 60 }, (_, idx) => ({
        id: `id-${idx + 1}`,
        code: `CODE${idx + 1}`,
        guestName: `Guest ${idx + 1}`,
      }));
      mockPrismaClient.invitationCode.findMany.mockResolvedValue(dbRecords);
      mockPrismaClient.$executeRaw.mockResolvedValue(60);

      const records = dbRecords.map((rec) => ({
        guestName: `${rec.guestName} Updated`,
        code: rec.code,
      }));

      const result = await service.importBatch(records, 'update');

      expect(result.updated).toBe(60);
      expect(result.imported).toBe(0);
      expect(mockPrismaClient.invitationCode.update).not.toHaveBeenCalled();
      expect(mockPrismaClient.$executeRaw).toHaveBeenCalledTimes(1);

      const rawQuery = mockPrismaClient.$executeRaw.mock.calls[0][0];
      expect(rawQuery.sql).toContain('UPDATE "InvitationCode" AS t');
      expect(rawQuery.values).toContain('id-1');
      expect(rawQuery.values).toContain('id-60');
      expect(rawQuery.values).toContain('Guest 1 Updated');
      expect(rawQuery.values).toContain('Guest 60 Updated');
    });

    it('skips executeRaw when there are no records to update', async () => {
      mockPrismaClient.invitationCode.findMany.mockResolvedValue([]);
      mockPrismaClient.invitationCode.createMany.mockResolvedValue({ count: 1 });

      const records = [
        { guestName: 'Brand New Guest', code: 'NEW1' },
      ];

      const result = await service.importBatch(records, 'update');

      expect(result.imported).toBe(1);
      expect(result.updated).toBe(0);
      expect(mockPrismaClient.$executeRaw).not.toHaveBeenCalled();
    });

    it('rolls back transaction and does not write audit snapshot when executeRaw fails', async () => {
      mockPrismaClient.invitationCode.findMany.mockResolvedValue([
        { id: '1', code: 'EXISTING1', guestName: 'Old Guest' },
      ]);
      mockPrismaClient.$executeRaw.mockRejectedValue(new Error('Database execution failed'));

      const records = [
        { guestName: 'Updated Name', code: 'EXISTING1' },
      ];

      await expect(service.importBatch(records, 'update')).rejects.toThrow('Database execution failed');
      expect(mockPrismaClient.snapshotVersion.create).not.toHaveBeenCalled();
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

  describe('dryRunValidateBatch', () => {
    it('returns dry-run validation response without mutating database', async () => {
      mockPrismaClient.invitationCode.findMany.mockResolvedValue([
        { id: '1', code: 'EXISTING1', guestName: 'Existing Person' },
      ]);

      const records = [
        { guestName: 'Alice Smith', code: 'EXISTING1', email: 'alice@example.com' },
        { guestName: 'Bob Jones', code: 'BOB200' },
        { guestName: '', code: 'BAD1' },
      ];

      const result = await service.dryRunValidateBatch(records, 'skip');

      expect(result.success).toBe(true);
      expect(result.summary).toEqual({
        total: 3,
        validCount: 2,
        invalidCount: 1,
        duplicateCount: 1,
        updatedCount: 0,
        skippedCount: 1,
        createdCount: 1,
      });

      // Confirm DB mutation methods were never called
      expect(mockPrismaClient.invitationCode.create).not.toHaveBeenCalled();
      expect(mockPrismaClient.invitationCode.createMany).not.toHaveBeenCalled();
      expect(mockPrismaClient.invitationCode.update).not.toHaveBeenCalled();

      // Row 1 checks: Collision with EXISTING1 -> existingGuestName = 'Existing Person'
      expect(result.rows[0].isDuplicate).toBe(true);
      expect(result.rows[0].existingGuestName).toBe('Existing Person');
      expect(result.rows[0].actionOutcome).toBe('skip');
      expect(result.rows[0].isValid).toBe(true);

      // Row 2 checks: Valid new row
      expect(result.rows[1].isDuplicate).toBe(false);
      expect(result.rows[1].actionOutcome).toBe('create');
      expect(result.rows[1].isValid).toBe(true);

      // Row 3 checks: Invalid missing name
      expect(result.rows[2].isValid).toBe(false);
      expect(result.rows[2].errors).toContain('Guest name is required.');
    });

    it('reports reject outcome and error when collisionStrategy is reject and code exists', async () => {
      mockPrismaClient.invitationCode.findMany.mockResolvedValue([
        { id: '1', code: 'EXISTING1', guestName: 'John Doe' },
      ]);

      const records = [{ guestName: 'Jane Smith', code: 'EXISTING1' }];

      const result = await service.dryRunValidateBatch(records, 'reject');

      expect(result.summary.invalidCount).toBe(1);
      expect(result.rows[0].isValid).toBe(false);
      expect(result.rows[0].existingGuestName).toBe('John Doe');
      expect(result.rows[0].errors[0]).toContain('already exists in database (belongs to "John Doe")');
      expect(result.rows[0].actionOutcome).toBe('reject');
    });

    it('reports update outcome when collisionStrategy is update and code exists', async () => {
      mockPrismaClient.invitationCode.findMany.mockResolvedValue([
        { id: '1', code: 'EXISTING1', guestName: 'John Doe' },
      ]);

      const records = [{ guestName: 'Jane Smith Updated', code: 'EXISTING1' }];

      const result = await service.dryRunValidateBatch(records, 'update');

      expect(result.summary.validCount).toBe(1);
      expect(result.summary.updatedCount).toBe(1);
      expect(result.rows[0].isValid).toBe(true);
      expect(result.rows[0].existingGuestName).toBe('John Doe');
      expect(result.rows[0].actionOutcome).toBe('update');
      expect(result.rows[0].warnings[0]).toContain('already exists in database for guest "John Doe". Will be updated.');
    });

    it('maps validation and duplicate code errors to specific columns in fieldErrors', async () => {
      mockPrismaClient.invitationCode.findMany.mockResolvedValue([
        { id: '1', code: 'TAKEN1', guestName: 'Existing Guest' },
      ]);

      const records = [
        { guestName: 'Alice Smith', code: 'TAKEN1', email: 'bad-email' },
        { guestName: 'Bob Dup 1', code: 'BATCHDUP' },
        { guestName: 'Bob Dup 2', code: 'BATCHDUP' },
      ];

      const result = await service.dryRunValidateBatch(records, 'reject');

      expect(result.rows[0].fieldErrors).toEqual({
        email: ['Invalid email format.'],
        code: ['Code "TAKEN1" already exists in database (belongs to "Existing Guest").'],
      });
      expect(result.rows[1].fieldErrors).toEqual({
        code: ['Duplicate invitation code "BATCHDUP" within batch.'],
      });
    });
  });

  describe('batchDelete', () => {
    it('deletes batch of invitation code IDs and logs audit snapshot', async () => {
      mockPrismaClient.invitationCode.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.batchDelete(['code-1', 'code-2'], 'Admin');

      expect(result).toEqual({ success: true, count: 2 });
      expect(mockPrismaClient.contributor.updateMany).toHaveBeenCalledWith({
        where: { invitationCodeId: { in: ['code-1', 'code-2'] } },
        data: { invitationCodeId: null },
      });
      expect(mockPrismaClient.subEventAccess.deleteMany).toHaveBeenCalledWith({
        where: { invitationCodeId: { in: ['code-1', 'code-2'] } },
      });
      expect(mockPrismaClient.subEventRsvp.deleteMany).toHaveBeenCalledWith({
        where: { invitationCodeId: { in: ['code-1', 'code-2'] } },
      });
      expect(mockPrismaClient.broadcastRecipient.updateMany).toHaveBeenCalledWith({
        where: { invitationCodeId: { in: ['code-1', 'code-2'] } },
        data: { invitationCodeId: null },
      });
      expect(mockPrismaClient.invitationCode.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['code-1', 'code-2'] } },
      });
      expect(mockPrismaClient.snapshotVersion.create).toHaveBeenCalledWith({
        data: {
          entityType: 'InvitationCode',
          entityId: 'batch_delete',
          data: { count: 2, ids: ['code-1', 'code-2'] },
          author: 'Admin',
        },
      });
    });

    it('throws validation error if IDs array is empty', async () => {
      await expect(service.batchDelete([], 'Admin')).rejects.toThrow(
        'Validation Error: IDs array cannot be empty.'
      );
    });

    it('throws validation error if an ID in array is invalid', async () => {
      await expect(service.batchDelete(['valid-id', ''], 'Admin')).rejects.toThrow(
        'Validation Error: Invalid ID in array.'
      );
    });
  });

  describe('update', () => {
    beforeEach(() => {
      mockPrismaClient.$transaction = jest.fn((cb: any) => cb(mockPrismaClient));
    });

    it('updates profile and address fields, normalizes cleared strings to null, and leaves omitted fields untouched', async () => {
      mockPrismaClient.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-1',
        code: 'ALICE123',
      });
      mockPrismaClient.invitationCode.update.mockImplementation(({ where, data }: any) =>
        Promise.resolve({
          id: where.id,
          tableId: 'table-4',
          seatNumber: 2,
          used: true,
          ...data,
        })
      );

      const result = await service.update('inv-1', {
        guestName: '  Alice Smith-Updated  ',
        code: '  alice123 ',
        email: '   ',
        addressLine1: ' 742 Evergreen Terrace ',
        addressLine2: '',
        city: 'Springfield',
        dietaryNotes: '  Gluten-Free ',
        partyTags: [' VIP ', ' Family ', ''],
      });

      expect(mockPrismaClient.invitationCode.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: {
          guestName: 'Alice Smith-Updated',
          code: 'ALICE123',
          email: null,
          addressLine1: '742 Evergreen Terrace',
          addressLine2: null,
          city: 'Springfield',
          dietaryNotes: 'Gluten-Free',
          partyTags: ['VIP', 'Family'],
        },
      });
      expect(result.tableId).toBe('table-4');
      expect(result.seatNumber).toBe(2);
      expect(result.used).toBe(true);
    });

    it('rejects changing code when new code already belongs to a different guest', async () => {
      mockPrismaClient.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-other',
        code: 'TAKEN999',
      });

      await expect(
        service.update('inv-1', {
          guestName: 'Alice Smith',
          code: 'taken999',
        })
      ).rejects.toThrow('Validation Error: Invitation code "TAKEN999" is already in use.');

      expect(mockPrismaClient.invitationCode.update).not.toHaveBeenCalled();
    });
  });

  describe('updateBatch', () => {
    beforeEach(() => {
      mockPrismaClient.$transaction = jest.fn(
        (cb: (_tx: typeof mockPrismaClient) => unknown) => cb(mockPrismaClient)
      );
      mockPrismaClient.invitationCode.updateMany = jest.fn().mockResolvedValue({ count: 2 });
    });

    it('updates partial fields across multiple records without requiring guestName or generating codes', async () => {
      mockPrismaClient.invitationCode.findMany.mockResolvedValue([
        { id: 'inv-1', code: 'CODE1', guestName: 'Guest 1', used: true, householdName: 'Smith' },
        { id: 'inv-2', code: 'CODE2', guestName: 'Guest 2', used: true, householdName: 'Smith' },
      ]);

      const updated = await service.updateBatch(['inv-1', 'inv-2'], {
        used: true,
        householdName: '  Smith  ',
      });

      expect(updated).toHaveLength(2);
      expect(mockPrismaClient.invitationCode.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['inv-1', 'inv-2'] } },
        data: {
          used: true,
          householdName: 'Smith',
        },
      });
      expect(mockPrismaClient.invitationCode.findUnique).not.toHaveBeenCalled();
    });

    it('rejects assigning a single invitation code across multiple records in updateBatch', async () => {
      await expect(
        service.updateBatch(['inv-1', 'inv-2'], { code: 'SHAREDCODE' })
      ).rejects.toThrow(
        'Validation Error: Invitation code cannot be shared across multiple guest records.'
      );
      expect(mockPrismaClient.invitationCode.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('batchUpdateTags', () => {
    beforeEach(() => {
      mockPrismaClient.$transaction = jest.fn(
        (cb: (_tx: typeof mockPrismaClient) => unknown) => cb(mockPrismaClient)
      );
      mockPrismaClient.$executeRaw = jest.fn().mockResolvedValue(120);
    });

    it('updates 120 guests in a single executeRaw UPDATE ... FROM (VALUES ...) query and records batch snapshots', async () => {
      const dbRecords = Array.from({ length: 120 }, (_, i) => ({
        id: `inv-${i + 1}`,
        code: `CODE${i + 1}`,
        guestName: `Guest ${i + 1}`,
        partyTags: i % 2 === 0 ? ['Existing', ' VIP '] : [],
        used: false,
      }));
      mockPrismaClient.invitationCode.findMany.mockResolvedValue(dbRecords);

      const inputIds = [
        ...dbRecords.map((r) => r.id),
        'inv-1',
        '  inv-2  ',
      ];

      const updated = await service.batchUpdateTags(
        inputIds,
        ['  VIP  ', 'Wedding Party', '', 'VIP'],
        'add',
        'TestAdmin'
      );

      expect(updated).toHaveLength(120);
      expect(updated[0].partyTags).toEqual(['Existing', 'VIP', 'Wedding Party']);
      expect(updated[1].partyTags).toEqual(['VIP', 'Wedding Party']);

      expect(mockPrismaClient.invitationCode.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaClient.invitationCode.findMany).toHaveBeenCalledWith({
        where: { id: { in: dbRecords.map((r) => r.id) } },
      });

      expect(mockPrismaClient.$executeRaw).toHaveBeenCalledTimes(1);
      expect(mockPrismaClient.invitationCode.update).not.toHaveBeenCalled();

      const sqlArg = mockPrismaClient.$executeRaw.mock.calls[0][0];
      const sqlText = Array.isArray(sqlArg?.strings) ? sqlArg.strings.join('?') : String(sqlArg);
      expect(sqlText).toContain('UPDATE "InvitationCode" AS t');
      expect(sqlText).toContain('FROM (VALUES');

      expect(mockPrismaClient.snapshotVersion.createMany).toHaveBeenCalledTimes(1);
      const snapshotData = mockPrismaClient.snapshotVersion.createMany.mock.calls[0][0].data;
      expect(snapshotData).toHaveLength(120);
      expect(snapshotData[0]).toMatchObject({
        entityType: 'InvitationCode',
        entityId: 'inv-1',
        author: 'TestAdmin',
      });
      expect(mockPrismaClient.snapshotVersion.create).not.toHaveBeenCalled();
    });

    it('supports remove and replace actions including clearing all tags on replace', async () => {
      mockPrismaClient.invitationCode.findMany.mockResolvedValue([
        { id: 'inv-1', code: 'C1', guestName: 'G1', partyTags: ['VIP', 'Family', 'Friends'] },
        { id: 'inv-2', code: 'C2', guestName: 'G2', partyTags: ['Friends'] },
      ]);

      const afterRemove = await service.batchUpdateTags(
        ['inv-1', 'inv-2'],
        [' Friends ', ''],
        'remove'
      );
      expect(afterRemove[0].partyTags).toEqual(['VIP', 'Family']);
      expect(afterRemove[1].partyTags).toEqual([]);

      const afterClear = await service.batchUpdateTags(['inv-1', 'inv-2'], ['   '], 'replace');
      expect(afterClear[0].partyTags).toEqual([]);
      expect(afterClear[1].partyTags).toEqual([]);
    });

    it('skips executeRaw and createBatchSnapshots when zero rows match ids', async () => {
      mockPrismaClient.invitationCode.findMany.mockResolvedValue([]);

      const result = await service.batchUpdateTags(['missing-1', 'missing-2'], ['VIP'], 'add');

      expect(result).toEqual([]);
      expect(mockPrismaClient.$executeRaw).not.toHaveBeenCalled();
      expect(mockPrismaClient.snapshotVersion.createMany).not.toHaveBeenCalled();
      expect(mockPrismaClient.snapshotVersion.create).not.toHaveBeenCalled();
    });

    it('validates ids and rejects empty normalized tags on add or remove', async () => {
      await expect(service.batchUpdateTags([], ['VIP'], 'add')).rejects.toThrow(
        'Validation Error: IDs array cannot be empty.'
      );

      const tooManyIds = Array.from({ length: 5001 }, (_, i) => `inv-${i}`);
      await expect(service.batchUpdateTags(tooManyIds, ['VIP'], 'add')).rejects.toThrow(
        'Validation Error: Maximum of 5000 invitation code IDs allowed per batch request.'
      );

      await expect(service.batchUpdateTags(['inv-1', '   '], ['VIP'], 'add')).rejects.toThrow(
        'Validation Error: Invalid ID in array.'
      );

      await expect(service.batchUpdateTags(['inv-1'], ['   ', ''], 'add')).rejects.toThrow(
        'Validation Error: At least one non-empty tag is required when adding or removing tags.'
      );

      await expect(service.batchUpdateTags(['inv-1'], [], 'remove')).rejects.toThrow(
        'Validation Error: At least one non-empty tag is required when adding or removing tags.'
      );

      expect(mockPrismaClient.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('composite blank-code matching in dryRunValidateBatch and importBatch', () => {
    const seededDbRecords = [
      {
        id: 'db-email',
        code: 'JANE2026',
        guestName: 'Jane Doe',
        email: 'jane@example.com',
        householdName: 'Doe Family',
      },
      {
        id: 'db-hh-1',
        code: 'JOHN0001',
        guestName: 'John Smith',
        email: null,
        householdName: 'North Smiths',
      },
      {
        id: 'db-hh-2',
        code: 'JOHN0002',
        guestName: 'John Smith',
        email: null,
        householdName: 'South Smiths',
      },
      {
        id: 'db-uniq',
        code: 'UNIQ1111',
        guestName: 'Clara Oswald',
        email: null,
        householdName: null,
      },
    ];

    it('matches blank-code rows by email, name+household, and unique name in dryRunValidateBatch with a single findMany query and warns on ambiguous names', async () => {
      mockPrismaClient.invitationCode.findMany.mockResolvedValue(seededDbRecords);

      const records = [
        { guestName: 'Jane Doe-Updated', code: '', email: 'JANE@example.com' },
        { guestName: 'John Smith', code: '', householdName: 'South Smiths' },
        { guestName: 'Clara Oswald', code: '' },
        { guestName: 'John Smith', code: '' }, // ambiguous name without email or household
      ];

      const result = await service.dryRunValidateBatch(records, 'update');

      expect(mockPrismaClient.invitationCode.findMany).toHaveBeenCalledTimes(1);
      expect(result.summary).toEqual({
        total: 4,
        validCount: 4,
        invalidCount: 0,
        duplicateCount: 3,
        updatedCount: 3,
        skippedCount: 0,
        createdCount: 1,
      });

      expect(result.rows[0]).toMatchObject({
        code: 'JANE2026',
        isDuplicate: true,
        existingGuestName: 'Jane Doe',
        actionOutcome: 'update',
      });
      expect(result.rows[1]).toMatchObject({
        code: 'JOHN0002',
        isDuplicate: true,
        existingGuestName: 'John Smith',
        actionOutcome: 'update',
      });
      expect(result.rows[2]).toMatchObject({
        code: 'UNIQ1111',
        isDuplicate: true,
        existingGuestName: 'Clara Oswald',
        actionOutcome: 'update',
      });
      expect(result.rows[3]).toMatchObject({
        code: '',
        isDuplicate: false,
        actionOutcome: 'create',
      });
      expect(result.rows[3].warnings[0]).toContain(
        'Multiple existing guests named "John Smith"'
      );
    });

    it('updates matched blank-code guests in importBatch without generating duplicate random codes', async () => {
      mockPrismaClient.invitationCode.findMany.mockResolvedValue(seededDbRecords);
      mockPrismaClient.$executeRaw.mockResolvedValue(2);
      mockPrismaClient.invitationCode.createMany.mockResolvedValue({ count: 1 });

      const result = await service.importBatch(
        [
          { guestName: 'Jane Doe', code: '', email: 'jane@example.com', city: 'Boston' },
          { guestName: 'Clara Oswald', code: '', dietaryNotes: 'Vegan' },
          { guestName: 'John Smith', code: '' }, // ambiguous -> creates new code rather than overwriting
        ],
        'update',
        'Admin'
      );

      expect(mockPrismaClient.invitationCode.findMany).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        success: true,
        count: 3,
        imported: 1,
        skipped: 0,
        updated: 2,
      });
      expect(mockPrismaClient.$executeRaw).toHaveBeenCalledTimes(1);
      expect(mockPrismaClient.invitationCode.createMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaClient.invitationCode.createMany.mock.calls[0][0].data).toHaveLength(1);
      expect(mockPrismaClient.invitationCode.createMany.mock.calls[0][0].data[0].guestName).toBe(
        'John Smith'
      );
    });
  });

  describe('mergeDuplicates', () => {
    it('validates primaryId and secondaryIds before querying', async () => {
      await expect(service.mergeDuplicates('', ['sec-1'])).rejects.toThrow(
        'Validation Error: Primary guest ID is required.'
      );
      await expect(service.mergeDuplicates('pri-1', [])).rejects.toThrow(
        'Validation Error: At least one secondary guest ID is required.'
      );
      await expect(service.mergeDuplicates('pri-1', ['pri-1'])).rejects.toThrow(
        'Validation Error: At least one distinct secondary guest ID is required to merge.'
      );
    });

    it('rejects when one or more invitation codes do not exist', async () => {
      mockPrismaClient.$transaction = jest.fn((cb: any) => cb(mockPrismaClient));
      mockPrismaClient.invitationCode.findMany.mockResolvedValue([
        { id: 'pri-1', code: 'PRI1', guestName: 'Alice' },
      ]);

      await expect(service.mergeDuplicates('pri-1', ['missing-2'])).rejects.toThrow(
        'Validation Error: Secondary guest record "missing-2" not found.'
      );
    });

    it('rewrites secondary guest IDs inside PENDING/SCHEDULED BroadcastMessage targetFilters.selectedIds', async () => {
      const broadcastUpdateMock = jest.fn().mockResolvedValue({});
      const txMock = {
        ...mockPrismaClient,
        contributor: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        subEventAccess: {
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn(),
          updateMany: jest.fn(),
        },
        subEventRsvp: {
          findMany: jest.fn().mockResolvedValue([]),
          update: jest.fn(),
          deleteMany: jest.fn(),
        },
        broadcastRecipient: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        broadcastMessage: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'bm-1',
              targetFilters: { selectedIds: ['sec-1', 'pri-1', 'other-9'], partyGroup: 'Bride' },
            },
          ]),
          update: broadcastUpdateMock,
        },
        invitationCode: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'pri-1', code: 'PRI1', guestName: 'Alice', partyTags: [] },
            { id: 'sec-1', code: 'SEC1', guestName: 'Alice S', partyTags: [] },
          ]),
          update: jest.fn().mockResolvedValue({ id: 'pri-1', code: 'PRI1', guestName: 'Alice' }),
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        snapshotVersion: { create: jest.fn().mockResolvedValue({}) },
      };
      mockPrismaClient.$transaction = jest.fn((cb: any) => cb(txMock));

      await service.mergeDuplicates('pri-1', ['sec-1'], 'Admin');

      expect(broadcastUpdateMock).toHaveBeenCalledWith({
        where: { id: 'bm-1' },
        data: {
          targetFilters: {
            selectedIds: ['pri-1', 'other-9'],
            partyGroup: 'Bride',
          },
        },
      });
    });
  });
});
