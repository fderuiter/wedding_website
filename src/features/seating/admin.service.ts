import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { SeatingTableDTO } from './schemas';
import { createAuditSnapshot } from '@/lib/audit';

export class SeatingTableAdminService extends BaseService<SeatingTableDTO> {
  static ENTITY_KEY = 'seating-tables';

  constructor() {
    super(new BaseRepository<SeatingTableDTO>('seatingTable'), 'SeatingTable');
    this.defaultQueryArgs = {
      include: {
        invitationCodes: {
          orderBy: { seatNumber: 'asc' },
        },
      },
    };
  }

  protected async validate(data: any): Promise<void> {
    if (data.name !== undefined) {
      if (typeof data.name !== 'string' || data.name.trim() === '') {
        throw new Error('Validation Error: Table name is required.');
      }
    }
    if (data.capacity !== undefined) {
      const cap = Number(data.capacity);
      if (isNaN(cap) || cap < 1) {
        throw new Error('Validation Error: Capacity must be at least 1.');
      }
    }
    if (data.shape !== undefined) {
      if (!['round', 'rectangular', 'square'].includes(data.shape)) {
        throw new Error('Validation Error: Shape must be round, rectangular, or square.');
      }
    }
  }

  protected async preSave(data: any, _client?: any, _author?: string): Promise<any> {
    const processed = { ...data };
    if (processed.name && typeof processed.name === 'string') {
      processed.name = processed.name.trim();
    }
    if (processed.capacity !== undefined) {
      processed.capacity = Number(processed.capacity);
    }
    if (processed.x !== undefined) processed.x = Number(processed.x);
    if (processed.y !== undefined) processed.y = Number(processed.y);
    if (processed.width !== undefined) processed.width = Number(processed.width);
    if (processed.height !== undefined) processed.height = Number(processed.height);
    if (processed.rotation !== undefined) processed.rotation = Number(processed.rotation);

    // Remove relations if passed as nested objects in save body
    delete processed.invitationCodes;

    return processed;
  }

  async delete(id: string, author: string = 'Admin'): Promise<SeatingTableDTO> {
    return this.repo.transaction(async (txRepo) => {
      // Clear associated invitation code tableId and seatNumber
      await txRepo.client.invitationCode.updateMany({
        where: { tableId: id },
        data: { tableId: null, seatNumber: null },
      });

      const deletedRecord = await txRepo.delete(id, author);
      return deletedRecord;
    });
  }

  async assignSeat(
    invitationCodeId: string,
    tableId: string | null,
    seatNumber?: number | null,
    author: string = 'Admin'
  ) {
    if (!invitationCodeId) {
      throw new Error('Validation Error: Invitation code ID is required.');
    }

    return this.repo.transaction(async (txRepo) => {
      const client = txRepo.client;

      if (tableId) {
        const table = await client.seatingTable.findUnique({
          where: { id: tableId },
          include: { invitationCodes: true },
        });

        if (!table) {
          throw new Error('Validation Error: Table not found.');
        }

        // If seatNumber is specified, check if that seat is already taken by another guest
        if (seatNumber) {
          const occupant = await client.invitationCode.findFirst({
            where: {
              tableId,
              seatNumber,
              NOT: { id: invitationCodeId },
            },
          });
          if (occupant) {
            // Unassign occupant or swap seat
            await client.invitationCode.update({
              where: { id: occupant.id },
              data: { seatNumber: null },
            });
          }
        }
      }

      const updatedGuest = await client.invitationCode.update({
        where: { id: invitationCodeId },
        data: {
          tableId: tableId || null,
          seatNumber: tableId ? (seatNumber ?? null) : null,
        },
      });

      await createAuditSnapshot(
        'InvitationCode',
        invitationCodeId,
        { tableId, seatNumber, action: 'assignSeat' },
        author,
        client
      );

      return updatedGuest;
    });
  }
}
