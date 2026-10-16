import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { InvitationCodeDTO } from './schemas';
import { executeInTransaction } from '@/lib/transaction';
import { createAuditSnapshot } from '@/lib/audit';

function generateRandomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export class InvitationCodeAdminService extends BaseService<InvitationCodeDTO> {
  static ENTITY_KEY = 'invitation-codes';

  constructor() {
    super(new BaseRepository<InvitationCodeDTO>('invitationCode'), 'InvitationCode');
  }

  protected async validate(data: any, _client?: any): Promise<void> {
    if (!data.guestName || typeof data.guestName !== 'string' || data.guestName.trim() === '') {
      throw new Error('Validation Error: Guest name is required.');
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
  }

  protected async preSave(data: any, client?: any, _author?: string): Promise<any> {
    const finalData = { ...data };
    const activeClient = client || this.repo.client;

    if (finalData.plusOneFirstName !== undefined) {
      finalData.plusOneFirstName = typeof finalData.plusOneFirstName === 'string' && finalData.plusOneFirstName.trim() ? finalData.plusOneFirstName.trim() : null;
    }
    if (finalData.plusOneLastName !== undefined) {
      finalData.plusOneLastName = typeof finalData.plusOneLastName === 'string' && finalData.plusOneLastName.trim() ? finalData.plusOneLastName.trim() : null;
    }

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
        // Handled by Prisma unique constraint if needed
      }
    }

    return finalData;
  }

  async importBatch(
    records: {
      guestName: string;
      code?: string;
      email?: string | null;
      dietaryNotes?: string | null;
      plusOneAllocations?: number;
      plusOneFirstName?: string | null;
      plusOneLastName?: string | null;
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
        if (item.plusOneFirstName !== undefined && item.plusOneFirstName !== null) {
          if (typeof item.plusOneFirstName !== 'string' || item.plusOneFirstName.length > 100) {
            throw new Error(`Validation Error: Row ${i + 1} has an invalid plus-one first name.`);
          }
        }
        if (item.plusOneLastName !== undefined && item.plusOneLastName !== null) {
          if (typeof item.plusOneLastName !== 'string' || item.plusOneLastName.length > 100) {
            throw new Error(`Validation Error: Row ${i + 1} has an invalid plus-one last name.`);
          }
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
        const rowDietaryNotes = row.dietaryNotes && typeof row.dietaryNotes === 'string' && row.dietaryNotes.trim() ? row.dietaryNotes.trim() : null;
        const rowPlusOne = typeof row.plusOneAllocations === 'number' ? row.plusOneAllocations : 0;
        const rowPlusOneFirstName = row.plusOneFirstName && typeof row.plusOneFirstName === 'string' && row.plusOneFirstName.trim() ? row.plusOneFirstName.trim() : null;
        const rowPlusOneLastName = row.plusOneLastName && typeof row.plusOneLastName === 'string' && row.plusOneLastName.trim() ? row.plusOneLastName.trim() : null;
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
              if (row.dietaryNotes !== undefined) updateData.dietaryNotes = rowDietaryNotes;
              if (row.plusOneAllocations !== undefined) updateData.plusOneAllocations = rowPlusOne;
              if (row.plusOneFirstName !== undefined) updateData.plusOneFirstName = rowPlusOneFirstName;
              if (row.plusOneLastName !== undefined) updateData.plusOneLastName = rowPlusOneLastName;
              if (row.extraFields !== undefined) updateData.extraFields = rowExtraFields;

              await tx.invitationCode.update({
                where: { id: existingRecord.id },
                data: updateData
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
            const updateData: any = { guestName };
            if (row.email !== undefined) updateData.email = rowEmail;
            if (row.dietaryNotes !== undefined) updateData.dietaryNotes = rowDietaryNotes;
            if (row.plusOneAllocations !== undefined) updateData.plusOneAllocations = rowPlusOne;
            if (row.plusOneFirstName !== undefined) updateData.plusOneFirstName = rowPlusOneFirstName;
            if (row.plusOneLastName !== undefined) updateData.plusOneLastName = rowPlusOneLastName;
            if (row.extraFields !== undefined) updateData.extraFields = rowExtraFields;

            await tx.invitationCode.update({
              where: { id: existingRecord.id },
              data: updateData
            });
            updated++;
          }
        } else {
          await tx.invitationCode.create({
            data: {
              guestName,
              code,
              email: rowEmail,
              dietaryNotes: rowDietaryNotes,
              plusOneAllocations: rowPlusOne,
              plusOneFirstName: rowPlusOneFirstName,
              plusOneLastName: rowPlusOneLastName,
              extraFields: rowExtraFields ?? undefined,
              used: false
            }
          });
          imported++;
        }
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
}
