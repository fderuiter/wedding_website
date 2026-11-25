import {
  INVITATION_CODE_MIN_LENGTH,
  INVITATION_CODE_MAX_LENGTH,
  GUEST_NAME_MAX_LENGTH,
  ADDRESS_LINE_MAX_LENGTH,
  CITY_MAX_LENGTH,
  STATE_MAX_LENGTH,
  ZIP_CODE_MAX_LENGTH,
  COUNTRY_MAX_LENGTH,
  PLUS_ONE_NAME_MAX_LENGTH,
  HOUSEHOLD_NAME_MAX_LENGTH,
  PARTY_GROUP_MAX_LENGTH,
  BatchInvitationCodeRecord,
  normalizeNullableString,
  normalizeInvitationCode,
  validateCustomInvitationCode,
  normalizePartyTags,
  normalizePartialInvitationFields,
  normalizeBatchInvitationRecord,
  validateInvitationGuestFields,
  resolveBatchGuestMatches,
  mergeDietaryNotes,
  computeMergedInvitationPreview,
} from '../invitationValidation';
import { validateSingleCsvRow } from '../csv';
import {
  InvitationCodeAdminService,
  InvitationCodeSchema,
  BatchImportInvitationCodesSchema,
  DryRunValidateBatchSchema,
  MergeInvitationCodesSchema,
  GuestAddressUpdateSchema,
  PublicAddressCollectSchema,
} from '@/features/registry';

