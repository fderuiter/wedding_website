import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { InvitationCodeDTO, DryRunValidatedRow, DryRunValidationSummary, DryRunValidationResponse } from './schemas';
import { executeInTransaction } from '@/lib/transaction';
import { createAuditSnapshot } from '@/lib/audit';
import { Prisma } from '@prisma/client';
import { generateRandomCode } from './utils/invitation';

export class InvitationCodeAdminService extends BaseService<InvitationCodeDTO> {
  static ENTITY_KEY = 'invitation-codes';

  constructor() {
    super(new BaseRepository<InvitationCodeDTO>('invitationCode'), 'InvitationCode');
  }

  private validateFields(data: any, isPartial: boolean = false): void {
    if (!isPartial || data.guestName !== undefined) {
      if (!data.guestName || typeof data.guestName !== 'string' || data.guestName.trim() === '') {
        throw new Error('Validation Error: Guest name is required.');
      }
    }
    if (data.code !== undefined && data.code !== null && (typeof data.code !== 'string' || data.code.trim() === '')) {
      throw new Error('Validation Error: Code cannot be empty.');
    }
    if (data.email && typeof data.email === 'string' && data.email.trim() !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.email.trim())) {
        throw new Error('Validation Error: Invalid email format.');
      }
    }
    if (data.plusOneAllocations !== undefined && data.plusOneAllocations !== null) {
      if (!Number.isInteger(data.plusOneAllocations) || data.plusOneAllocations < 0) {
        throw new Error('Validation Error: Plus-one allocation must be a non-negative integer.');
      }
    }
    if (data.addressLine1 && typeof data.addressLine1 === 'string' && data.addressLine1.length > 150) {
      throw new Error('Validation Error: Address Line 1 must be under 150 characters.');
    }
    if (data.addressLine2 && typeof data.addressLine2 === 'string' && data.addressLine2.length > 150) {
      throw new Error('Validation Error: Address Line 2 must be under 150 characters.');
    }
    if (data.city && typeof data.city === 'string' && data.city.length > 100) {
      throw new Error('Validation Error: City must be under 100 characters.');
    }
    if (data.state && typeof data.state === 'string' && data.state.length > 100) {
      throw new Error('Validation Error: State must be under 100 characters.');
    }
    if (data.zipCode && typeof data.zipCode === 'string' && data.zipCode.length > 20) {
      throw new Error('Validation Error: Zip Code must be under 20 characters.');
    }
    if (data.country && typeof data.country === 'string' && data.country.length > 100) {
      throw new Error('Validation Error: Country must be under 100 characters.');
    }
    if (data.plusOneFirstName !== undefined && data.plusOneFirstName !== null) {
      if (typeof data.plusOneFirstName !== 'string' || data.plusOneFirstName.length > 100) {
        throw new Error('Validation Error: Plus-one first name must be under 100 characters.');
      }
    }
    if (data.plusOneLastName !== undefined && data.plusOneLastName !== null) {
      if (typeof data.plusOneLastName !== 'string' || data.plusOneLastName.length > 100) {
        throw new Error('Validation Error: Plus-one last name must be under 100 characters.');
      }
    }
    if (data.householdName !== undefined && data.householdName !== null) {
      if (typeof data.householdName !== 'string' || data.householdName.length > 100) {
        throw new Error('Validation Error: Household name must be under 100 characters.');
      }
    }
    if (data.partyGroup !== undefined && data.partyGroup !== null) {
      if (typeof data.partyGroup !== 'string' || data.partyGroup.length > 100) {
        throw new Error('Validation Error: Party group must be under 100 characters.');
      }
    }
    if (data.partyTags !== undefined && data.partyTags !== null) {
      if (!Array.isArray(data.partyTags)) {
        throw new Error('Validation Error: Party tags must be an array of strings.');
      }
    }
  }

  protected async validate(data: any, _client?: any): Promise<void> {
    this.validateFields(data, false);
  }

  private normalizeFields(data: any): any {
    const finalData = { ...data };

    if (typeof finalData.guestName === 'string') {
      finalData.guestName = finalData.guestName.trim();
    }

    const nullableStringFields = [
      'email',
      'addressLine1',
      'addressLine2',
      'city',
      'state',
      'zipCode',
      'country',
      'dietaryNotes',
      'plusOneFirstName',
      'plusOneLastName',
      'householdName',
      'partyGroup',
    ];

    for (const field of nullableStringFields) {
      if (finalData[field] !== undefined) {
        finalData[field] =
          typeof finalData[field] === 'string' && finalData[field].trim()
            ? finalData[field].trim()
            : null;
      }
    }

    if (finalData.partyTags !== undefined) {
      if (Array.isArray(finalData.partyTags)) {
        finalData.partyTags = finalData.partyTags.map((t: any) => String(t).trim()).filter(Boolean);
      } else {
        finalData.partyTags = [];
      }
    }

    return finalData;
  }

  protected async preSave(data: any, client?: any, _author?: string): Promise<any> {
    const finalData = this.normalizeFields(data);
    const activeClient = client || this.repo.client;

    if (!finalData.code || typeof finalData.code !== 'string' || finalData.code.trim() === '') {
      let uniqueCode = '';
      let attempts = 0;
      while (attempts < 10) {
        const potentialCode = generateRandomCode();
        const existing = await activeClient.invitationCode.findUnique({
          where: { code: potentialCode }
        });
        if (!existing) {
          uniqueCode = potentialCode;
          break;
        }
        attempts++;
      }
      if (!uniqueCode) {
        throw new Error('Failed to generate a unique invitation code.');
      }
      finalData.code = uniqueCode;
    } else {
      finalData.code = finalData.code.trim().toUpperCase();
      const existing = await activeClient.invitationCode.findUnique({
        where: { code: finalData.code }
      });
      if (existing) {
        // Handled by Prisma unique constraint or update collision check
      }
    }

    return finalData;
  }

  async update(id: string, data: any, author: string = 'Admin'): Promise<InvitationCodeDTO> {
    return this.repo.transaction(async (txRepo) => {
      this.validateFields(data, true);
      const processedData = this.normalizeFields(data);

      if (processedData.code !== undefined) {
        if (!processedData.code || typeof processedData.code !== 'string' || processedData.code.trim() === '') {
          throw new Error('Validation Error: Code cannot be empty.');
        }
        processedData.code = processedData.code.trim().toUpperCase();
        const existing = await txRepo.client.invitationCode.findUnique({
          where: { code: processedData.code },
        });
        if (existing && existing.id !== id) {
          throw new Error(`Validation Error: Invitation code "${processedData.code}" is already in use.`);
        }
      }

      const record = await txRepo.update(id, processedData);
      await this.createSnapshot(record.id, record, author, txRepo.client);
      return record;
    });
  }

  async importBatch(
    records: {
      guestName: string;
      code?: string;
      email?: string | null;
      addressLine1?: string | null;
      addressLine2?: string | null;
      city?: string | null;
      state?: string | null;
      zipCode?: string | null;
      country?: string | null;
      dietaryNotes?: string | null;
      plusOneAllocations?: number;
      plusOneFirstName?: string | null;
      plusOneLastName?: string | null;
      householdName?: string | null;
      partyGroup?: string | null;
      partyTags?: string[] | string | null;
      extraFields?: Record<string, any> | null;
    }[],
    collisionStrategy: 'skip' | 'update' | 'reject' = 'skip',
    author: string = 'Admin'
  ) {
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('Validation Error: Records array cannot be empty.');
    }

    return executeInTransaction(this.repo.client, async (tx: any) => {
      for (let i = 0; i < records.length; i++) {
        const item = records[i];
        if (!item.guestName || typeof item.guestName !== 'string' || item.guestName.trim() === '') {
          throw new Error(`Validation Error: Row ${i + 1} has an empty guest name.`);
        }
        if (item.email && typeof item.email === 'string' && item.email.trim() !== '') {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(item.email.trim())) {
            throw new Error(`Validation Error: Row ${i + 1} has an invalid email format.`);
          }
        }
        if (item.plusOneAllocations !== undefined && item.plusOneAllocations !== null) {
          if (!Number.isInteger(item.plusOneAllocations) || item.plusOneAllocations < 0) {
            throw new Error(`Validation Error: Row ${i + 1} has an invalid plus-one count.`);
          }
        }
        if (item.addressLine1 && typeof item.addressLine1 === 'string' && item.addressLine1.length > 150) {
          throw new Error('Validation Error: Row ' + (i + 1) + ' Address Line 1 must be under 150 characters.');
        }
        if (item.addressLine2 && typeof item.addressLine2 === 'string' && item.addressLine2.length > 150) {
          throw new Error('Validation Error: Row ' + (i + 1) + ' Address Line 2 must be under 150 characters.');
        }
        if (item.city && typeof item.city === 'string' && item.city.length > 100) {
          throw new Error('Validation Error: Row ' + (i + 1) + ' City must be under 100 characters.');
        }
        if (item.state && typeof item.state === 'string' && item.state.length > 100) {
          throw new Error('Validation Error: Row ' + (i + 1) + ' State must be under 100 characters.');
        }
        if (item.zipCode && typeof item.zipCode === 'string' && item.zipCode.length > 20) {
          throw new Error('Validation Error: Row ' + (i + 1) + ' Zip Code must be under 20 characters.');
        }
        if (item.country && typeof item.country === 'string' && item.country.length > 100) {
          throw new Error('Validation Error: Row ' + (i + 1) + ' Country must be under 100 characters.');
        }
        if (item.plusOneFirstName !== undefined && item.plusOneFirstName !== null) {
          if (typeof item.plusOneFirstName !== 'string' || item.plusOneFirstName.length > 100) {
            throw new Error('Validation Error: Row ' + (i + 1) + ' has an invalid plus-one first name.');
          }
        }
        if (item.plusOneLastName !== undefined && item.plusOneLastName !== null) {
          if (typeof item.plusOneLastName !== 'string' || item.plusOneLastName.length > 100) {
            throw new Error('Validation Error: Row ' + (i + 1) + ' has an invalid plus-one last name.');
          }
        }
        if (item.householdName && typeof item.householdName === 'string' && item.householdName.length > 100) {
          throw new Error('Validation Error: Row ' + (i + 1) + ' Household name must be under 100 characters.');
        }
        if (item.partyGroup && typeof item.partyGroup === 'string' && item.partyGroup.length > 100) {
          throw new Error('Validation Error: Row ' + (i + 1) + ' Party group must be under 100 characters.');
        }
      }

      const existingDbRecords = await tx.invitationCode.findMany({
        select: { id: true, code: true, guestName: true }
      });
      const dbCodeMap = new Map<string, { id: string; guestName: string }>();
      for (const rec of existingDbRecords) {
        dbCodeMap.set(rec.code.toUpperCase(), rec);
      }

      let imported = 0;
      let skipped = 0;
      let updated = 0;
      const seenBatchCodes = new Set<string>();
      const allKnownCodes = new Set<string>(dbCodeMap.keys());
      const toCreate: any[] = [];
      const toUpdate: { id: string; data: any }[] = [];

      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        const guestName = row.guestName.trim();
        let code = row.code ? row.code.trim().toUpperCase() : '';

        if (!code) {
          let newCode = '';
          let attempts = 0;
          while (attempts < 20) {
            const candidate = generateRandomCode();
            if (!allKnownCodes.has(candidate)) {
              newCode = candidate;
              break;
            }
            attempts++;
          }
          if (!newCode) {
            throw new Error('Failed to generate a unique invitation code for ' + guestName);
          }
          code = newCode;
          allKnownCodes.add(code);
        }

        const existsInDb = dbCodeMap.has(code);
        const existsInBatch = seenBatchCodes.has(code);

        if (collisionStrategy === 'reject' && (existsInDb || existsInBatch)) {
          throw new Error(`Duplicate invitation code found: ${code}`);
        }

        const rowEmail = row.email && typeof row.email === 'string' && row.email.trim() ? row.email.trim() : null;
        const rowAddressLine1 = row.addressLine1 && typeof row.addressLine1 === 'string' && row.addressLine1.trim() ? row.addressLine1.trim() : null;
        const rowAddressLine2 = row.addressLine2 && typeof row.addressLine2 === 'string' && row.addressLine2.trim() ? row.addressLine2.trim() : null;
        const rowCity = row.city && typeof row.city === 'string' && row.city.trim() ? row.city.trim() : null;
        const rowState = row.state && typeof row.state === 'string' && row.state.trim() ? row.state.trim() : null;
        const rowZipCode = row.zipCode && typeof row.zipCode === 'string' && row.zipCode.trim() ? row.zipCode.trim() : null;
        const rowCountry = row.country && typeof row.country === 'string' && row.country.trim() ? row.country.trim() : null;
        const rowDietaryNotes = row.dietaryNotes && typeof row.dietaryNotes === 'string' && row.dietaryNotes.trim() ? row.dietaryNotes.trim() : null;
        const rowPlusOne = typeof row.plusOneAllocations === 'number' ? row.plusOneAllocations : 0;
        const rowPlusOneFirstName = row.plusOneFirstName && typeof row.plusOneFirstName === 'string' && row.plusOneFirstName.trim() ? row.plusOneFirstName.trim() : null;
        const rowPlusOneLastName = row.plusOneLastName && typeof row.plusOneLastName === 'string' && row.plusOneLastName.trim() ? row.plusOneLastName.trim() : null;
        const rowHouseholdName = row.householdName && typeof row.householdName === 'string' && row.householdName.trim() ? row.householdName.trim() : null;
        const rowPartyGroup = row.partyGroup && typeof row.partyGroup === 'string' && row.partyGroup.trim() ? row.partyGroup.trim() : null;
        let rowPartyTags: string[] = [];
        if (Array.isArray(row.partyTags)) {
          rowPartyTags = row.partyTags.map((t: any) => String(t).trim()).filter(Boolean);
        } else if (typeof row.partyTags === 'string' && row.partyTags.trim()) {
          rowPartyTags = row.partyTags.split(',').map((t: string) => t.trim()).filter(Boolean);
        }
        const rowExtraFields = row.extraFields && typeof row.extraFields === 'object' && Object.keys(row.extraFields).length > 0 ? row.extraFields : null;

        if (existsInBatch) {
          if (collisionStrategy === 'skip') {
            skipped++;
            continue;
          } else if (collisionStrategy === 'update') {
            if (existsInDb) {
              const existingRecord = dbCodeMap.get(code)!;
              const updateData: any = { guestName };
              if (row.email !== undefined) updateData.email = rowEmail;
              if (row.addressLine1 !== undefined) updateData.addressLine1 = rowAddressLine1;
              if (row.addressLine2 !== undefined) updateData.addressLine2 = rowAddressLine2;
              if (row.city !== undefined) updateData.city = rowCity;
              if (row.state !== undefined) updateData.state = rowState;
              if (row.zipCode !== undefined) updateData.zipCode = rowZipCode;
              if (row.country !== undefined) updateData.country = rowCountry;
              if (row.dietaryNotes !== undefined) updateData.dietaryNotes = rowDietaryNotes;
              if (row.plusOneAllocations !== undefined) updateData.plusOneAllocations = rowPlusOne;
              if (row.plusOneFirstName !== undefined) updateData.plusOneFirstName = rowPlusOneFirstName;
              if (row.plusOneLastName !== undefined) updateData.plusOneLastName = rowPlusOneLastName;
              if (row.householdName !== undefined) updateData.householdName = rowHouseholdName;
              if (row.partyGroup !== undefined) updateData.partyGroup = rowPartyGroup;
              if (row.partyTags !== undefined) updateData.partyTags = rowPartyTags;
              if (row.extraFields !== undefined) updateData.extraFields = rowExtraFields;

              toUpdate.push({ id: existingRecord.id, data: updateData });
              updated++;
            }
            continue;
          }
        }

        seenBatchCodes.add(code);
        allKnownCodes.add(code);

        if (existsInDb) {
          if (collisionStrategy === 'skip') {
            skipped++;
          } else if (collisionStrategy === 'update') {
            const existingRecord = dbCodeMap.get(code)!;
            const updateData: any = { guestName };
            if (row.email !== undefined) updateData.email = rowEmail;
            if (row.addressLine1 !== undefined) updateData.addressLine1 = rowAddressLine1;
            if (row.addressLine2 !== undefined) updateData.addressLine2 = rowAddressLine2;
            if (row.city !== undefined) updateData.city = rowCity;
            if (row.state !== undefined) updateData.state = rowState;
            if (row.zipCode !== undefined) updateData.zipCode = rowZipCode;
            if (row.country !== undefined) updateData.country = rowCountry;
            if (row.dietaryNotes !== undefined) updateData.dietaryNotes = rowDietaryNotes;
            if (row.plusOneAllocations !== undefined) updateData.plusOneAllocations = rowPlusOne;
            if (row.plusOneFirstName !== undefined) updateData.plusOneFirstName = rowPlusOneFirstName;
            if (row.plusOneLastName !== undefined) updateData.plusOneLastName = rowPlusOneLastName;
            if (row.householdName !== undefined) updateData.householdName = rowHouseholdName;
            if (row.partyGroup !== undefined) updateData.partyGroup = rowPartyGroup;
            if (row.partyTags !== undefined) updateData.partyTags = rowPartyTags;
            if (row.extraFields !== undefined) updateData.extraFields = rowExtraFields;

            toUpdate.push({ id: existingRecord.id, data: updateData });
            updated++;
          }
        } else {
          toCreate.push({
            guestName,
            code,
            email: rowEmail,
            addressLine1: rowAddressLine1,
            addressLine2: rowAddressLine2,
            city: rowCity,
            state: rowState,
            zipCode: rowZipCode,
            country: rowCountry,
            dietaryNotes: rowDietaryNotes,
            plusOneAllocations: rowPlusOne,
            plusOneFirstName: rowPlusOneFirstName,
            plusOneLastName: rowPlusOneLastName,
            householdName: rowHouseholdName,
            partyGroup: rowPartyGroup,
            partyTags: rowPartyTags,
            extraFields: rowExtraFields ?? undefined,
            used: false
          });
          imported++;
        }
      }

      if (toCreate.length > 0) {
        await tx.invitationCode.createMany({
          data: toCreate
        });
      }

      if (toUpdate.length > 0) {
        // Consolidate updates by record ID in case multiple rows target the same invitation code
        const updatesById = new Map<string, any>();
        for (const item of toUpdate) {
          const existing = updatesById.get(item.id);
          if (existing) {
            Object.assign(existing, item.data);
          } else {
            updatesById.set(item.id, { ...item.data });
          }
        }

        const rows = Array.from(updatesById.entries()).map(([id, d]) => {
          return Prisma.sql`(
            ${id}::text,
            ${d.guestName}::text,
            ${'email' in d ? d.email : null}::text,
            ${'email' in d}::boolean,
            ${'addressLine1' in d ? d.addressLine1 : null}::text,
            ${'addressLine1' in d}::boolean,
            ${'addressLine2' in d ? d.addressLine2 : null}::text,
            ${'addressLine2' in d}::boolean,
            ${'city' in d ? d.city : null}::text,
            ${'city' in d}::boolean,
            ${'state' in d ? d.state : null}::text,
            ${'state' in d}::boolean,
            ${'zipCode' in d ? d.zipCode : null}::text,
            ${'zipCode' in d}::boolean,
            ${'country' in d ? d.country : null}::text,
            ${'country' in d}::boolean,
            ${'dietaryNotes' in d ? d.dietaryNotes : null}::text,
            ${'dietaryNotes' in d}::boolean,
            ${'plusOneAllocations' in d ? d.plusOneAllocations : null}::integer,
            ${'plusOneAllocations' in d}::boolean,
            ${'plusOneFirstName' in d ? d.plusOneFirstName : null}::text,
            ${'plusOneFirstName' in d}::boolean,
            ${'plusOneLastName' in d ? d.plusOneLastName : null}::text,
            ${'plusOneLastName' in d}::boolean,
            ${'householdName' in d ? d.householdName : null}::text,
            ${'householdName' in d}::boolean,
            ${'partyGroup' in d ? d.partyGroup : null}::text,
            ${'partyGroup' in d}::boolean,
            ${'partyTags' in d ? d.partyTags : null}::text[],
            ${'partyTags' in d}::boolean,
            ${'extraFields' in d && d.extraFields !== null && d.extraFields !== undefined ? JSON.stringify(d.extraFields) : null}::jsonb,
            ${'extraFields' in d}::boolean
          )`;
        });

        const values = Prisma.join(rows, ', ');

        const bulkUpdateQuery = Prisma.sql`
          UPDATE "InvitationCode" AS t
          SET
            "guestName" = COALESCE(v."guestName", t."guestName"),
            "email" = CASE WHEN v."has_email" THEN v."email" ELSE t."email" END,
            "addressLine1" = CASE WHEN v."has_addressLine1" THEN v."addressLine1" ELSE t."addressLine1" END,
            "addressLine2" = CASE WHEN v."has_addressLine2" THEN v."addressLine2" ELSE t."addressLine2" END,
            "city" = CASE WHEN v."has_city" THEN v."city" ELSE t."city" END,
            "state" = CASE WHEN v."has_state" THEN v."state" ELSE t."state" END,
            "zipCode" = CASE WHEN v."has_zipCode" THEN v."zipCode" ELSE t."zipCode" END,
            "country" = CASE WHEN v."has_country" THEN v."country" ELSE t."country" END,
            "dietaryNotes" = CASE WHEN v."has_dietaryNotes" THEN v."dietaryNotes" ELSE t."dietaryNotes" END,
            "plusOneAllocations" = CASE WHEN v."has_plusOneAllocations" THEN v."plusOneAllocations" ELSE t."plusOneAllocations" END,
            "plusOneFirstName" = CASE WHEN v."has_plusOneFirstName" THEN v."plusOneFirstName" ELSE t."plusOneFirstName" END,
            "plusOneLastName" = CASE WHEN v."has_plusOneLastName" THEN v."plusOneLastName" ELSE t."plusOneLastName" END,
            "householdName" = CASE WHEN v."has_householdName" THEN v."householdName" ELSE t."householdName" END,
            "partyGroup" = CASE WHEN v."has_partyGroup" THEN v."partyGroup" ELSE t."partyGroup" END,
            "partyTags" = CASE WHEN v."has_partyTags" THEN v."partyTags" ELSE t."partyTags" END,
            "extraFields" = CASE WHEN v."has_extraFields" THEN v."extraFields" ELSE t."extraFields" END,
            "updatedAt" = NOW()
          FROM (VALUES ${values}) AS v(
            "id",
            "guestName",
            "email",
            "has_email",
            "addressLine1",
            "has_addressLine1",
            "addressLine2",
            "has_addressLine2",
            "city",
            "has_city",
            "state",
            "has_state",
            "zipCode",
            "has_zipCode",
            "country",
            "has_country",
            "dietaryNotes",
            "has_dietaryNotes",
            "plusOneAllocations",
            "has_plusOneAllocations",
            "plusOneFirstName",
            "has_plusOneFirstName",
            "plusOneLastName",
            "has_plusOneLastName",
            "householdName",
            "has_householdName",
            "partyGroup",
            "has_partyGroup",
            "partyTags",
            "has_partyTags",
            "extraFields",
            "has_extraFields"
          )
          WHERE t."id" = v."id"
        `;

        await tx.$executeRaw(bulkUpdateQuery);
      }

      await createAuditSnapshot(
        'InvitationCode',
        'batch_import',
        { total: records.length, imported, skipped, updated, collisionStrategy },
        author,
        tx
      );

      return {
        success: true,
        count: records.length,
        imported,
        skipped,
        updated
      };
    });
  }

  async dryRunValidateBatch(
    records: {
      guestName: string;
      code?: string;
      email?: string | null;
      addressLine1?: string | null;
      addressLine2?: string | null;
      city?: string | null;
      state?: string | null;
      zipCode?: string | null;
      country?: string | null;
      dietaryNotes?: string | null;
      plusOneAllocations?: number;
      plusOneFirstName?: string | null;
      plusOneLastName?: string | null;
      householdName?: string | null;
      partyGroup?: string | null;
      partyTags?: string[] | string | null;
      extraFields?: Record<string, any> | null;
    }[],
    collisionStrategy: 'skip' | 'update' | 'reject' = 'skip'
  ): Promise<DryRunValidationResponse> {
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('Validation Error: Records array cannot be empty.');
    }

    const existingDbRecords = await this.repo.client.invitationCode.findMany({
      select: { id: true, code: true, guestName: true },
    });

    const dbCodeMap = new Map<string, { id: string; guestName: string }>();
    for (const rec of existingDbRecords) {
      if (rec.code) {
        dbCodeMap.set(rec.code.toUpperCase(), rec);
      }
    }

    const batchCodeFreq = new Map<string, number>();
    for (const r of records) {
      if (r.code && typeof r.code === 'string' && r.code.trim()) {
        const uppercaseCode = r.code.trim().toUpperCase();
        batchCodeFreq.set(uppercaseCode, (batchCodeFreq.get(uppercaseCode) || 0) + 1);
      }
    }

    const rows: DryRunValidatedRow[] = [];
    let validCount = 0;
    let invalidCount = 0;
    let duplicateCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let createdCount = 0;

    for (let i = 0; i < records.length; i++) {
      const item = records[i];
      const errors: string[] = [];
      const warnings: string[] = [];

      const guestName = (item.guestName || '').trim();
      const code = item.code ? item.code.trim().toUpperCase() : '';
      const email = item.email && typeof item.email === 'string' && item.email.trim() ? item.email.trim() : null;
      const addressLine1 = item.addressLine1 && typeof item.addressLine1 === 'string' && item.addressLine1.trim() ? item.addressLine1.trim() : null;
      const addressLine2 = item.addressLine2 && typeof item.addressLine2 === 'string' && item.addressLine2.trim() ? item.addressLine2.trim() : null;
      const city = item.city && typeof item.city === 'string' && item.city.trim() ? item.city.trim() : null;
      const state = item.state && typeof item.state === 'string' && item.state.trim() ? item.state.trim() : null;
      const zipCode = item.zipCode && typeof item.zipCode === 'string' && item.zipCode.trim() ? item.zipCode.trim() : null;
      const country = item.country && typeof item.country === 'string' && item.country.trim() ? item.country.trim() : null;
      const dietaryNotes = item.dietaryNotes && typeof item.dietaryNotes === 'string' && item.dietaryNotes.trim() ? item.dietaryNotes.trim() : null;
      const plusOneAllocations = typeof item.plusOneAllocations === 'number' ? item.plusOneAllocations : undefined;
      const plusOneFirstName = item.plusOneFirstName && typeof item.plusOneFirstName === 'string' && item.plusOneFirstName.trim() ? item.plusOneFirstName.trim() : null;
      const plusOneLastName = item.plusOneLastName && typeof item.plusOneLastName === 'string' && item.plusOneLastName.trim() ? item.plusOneLastName.trim() : null;
      const householdName = item.householdName && typeof item.householdName === 'string' && item.householdName.trim() ? item.householdName.trim() : null;
      const partyGroup = item.partyGroup && typeof item.partyGroup === 'string' && item.partyGroup.trim() ? item.partyGroup.trim() : null;

      let partyTags: string[] = [];
      if (Array.isArray(item.partyTags)) {
        partyTags = item.partyTags.map((t: any) => String(t).trim()).filter(Boolean);
      } else if (typeof item.partyTags === 'string' && item.partyTags.trim()) {
        partyTags = item.partyTags.split(',').map((t: string) => t.trim()).filter(Boolean);
      }

      const extraFields = item.extraFields && typeof item.extraFields === 'object' && Object.keys(item.extraFields).length > 0 ? item.extraFields : null;

      if (!guestName) {
        errors.push('Guest name is required.');
      }
      if (email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          errors.push('Invalid email format.');
        }
      }
      if (plusOneAllocations !== undefined) {
        if (!Number.isInteger(plusOneAllocations) || plusOneAllocations < 0) {
          errors.push('Plus-one allocation must be a non-negative integer.');
        }
      }
      if (addressLine1 && addressLine1.length > 150) {
        errors.push('Address Line 1 must be under 150 characters.');
      }
      if (addressLine2 && addressLine2.length > 150) {
        errors.push('Address Line 2 must be under 150 characters.');
      }
      if (city && city.length > 100) {
        errors.push('City must be under 100 characters.');
      }
      if (state && state.length > 100) {
        errors.push('State must be under 100 characters.');
      }
      if (zipCode && zipCode.length > 20) {
        errors.push('Zip Code must be under 20 characters.');
      }
      if (country && country.length > 100) {
        errors.push('Country must be under 100 characters.');
      }
      if (plusOneFirstName && plusOneFirstName.length > 100) {
        errors.push('Plus-one first name must be under 100 characters.');
      }
      if (plusOneLastName && plusOneLastName.length > 100) {
        errors.push('Plus-one last name must be under 100 characters.');
      }
      if (householdName && householdName.length > 100) {
        errors.push('Household name must be under 100 characters.');
      }
      if (partyGroup && partyGroup.length > 100) {
        errors.push('Party group must be under 100 characters.');
      }

      let isDuplicate = false;
      let existingGuestName: string | null = null;
      let actionOutcome: 'create' | 'update' | 'skip' | 'reject' | 'invalid' = 'create';

      if (code) {
        const isBatchDuplicate = (batchCodeFreq.get(code) || 0) > 1;
        const existingInDb = dbCodeMap.get(code);

        if (existingInDb) {
          isDuplicate = true;
          existingGuestName = existingInDb.guestName;
          if (collisionStrategy === 'reject') {
            errors.push(`Code "${code}" already exists in database (belongs to "${existingGuestName}").`);
            actionOutcome = 'reject';
          } else if (collisionStrategy === 'skip') {
            warnings.push(`Code "${code}" already exists in database for guest "${existingGuestName}". Will be skipped.`);
            actionOutcome = 'skip';
          } else if (collisionStrategy === 'update') {
            warnings.push(`Code "${code}" already exists in database for guest "${existingGuestName}". Will be updated.`);
            actionOutcome = 'update';
          }
        } else if (isBatchDuplicate) {
          isDuplicate = true;
          errors.push(`Duplicate invitation code "${code}" within batch.`);
          actionOutcome = 'invalid';
        } else {
          actionOutcome = 'create';
        }
      } else {
        warnings.push('Blank code: Auto-generated code will be assigned.');
        actionOutcome = 'create';
      }

      const isValid = errors.length === 0;
      if (!isValid) {
        if (actionOutcome !== 'reject') {
          actionOutcome = 'invalid';
        }
        invalidCount++;
      } else {
        validCount++;
        if (actionOutcome === 'create') createdCount++;
        else if (actionOutcome === 'update') updatedCount++;
        else if (actionOutcome === 'skip') skippedCount++;
      }

      if (isDuplicate) {
        duplicateCount++;
      }

      rows.push({
        rowIndex: i + 1,
        guestName,
        code,
        email,
        addressLine1,
        addressLine2,
        city,
        state,
        zipCode,
        country,
        dietaryNotes,
        plusOneAllocations,
        plusOneFirstName,
        plusOneLastName,
        householdName,
        partyGroup,
        partyTags,
        extraFields,
        isValid,
        errors,
        warnings,
        isDuplicate,
        existingGuestName,
        actionOutcome,
      });
    }

    const summary: DryRunValidationSummary = {
      total: records.length,
      validCount,
      invalidCount,
      duplicateCount,
      updatedCount,
      skippedCount,
      createdCount,
    };

    return {
      success: true,
      summary,
      rows,
    };
  }

  async batchUpdateTags(
    ids: string[],
    tags: string[],
    action: 'add' | 'remove' | 'replace' = 'add',
    author: string = 'Admin'
  ) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('Validation Error: IDs array cannot be empty.');
    }
    const cleanTags = (tags || []).map((t: string) => t.trim()).filter(Boolean);

    return executeInTransaction(this.repo.client, async (tx: any) => {
      const dbRecords = await tx.invitationCode.findMany({
        where: { id: { in: ids } },
        select: { id: true, partyTags: true },
      });

      for (const record of dbRecords) {
        let updatedTags: string[] = [];
        const existingTags: string[] = record.partyTags || [];
        if (action === 'replace') {
          updatedTags = Array.from(new Set(cleanTags));
        } else if (action === 'remove') {
          const removeSet = new Set(cleanTags);
          updatedTags = existingTags.filter(t => !removeSet.has(t));
        } else {
          updatedTags = Array.from(new Set([...existingTags, ...cleanTags]));
        }

        await tx.invitationCode.update({
          where: { id: record.id },
          data: { partyTags: updatedTags },
        });
      }

      await createAuditSnapshot(
        'InvitationCode',
        'batch_update_tags',
        { count: ids.length, action, tags: cleanTags },
        author,
        tx
      );

      return { success: true, count: dbRecords.length };
    });
  }

  async batchDelete(ids: string[], author: string = 'Admin') {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error('Validation Error: IDs array cannot be empty.');
    }
    for (const id of ids) {
      if (typeof id !== 'string' || id.trim() === '') {
        throw new Error('Validation Error: Invalid ID in array.');
      }
    }

    return executeInTransaction(this.repo.client, async (tx: any) => {
      await tx.contributor.updateMany({
        where: { invitationCodeId: { in: ids } },
        data: { invitationCodeId: null },
      });
      await tx.subEventAccess.deleteMany({
        where: { invitationCodeId: { in: ids } },
      });
      await tx.subEventRsvp.deleteMany({
        where: { invitationCodeId: { in: ids } },
      });
      await tx.broadcastRecipient.updateMany({
        where: { invitationCodeId: { in: ids } },
        data: { invitationCodeId: null },
      });

      const deleteResult = await tx.invitationCode.deleteMany({
        where: { id: { in: ids } },
      });

      await createAuditSnapshot(
        'InvitationCode',
        'batch_delete',
        { count: deleteResult.count, ids },
        author,
        tx
      );

      return {
        success: true,
        count: deleteResult.count,
      };
    });
  }
}
