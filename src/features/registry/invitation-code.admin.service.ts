import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { InvitationCodeDTO, DryRunValidatedRow, DryRunValidationSummary, DryRunValidationResponse } from './schemas';
import { executeInTransaction } from '@/lib/transaction';
import { createAuditSnapshot } from '@/lib/audit';
import { Prisma } from '@prisma/client';
import { generateRandomCode } from './utils/invitation';
import {
  BatchInvitationCodeRecord,
  InvitationCollisionStrategy,
  NormalizedInvitationCodeRecord,
  normalizeBatchInvitationRecord,
  normalizeInvitationCode,
  normalizeNullableString,
  normalizePartyTags,
  validateInvitationGuestFields,
} from '@/utils/invitationValidation';

export class InvitationCodeAdminService extends BaseService<InvitationCodeDTO> {
  static ENTITY_KEY = 'invitation-codes';

  constructor() {
    super(new BaseRepository<InvitationCodeDTO>('invitationCode'), 'InvitationCode');
  }

  protected async validate(data: unknown, _client?: Prisma.TransactionClient): Promise<void> {
    const errors = validateInvitationGuestFields(data, { mode: 'service' });
    if (errors.length > 0) {
      throw new Error(errors[0]);
    }
  }

  protected async preSave(
    data: Record<string, unknown>,
    client?: Prisma.TransactionClient,
    _author?: string
  ): Promise<Record<string, unknown>> {
    const finalData: Record<string, unknown> = { ...data };
    const activeClient = client || this.repo.client;

    if (finalData.plusOneFirstName !== undefined) {
      finalData.plusOneFirstName = normalizeNullableString(finalData.plusOneFirstName);
    }
    if (finalData.plusOneLastName !== undefined) {
      finalData.plusOneLastName = normalizeNullableString(finalData.plusOneLastName);
    }
    if (finalData.householdName !== undefined) {
      finalData.householdName = normalizeNullableString(finalData.householdName);
    }
    if (finalData.partyGroup !== undefined) {
      finalData.partyGroup = normalizeNullableString(finalData.partyGroup);
    }
    if (finalData.partyTags !== undefined) {
      finalData.partyTags = Array.isArray(finalData.partyTags)
        ? normalizePartyTags(finalData.partyTags)
        : [];
    }

    const normalizedCode = normalizeInvitationCode(finalData.code);
    if (!normalizedCode) {
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
      finalData.code = normalizedCode;
      const existing = await activeClient.invitationCode.findUnique({
        where: { code: finalData.code }
      });
      if (existing) {
        // Handled by Prisma unique constraint if needed
      }
    }

    return finalData;
  }

  private buildBatchUpdateData(
    row: BatchInvitationCodeRecord,
    normalized: NormalizedInvitationCodeRecord
  ): Record<string, unknown> {
    const updateData: Record<string, unknown> = { guestName: normalized.guestName };
    if (row.email !== undefined) updateData.email = normalized.email;
    if (row.addressLine1 !== undefined) updateData.addressLine1 = normalized.addressLine1;
    if (row.addressLine2 !== undefined) updateData.addressLine2 = normalized.addressLine2;
    if (row.city !== undefined) updateData.city = normalized.city;
    if (row.state !== undefined) updateData.state = normalized.state;
    if (row.zipCode !== undefined) updateData.zipCode = normalized.zipCode;
    if (row.country !== undefined) updateData.country = normalized.country;
    if (row.dietaryNotes !== undefined) updateData.dietaryNotes = normalized.dietaryNotes;
    if (row.plusOneAllocations !== undefined) updateData.plusOneAllocations = normalized.plusOneAllocations ?? 0;
    if (row.plusOneFirstName !== undefined) updateData.plusOneFirstName = normalized.plusOneFirstName;
    if (row.plusOneLastName !== undefined) updateData.plusOneLastName = normalized.plusOneLastName;
    if (row.householdName !== undefined) updateData.householdName = normalized.householdName;
    if (row.partyGroup !== undefined) updateData.partyGroup = normalized.partyGroup;
    if (row.partyTags !== undefined) updateData.partyTags = normalized.partyTags;
    if (row.extraFields !== undefined) updateData.extraFields = normalized.extraFields;
    return updateData;
  }

  async importBatch(
    records: BatchInvitationCodeRecord[],
    collisionStrategy: InvitationCollisionStrategy = 'skip',
    author: string = 'Admin'
  ) {
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('Validation Error: Records array cannot be empty.');
    }

    return executeInTransaction(this.repo.client, async (tx: Prisma.TransactionClient) => {
      for (let i = 0; i < records.length; i++) {
        const errors = validateInvitationGuestFields(records[i], {
          mode: 'batch',
          rowNumber: i + 1,
        });
        if (errors.length > 0) {
          throw new Error(errors[0]);
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
      const toCreate: Prisma.InvitationCodeCreateManyInput[] = [];
      const toUpdate: Array<{ id: string; data: Record<string, unknown> }> = [];

      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        const normalized = normalizeBatchInvitationRecord(row);
        const guestName = normalized.guestName;
        let code = normalized.code;

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

        if (existsInBatch) {
          if (collisionStrategy === 'skip') {
            skipped++;
            continue;
          } else if (collisionStrategy === 'update') {
            if (existsInDb) {
              const existingRecord = dbCodeMap.get(code)!;
              toUpdate.push({
                id: existingRecord.id,
                data: this.buildBatchUpdateData(row, normalized),
              });
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
            toUpdate.push({
              id: existingRecord.id,
              data: this.buildBatchUpdateData(row, normalized),
            });
            updated++;
          }
        } else {
          toCreate.push({
            guestName,
            code,
            email: normalized.email,
            addressLine1: normalized.addressLine1,
            addressLine2: normalized.addressLine2,
            city: normalized.city,
            state: normalized.state,
            zipCode: normalized.zipCode,
            country: normalized.country,
            dietaryNotes: normalized.dietaryNotes,
            plusOneAllocations: normalized.plusOneAllocations ?? 0,
            plusOneFirstName: normalized.plusOneFirstName,
            plusOneLastName: normalized.plusOneLastName,
            householdName: normalized.householdName,
            partyGroup: normalized.partyGroup,
            partyTags: normalized.partyTags,
            extraFields: (normalized.extraFields as Prisma.InputJsonValue | null) ?? undefined,
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
        const updatesById = new Map<string, Record<string, unknown>>();
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
    records: BatchInvitationCodeRecord[],
    collisionStrategy: InvitationCollisionStrategy = 'skip'
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
      const uppercaseCode = normalizeInvitationCode(r.code);
      if (uppercaseCode) {
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
      const normalized = normalizeBatchInvitationRecord(records[i]);
      const errors = validateInvitationGuestFields(normalized, { mode: 'row' });
      const warnings: string[] = [];
      const { code } = normalized;

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
        ...normalized,
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
    const cleanTags = normalizePartyTags(tags);

    return executeInTransaction(this.repo.client, async (tx: Prisma.TransactionClient) => {
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

    return executeInTransaction(this.repo.client, async (tx: Prisma.TransactionClient) => {
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