describe('invitationValidation shared helpers', () => {
  describe('exported length constants & Zod schema boundaries', () => {
    it('exports canonical field length constants and enforces custom invitation code entropy rules', () => {
      expect(INVITATION_CODE_MIN_LENGTH).toBe(8);
      expect(INVITATION_CODE_MAX_LENGTH).toBe(50);
      expect(GUEST_NAME_MAX_LENGTH).toBe(100);
      expect(ADDRESS_LINE_MAX_LENGTH).toBe(150);
      expect(CITY_MAX_LENGTH).toBe(100);
      expect(STATE_MAX_LENGTH).toBe(100);
      expect(ZIP_CODE_MAX_LENGTH).toBe(20);
      expect(COUNTRY_MAX_LENGTH).toBe(100);
      expect(PLUS_ONE_NAME_MAX_LENGTH).toBe(100);
      expect(HOUSEHOLD_NAME_MAX_LENGTH).toBe(100);
      expect(PARTY_GROUP_MAX_LENGTH).toBe(100);

      const prevPasscode = process.env.GUEST_PASSCODE;
      process.env.GUEST_PASSCODE = 'Wedding2026';
      try {
        expect(validateCustomInvitationCode('SHORT12')).toContain('at least 8 characters');
        expect(validateCustomInvitationCode('X'.repeat(51))).toContain('under 50 characters');
        expect(validateCustomInvitationCode('CODE 1234')).toContain('cannot contain spaces');
        expect(validateCustomInvitationCode('CODE\t1234')).toContain('cannot contain spaces');
        expect(validateCustomInvitationCode('AAAAAAAA')).toContain('at least 4 distinct characters');
        expect(validateCustomInvitationCode('ABABABAB')).toContain('at least 4 distinct characters');
        expect(validateCustomInvitationCode('ABCABCAB')).toContain('at least 4 distinct characters');
        expect(validateCustomInvitationCode('wedding2026')).toContain('shared event passcode');
        expect(validateCustomInvitationCode('WEDDING2026')).toContain('shared event passcode');
        expect(validateCustomInvitationCode('SMITH2026')).toBeNull();
        expect(validateCustomInvitationCode('  valid123  ')).toBeNull();
      } finally {
        if (prevPasscode === undefined) {
          delete process.env.GUEST_PASSCODE;
        } else {
          process.env.GUEST_PASSCODE = prevPasscode;
        }
      }
    });

    it('retains max(100) guestName rule in HTTP Zod schemas while imperative validators allow >100-char non-empty guestName', async () => {
      const longGuestName = 'G'.repeat(GUEST_NAME_MAX_LENGTH + 1);

      const singleSchemaResult = InvitationCodeSchema.safeParse({
        id: 'inv-1',
        code: 'VALID123',
        guestName: longGuestName,
      });
      expect(singleSchemaResult.success).toBe(false);
      if (!singleSchemaResult.success) {
        expect(singleSchemaResult.error.issues[0].message).toBe(
          'Guest name is required and must be under 100 characters.'
        );
      }

      const batchSchemaResult = BatchImportInvitationCodesSchema.safeParse({
        records: [{ guestName: longGuestName, code: 'VALID123' }],
      });
      expect(batchSchemaResult.success).toBe(false);
      if (!batchSchemaResult.success) {
        expect(batchSchemaResult.error.issues[0].message).toBe(
          'Guest name must be under 100 characters.'
        );
      }

      const dryRunSchemaResult = DryRunValidateBatchSchema.safeParse({
        records: [{ guestName: longGuestName, code: 'VALID123' }],
      });
      expect(dryRunSchemaResult.success).toBe(false);

      // Imperative callers must NOT reject >100-char non-empty guestName
      expect(validateInvitationGuestFields({ guestName: longGuestName }, { mode: 'row' })).toEqual([]);
      expect(validateInvitationGuestFields({ guestName: longGuestName }, { mode: 'service' })).toEqual([]);
      expect(
        validateInvitationGuestFields({ guestName: longGuestName }, { mode: 'batch', rowNumber: 1 })
      ).toEqual([]);

      const csvResult = validateSingleCsvRow(
        { 'Guest Name': longGuestName, Code: 'VALID123' },
        0,
        { guestNameCol: 'Guest Name', codeCol: 'Code' },
        new Map([['VALID123', 1]]),
        new Set()
      );
      expect(csvResult.isValid).toBe(true);
      expect(csvResult.errors).toEqual([]);
    });

    it('enforces shared length constants and native Zod v4 email pipes consistently across all guest schemas', () => {
      const overMaxAddress = 'A'.repeat(ADDRESS_LINE_MAX_LENGTH + 1);
      const overMaxZip = '9'.repeat(ZIP_CODE_MAX_LENGTH + 1);

      expect(
        GuestAddressUpdateSchema.safeParse({ addressLine1: overMaxAddress }).success
      ).toBe(false);
      expect(GuestAddressUpdateSchema.safeParse({ zipCode: overMaxZip }).success).toBe(false);
      expect(
        PublicAddressCollectSchema.safeParse({
          guestName: 'Valid Guest',
          addressLine1: overMaxAddress,
        }).success
      ).toBe(false);

      const batchWithTagsAndWhitespaceEmail = BatchImportInvitationCodesSchema.safeParse({
        records: [
          {
            guestName: '  Jane Guest  ',
            email: '  jane@example.com  ',
            partyTags: ' VIP , Family , ',
          },
        ],
      });
      expect(batchWithTagsAndWhitespaceEmail.success).toBe(true);
      if (batchWithTagsAndWhitespaceEmail.success) {
        expect(batchWithTagsAndWhitespaceEmail.data.records[0].guestName).toBe('Jane Guest');
        expect(batchWithTagsAndWhitespaceEmail.data.records[0].email).toBe('jane@example.com');
        expect(batchWithTagsAndWhitespaceEmail.data.records[0].partyTags).toEqual([
          'VIP',
          'Family',
        ]);
      }
    });
  });

  describe('normalizers', () => {
    it('normalizes nullable strings by trimming or returning null', () => {
      expect(normalizeNullableString('  Jane Doe  ')).toBe('Jane Doe');
      expect(normalizeNullableString('   ')).toBeNull();
      expect(normalizeNullableString('')).toBeNull();
      expect(normalizeNullableString(null)).toBeNull();
      expect(normalizeNullableString(undefined)).toBeNull();
      expect(normalizeNullableString(42)).toBeNull();
    });

    it('normalizes invitation codes to trimmed uppercase strings', () => {
      expect(normalizeInvitationCode('  wed2026  ')).toBe('WED2026');
      expect(normalizeInvitationCode('   ')).toBe('');
      expect(normalizeInvitationCode(undefined)).toBe('');
      expect(normalizeInvitationCode(null)).toBe('');
    });

    it('normalizes partyTags from arrays and comma-delimited strings with optional deduplication', () => {
      expect(normalizePartyTags([' VIP ', '', 'Family', 'VIP'])).toEqual(['VIP', 'Family', 'VIP']);
      expect(normalizePartyTags(' VIP, Family , VIP ', { dedupe: false })).toEqual([
        'VIP',
        'Family',
        'VIP',
      ]);
      expect(normalizePartyTags(' VIP, Family , VIP ', { dedupe: true })).toEqual(['VIP', 'Family']);
      expect(normalizePartyTags(null)).toEqual([]);
      expect(normalizePartyTags(undefined)).toEqual([]);
    });

    it('allocates zero Set instances when partyTags is empty or whitespace', () => {
      const OriginalSet = global.Set;
      let setAllocations = 0;
      const SetSpy = jest.fn().mockImplementation(function (
        this: unknown,
        iterable?: Iterable<unknown>
      ) {
        setAllocations++;
        return new OriginalSet(iterable);
      });
      (global as unknown as { Set: typeof Set }).Set = SetSpy as unknown as typeof Set;

      try {
        expect(normalizePartyTags('', { dedupe: true })).toEqual([]);
        expect(normalizePartyTags('   ', { dedupe: true })).toEqual([]);
        expect(normalizePartyTags(' , , ', { dedupe: true })).toEqual([]);
        expect(normalizePartyTags(null, { dedupe: true })).toEqual([]);
        expect(setAllocations).toBe(0);
      } finally {
        global.Set = OriginalSet;
      }
    });

    it('normalizes full BatchInvitationCodeRecord consistently', () => {
      const input: BatchInvitationCodeRecord = {
        guestName: '  Alice Smith  ',
        code: '  alice100 ',
        email: '  alice@example.com ',
        addressLine1: '  123 Main St ',
        addressLine2: '   ',
        city: ' Boston ',
        state: ' MA ',
        zipCode: ' 02101 ',
        country: ' USA ',
        dietaryNotes: '  Vegan ',
        plusOneAllocations: 1,
        plusOneFirstName: ' Bob ',
        plusOneLastName: '',
        householdName: ' Smith Household ',
        partyGroup: ' Bride ',
        partyTags: 'VIP, College ',
        extraFields: { table: '1' },
      };

      expect(normalizeBatchInvitationRecord(input)).toEqual({
        guestName: 'Alice Smith',
        code: 'ALICE100',
        email: 'alice@example.com',
        addressLine1: '123 Main St',
        addressLine2: null,
        city: 'Boston',
        state: 'MA',
        zipCode: '02101',
        country: 'USA',
        dietaryNotes: 'Vegan',
        plusOneAllocations: 1,
        plusOneFirstName: 'Bob',
        plusOneLastName: null,
        householdName: 'Smith Household',
        partyGroup: 'Bride',
        partyTags: ['VIP', 'College'],
        extraFields: { table: '1' },
      });
    });
  });

  describe('functional equivalence across all four refactored validators', () => {
    let service: InvitationCodeAdminService;
    let mockPrismaClient: {
      $executeRaw: jest.Mock;
      invitationCode: {
        findUnique: jest.Mock;
        findMany: jest.Mock;
        createMany: jest.Mock;
      };
      snapshotVersion: {
        create: jest.Mock;
        findMany: jest.Mock;
        deleteMany: jest.Mock;
      };
    };
    const invokeProtectedValidate = (svc: InvitationCodeAdminService, payload: unknown) =>
      (svc as unknown as { validate: (_d: unknown) => Promise<void> }).validate(payload);

    beforeEach(() => {
      mockPrismaClient = {
        $executeRaw: jest.fn().mockResolvedValue(0),
        invitationCode: {
          findUnique: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        snapshotVersion: {
          create: jest.fn().mockResolvedValue({ id: 'snap-1' }),
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      service = new InvitationCodeAdminService();
      service.repo.client = mockPrismaClient;
    });

    const invalidCases: Array<{
      description: string;
      record: BatchInvitationCodeRecord;
      csvRow: Record<string, string>;
      expectedRowError: string;
      expectedServiceError: string;
      expectedBatchRow2Error: string;
    }> = [
      {
        description: 'empty guestName',
        record: { guestName: '   ', code: 'CODE1234' },
        csvRow: { guestName: '   ', code: 'CODE1234' },
        expectedRowError: 'Guest name is required.',
        expectedServiceError: 'Validation Error: Guest name is required.',
        expectedBatchRow2Error: 'Validation Error: Row 2 has an empty guest name.',
      },
      {
        description: 'custom code shorter than 8 characters',
        record: { guestName: 'Jane', code: 'SHORT12' },
        csvRow: { guestName: 'Jane', code: 'SHORT12' },
        expectedRowError: 'Invitation code must be at least 8 characters.',
        expectedServiceError: 'Validation Error: Invitation code must be at least 8 characters.',
        expectedBatchRow2Error: 'Validation Error: Row 2 Invitation code must be at least 8 characters.',
      },
      {
        description: 'custom code with fewer than 4 distinct characters',
        record: { guestName: 'Jane', code: 'AAAAAAAA' },
        csvRow: { guestName: 'Jane', code: 'AAAAAAAA' },
        expectedRowError: 'Invitation code must include at least 4 distinct characters.',
        expectedServiceError: 'Validation Error: Invitation code must include at least 4 distinct characters.',
        expectedBatchRow2Error: 'Validation Error: Row 2 Invitation code must include at least 4 distinct characters.',
      },
      {
        description: 'invalid email',
        record: { guestName: 'Jane', code: 'CODE1234', email: 'not-an-email' },
        csvRow: { guestName: 'Jane', code: 'CODE1234', email: 'not-an-email' },
        expectedRowError: 'Invalid email format.',
        expectedServiceError: 'Validation Error: Invalid email format.',
        expectedBatchRow2Error: 'Validation Error: Row 2 has an invalid email format.',
      },
      {
        description: 'invalid plusOneAllocations',
        record: { guestName: 'Jane', code: 'CODE1234', plusOneAllocations: -1 },
        csvRow: { guestName: 'Jane', code: 'CODE1234', plusOneAllocations: '-1' },
        expectedRowError: 'Plus-one allocation must be a non-negative integer.',
        expectedServiceError: 'Validation Error: Plus-one allocation must be a non-negative integer.',
        expectedBatchRow2Error: 'Validation Error: Row 2 has an invalid plus-one count.',
      },
      {
        description: 'addressLine1 over 150 chars',
        record: { guestName: 'Jane', code: 'CODE1234', addressLine1: 'A'.repeat(151) },
        csvRow: { guestName: 'Jane', code: 'CODE1234', addressLine1: 'A'.repeat(151) },
        expectedRowError: 'Address Line 1 must be under 150 characters.',
        expectedServiceError: 'Validation Error: Address Line 1 must be under 150 characters.',
        expectedBatchRow2Error: 'Validation Error: Row 2 Address Line 1 must be under 150 characters.',
      },
      {
        description: 'addressLine2 over 150 chars',
        record: { guestName: 'Jane', code: 'CODE1234', addressLine2: 'A'.repeat(151) },
        csvRow: { guestName: 'Jane', code: 'CODE1234', addressLine2: 'A'.repeat(151) },
        expectedRowError: 'Address Line 2 must be under 150 characters.',
        expectedServiceError: 'Validation Error: Address Line 2 must be under 150 characters.',
        expectedBatchRow2Error: 'Validation Error: Row 2 Address Line 2 must be under 150 characters.',
      },
      {
        description: 'city over 100 chars',
        record: { guestName: 'Jane', code: 'CODE1234', city: 'C'.repeat(101) },
        csvRow: { guestName: 'Jane', code: 'CODE1234', city: 'C'.repeat(101) },
        expectedRowError: 'City must be under 100 characters.',
        expectedServiceError: 'Validation Error: City must be under 100 characters.',
        expectedBatchRow2Error: 'Validation Error: Row 2 City must be under 100 characters.',
      },
      {
        description: 'state over 100 chars',
        record: { guestName: 'Jane', code: 'CODE1234', state: 'S'.repeat(101) },
        csvRow: { guestName: 'Jane', code: 'CODE1234', state: 'S'.repeat(101) },
        expectedRowError: 'State must be under 100 characters.',
        expectedServiceError: 'Validation Error: State must be under 100 characters.',
        expectedBatchRow2Error: 'Validation Error: Row 2 State must be under 100 characters.',
      },
      {
        description: 'zipCode over 20 chars',
        record: { guestName: 'Jane', code: 'CODE1234', zipCode: '9'.repeat(21) },
        csvRow: { guestName: 'Jane', code: 'CODE1234', zipCode: '9'.repeat(21) },
        expectedRowError: 'Zip Code must be under 20 characters.',
        expectedServiceError: 'Validation Error: Zip Code must be under 20 characters.',
        expectedBatchRow2Error: 'Validation Error: Row 2 Zip Code must be under 20 characters.',
      },
      {
        description: 'country over 100 chars',
        record: { guestName: 'Jane', code: 'CODE1234', country: 'U'.repeat(101) },
        csvRow: { guestName: 'Jane', code: 'CODE1234', country: 'U'.repeat(101) },
        expectedRowError: 'Country must be under 100 characters.',
        expectedServiceError: 'Validation Error: Country must be under 100 characters.',
        expectedBatchRow2Error: 'Validation Error: Row 2 Country must be under 100 characters.',
      },
      {
        description: 'plusOneFirstName over 100 chars',
        record: { guestName: 'Jane', code: 'CODE1234', plusOneFirstName: 'P'.repeat(101) },
        csvRow: { guestName: 'Jane', code: 'CODE1234', plusOneFirstName: 'P'.repeat(101) },
        expectedRowError: 'Plus-one first name must be under 100 characters.',
        expectedServiceError: 'Validation Error: Plus-one first name must be under 100 characters.',
        expectedBatchRow2Error: 'Validation Error: Row 2 has an invalid plus-one first name.',
      },
      {
        description: 'plusOneLastName over 100 chars',
        record: { guestName: 'Jane', code: 'CODE1234', plusOneLastName: 'L'.repeat(101) },
        csvRow: { guestName: 'Jane', code: 'CODE1234', plusOneLastName: 'L'.repeat(101) },
        expectedRowError: 'Plus-one last name must be under 100 characters.',
        expectedServiceError: 'Validation Error: Plus-one last name must be under 100 characters.',
        expectedBatchRow2Error: 'Validation Error: Row 2 has an invalid plus-one last name.',
      },
      {
        description: 'householdName over 100 chars',
        record: { guestName: 'Jane', code: 'CODE1234', householdName: 'H'.repeat(101) },
        csvRow: { guestName: 'Jane', code: 'CODE1234', householdName: 'H'.repeat(101) },
        expectedRowError: 'Household name must be under 100 characters.',
        expectedServiceError: 'Validation Error: Household name must be under 100 characters.',
        expectedBatchRow2Error: 'Validation Error: Row 2 Household name must be under 100 characters.',
      },
      {
        description: 'partyGroup over 100 chars',
        record: { guestName: 'Jane', code: 'CODE1234', partyGroup: 'G'.repeat(101) },
        csvRow: { guestName: 'Jane', code: 'CODE1234', partyGroup: 'G'.repeat(101) },
        expectedRowError: 'Party group must be under 100 characters.',
        expectedServiceError: 'Validation Error: Party group must be under 100 characters.',
        expectedBatchRow2Error: 'Validation Error: Row 2 Party group must be under 100 characters.',
      },
    ];

    it.each(invalidCases)(
      'produces exact expected errors across validate, importBatch, dryRunValidateBatch, and validateSingleCsvRow for $description',
      async ({
        record,
        csvRow,
        expectedRowError,
        expectedServiceError,
        expectedBatchRow2Error,
      }) => {
        // 1. InvitationCodeAdminService.validate
        await expect(invokeProtectedValidate(service, record)).rejects.toThrow(expectedServiceError);

        // 2. InvitationCodeAdminService.importBatch (tested at row 2 to verify 1-based row indexing)
        const validRow: BatchInvitationCodeRecord = { guestName: 'Valid First Row', code: 'FIRST123' };
        await expect(service.importBatch([validRow, record], 'skip')).rejects.toThrow(
          expectedBatchRow2Error
        );

        // 3. InvitationCodeAdminService.dryRunValidateBatch
        const dryRun = await service.dryRunValidateBatch([record], 'skip');
        expect(dryRun.rows[0].isValid).toBe(false);
        expect(dryRun.rows[0].errors).toEqual([expectedRowError]);

        // 4. validateSingleCsvRow
        const rowCode = (csvRow.code || 'CODE1234').trim().toUpperCase();
        const csvValidated = validateSingleCsvRow(
          csvRow,
          0,
          { guestNameCol: 'guestName', codeCol: 'code' },
          new Map([[rowCode, 1]]),
          new Set()
        );
        expect(csvValidated.isValid).toBe(false);
        expect(csvValidated.errors).toEqual([expectedRowError]);
      }
    );

    it('enforces service-only non-empty code and array partyTags checks in validate', async () => {
      await expect(
        invokeProtectedValidate(service, { guestName: 'Jane', code: '   ' })
      ).rejects.toThrow('Validation Error: Code cannot be empty.');

      await expect(
        invokeProtectedValidate(service, { guestName: 'Jane', code: 'JANE1234', partyTags: 'VIP' })
      ).rejects.toThrow('Validation Error: Party tags must be an array of strings.');
    });

    it('merges partial updateData across multiple batch rows targeting the same existing DB code', async () => {
      mockPrismaClient.invitationCode.findMany.mockResolvedValue([
        { id: 'db-1', code: 'SHARED12', guestName: 'Original Guest' },
      ]);
      mockPrismaClient.$executeRaw.mockResolvedValue(1);

      const result = await service.importBatch(
        [
          { guestName: 'First Update', code: 'SHARED12', city: 'Boston' },
          { guestName: 'Second Update', code: 'SHARED12', state: 'MA' },
        ],
        'update'
      );

      expect(result.updated).toBe(2);
      expect(mockPrismaClient.$executeRaw).toHaveBeenCalledTimes(1);
      const rawQuery = mockPrismaClient.$executeRaw.mock.calls[0][0];
      expect(rawQuery.values).toContain('Second Update');
      expect(rawQuery.values).toContain('Boston');
      expect(rawQuery.values).toContain('MA');
    });

    it('supports partial validation and partial field normalization without touching omitted fields', () => {
      expect(
        validateInvitationGuestFields({ used: true, city: 'Seattle' }, { mode: 'service', partial: true })
      ).toEqual([]);

      expect(
        validateInvitationGuestFields({ guestName: '   ' }, { mode: 'service', partial: true })
      ).toEqual(['Validation Error: Guest name is required.']);

      expect(
        validateInvitationGuestFields({ code: null }, { mode: 'service', partial: true })
      ).toEqual(['Validation Error: Code cannot be empty.']);

      expect(
        normalizePartialInvitationFields({
          guestName: '  Alice Smith  ',
          email: '   ',
          city: ' Seattle ',
          partyTags: [' VIP ', ''],
        })
      ).toEqual({
        guestName: 'Alice Smith',
        email: null,
        city: 'Seattle',
        partyTags: ['VIP'],
      });
    });
  });

  describe('composite blank-code guest matching & duplicate merge helpers', () => {
    it('resolves blank-code rows by precedence: email, guestName + householdName, unique guestName, and warns on ambiguous names', () => {
      const existingRecords = [
        {
          id: 'g-email',
          code: 'EMAIL001',
          guestName: 'Alicia Keys',
          email: 'alicia@example.com',
          householdName: 'Keys Family',
        },
        {
          id: 'g-hh-1',
          code: 'SMITH001',
          guestName: 'John Smith',
          email: null,
          householdName: 'Smith-North',
        },
        {
          id: 'g-hh-2',
          code: 'SMITH002',
          guestName: 'John Smith',
          email: null,
          householdName: 'Smith-South',
        },
        {
          id: 'g-unique',
          code: 'UNIQ0001',
          guestName: 'Unique Person',
          email: null,
          householdName: null,
        },
      ];

      const { matches } = resolveBatchGuestMatches(
        [
          { guestName: 'Alicia Renamed', email: '  ALICIA@example.com  ', code: '' },
          { guestName: '  john   smith ', householdName: ' smith-south ', code: '' },
          { guestName: '  Unique   Person ', code: '' },
          { guestName: 'John Smith', code: '' }, // ambiguous across 2 John Smiths
          { guestName: 'Brand New Guest', code: '' },
        ].map(normalizeBatchInvitationRecord),
        existingRecords
      );

      expect(matches[0]).toEqual({
        matchedBy: 'email',
        matchedRecord: existingRecords[0],
        ambiguityWarning: null,
      });
      expect(matches[1]).toEqual({
        matchedBy: 'name_household',
        matchedRecord: existingRecords[2],
        ambiguityWarning: null,
      });
      expect(matches[2]).toEqual({
        matchedBy: 'unique_name',
        matchedRecord: existingRecords[3],
        ambiguityWarning: null,
      });
      expect(matches[3].matchedBy).toBeNull();
      expect(matches[3].matchedRecord).toBeNull();
      expect(matches[3].ambiguityWarning).toContain('Multiple existing guests named "John Smith"');

      expect(matches[4]).toEqual({
        matchedRecord: null,
        matchedBy: null,
        ambiguityWarning: null,
      });
    });

    it('merges dietary notes and computes combined invitation preview correctly', () => {
      expect(mergeDietaryNotes(['Vegan; Nut Allergy', 'vegan; Gluten-Free', null, ''])).toBe(
        'Vegan; Nut Allergy; Gluten-Free'
      );

      const preview = computeMergedInvitationPreview(
        {
          id: 'pri-1',
          guestName: 'Alice Smith',
          code: 'ALICE100',
          email: null,
          householdName: null,
          partyGroup: 'Bride',
          partyTags: ['VIP'],
          dietaryNotes: 'Vegan',
          plusOneAllocations: 0,
          plusOneFirstName: null,
          plusOneLastName: null,
          addressLine1: null,
          city: null,
          used: false,
          tableId: null,
          seatNumber: null,
          extraFields: { meal: 'tofu', attendanceStatus: 'pending' },
        },
        [
          {
            id: 'sec-1',
            guestName: 'Alice S.',
            code: 'ALICE200',
            email: 'alice@example.com',
            householdName: 'Smith Household',
            partyGroup: 'Groom',
            partyTags: ['VIP', 'Rehearsal'],
            dietaryNotes: 'Vegan; Gluten-Free',
            plusOneAllocations: 1,
            plusOneFirstName: 'Bob',
            plusOneLastName: 'Smith',
            addressLine1: '123 Maple Ave',
            city: 'Boston',
            used: true,
            usedAt: '2026-06-01T12:00:00.000Z',
            tableId: 'tbl-1',
            seatNumber: 3,
            extraFields: { phone: '+15551112222', meal: 'chicken', attendanceStatus: 'attending' },
          },
        ]
      );

      expect(preview).toMatchObject({
        code: 'ALICE100',
        guestName: 'Alice Smith',
        email: 'alice@example.com',
        householdName: 'Smith Household',
        partyGroup: 'Bride',
        partyTags: ['VIP', 'Rehearsal'],
        dietaryNotes: 'Vegan; Gluten-Free',
        plusOneAllocations: 1,
        plusOneFirstName: 'Bob',
        plusOneLastName: 'Smith',
        addressLine1: '123 Maple Ave',
        city: 'Boston',
        used: true,
        tableId: 'tbl-1',
        seatNumber: 3,
        extraFields: { phone: '+15551112222', meal: 'tofu', attendanceStatus: 'attending' },
      });
    });

    it('disambiguates invited guests from public address-collection entries and preserves #1112 seating eligibility on merge', () => {
      const dbWithPublicSubmission = [
        {
          id: 'inv-real',
          code: 'JORD2026',
          guestName: 'Jordan Lee',
          email: 'jordan@example.com',
          householdName: 'Lee Household',
          partyTags: ['Bride Side'],
        },
        {
          id: 'inv-collect',
          code: 'COLL9999',
          guestName: 'Jordan Lee',
          email: 'jordan@example.com',
          householdName: 'Lee Household',
          partyTags: ['address-collection'],
        },
      ];

      const { matches } = resolveBatchGuestMatches(
        [
          { guestName: 'Jordan Lee', email: 'jordan@example.com', code: '' },
          { guestName: 'Jordan Lee', code: '' },
        ].map(normalizeBatchInvitationRecord),
        dbWithPublicSubmission
      );

      // Row 0 matches the single invited guest by email instead of emitting ambiguity
      expect(matches[0]).toEqual({
        matchedBy: 'email',
        matchedRecord: dbWithPublicSubmission[0],
        ambiguityWarning: null,
      });
      // Row 1 sees Jordan Lee already claimed by Row 0
      expect(matches[1].matchedRecord).toBeNull();
      expect(matches[1].ambiguityWarning).toContain('already matched "Jordan Lee"');

      // Merging an address-collection submission into an invited guest strips 'address-collection'
      const mergedInvited = computeMergedInvitationPreview(
        {
          id: 'inv-real',
          code: 'JORD2026',
          guestName: 'Jordan Lee',
          partyTags: ['Bride Side'],
          tableId: 'tbl-head',
          seatNumber: 2,
        },
        [
          {
            id: 'inv-collect',
            code: 'COLL9999',
            guestName: 'Jordan Lee',
            addressLine1: '400 Ocean Dr',
            partyTags: ['address-collection'],
          },
        ]
      );
      expect(mergedInvited.partyTags).toEqual(['Bride Side']);
      expect(mergedInvited.addressLine1).toBe('400 Ocean Dr');
      expect(mergedInvited.tableId).toBe('tbl-head');
      expect(mergedInvited.seatNumber).toBe(2);

      // Merging two uninvited address-collection rows keeps 'address-collection' and clears seating
      const mergedCollectOnly = computeMergedInvitationPreview(
        {
          id: 'c-1',
          code: 'COLL0001',
          guestName: 'Taylor Swift',
          partyTags: ['address-collection'],
        },
        [
          {
            id: 'c-2',
            code: 'COLL0002',
            guestName: 'Taylor S.',
            partyTags: ['address-collection'],
            tableId: 'tbl-1',
            seatNumber: 4,
          },
        ]
      );
      expect(mergedCollectOnly.partyTags).toEqual(['address-collection']);
      expect(mergedCollectOnly.tableId).toBeNull();
      expect(mergedCollectOnly.seatNumber).toBeNull();

      // Merging a declined RSVP clears tentative table seating per #1112 seating eligibility rules
      const mergedDeclined = computeMergedInvitationPreview(
        {
          id: 'd-1',
          code: 'DECL0001',
          guestName: 'Sam Carter',
          partyTags: ['VIP'],
          tableId: 'tbl-2',
          seatNumber: 6,
          extraFields: { attendanceStatus: 'pending' },
        },
        [
          {
            id: 'd-2',
            code: 'DECL0002',
            guestName: 'Sam Carter',
            partyTags: ['VIP'],
            extraFields: { attendanceStatus: 'declined' },
          },
        ]
      );
      expect(mergedDeclined.extraFields).toEqual({ attendanceStatus: 'declined' });
      expect(mergedDeclined.tableId).toBeNull();
      expect(mergedDeclined.seatNumber).toBeNull();
    });

    it('validates MergeInvitationCodesSchema cleanly', () => {
      expect(
        MergeInvitationCodesSchema.safeParse({
          primaryId: 'inv-1',
          secondaryIds: ['inv-2', 'inv-1'],
        }).success
      ).toBe(true);

      // Rejects when secondaryIds only contains primaryId
      expect(
        MergeInvitationCodesSchema.safeParse({
          primaryId: 'inv-1',
          secondaryIds: ['inv-1'],
        }).success
      ).toBe(false);

      // Rejects empty secondaryIds
      expect(
        MergeInvitationCodesSchema.safeParse({
          primaryId: 'inv-1',
          secondaryIds: [],
        }).success
      ).toBe(false);
    });
  });
});
