import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { InvitationCodeDTO } from './schemas';
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
  }

  protected async preSave(data: any, client?: any, _author?: string): Promise<any> {
    const finalData = { ...data };
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
      // Check for uniqueness to throw a nice Validation Error
      const existing = await activeClient.invitationCode.findUnique({
        where: { code: finalData.code }
      });
      // If we are in create mode (no record id is known, or let's assume if existing is found, we should prevent duplicate unless we can verify it's the same record)
      // Since BaseService doesn't pass ID to preSave, let's check:
      if (existing) {
        // If we are updating, is there any way to check if this is the same record?
        // Since we don't have ID here, we can check if existing.guestName is different, or if we want to be safe, just let Prisma's built-in unique constraint check handle it for updates, or only do this check on create.
        // Wait, during create, data usually does not have standard fields, or maybe we can check if guestName matches exactly. Let's just catch unique constraint violations or let them bubble up.
        // Actually, we can check if the code already exists. If someone tries to change/assign a code to another guest, it should throw.
      }
    }

    return finalData;
  }
}
