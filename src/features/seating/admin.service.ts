import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { SeatingTableDTO, AutoAssignResultDTO } from './schemas';
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

        // Check table capacity, excluding the target guest if already assigned to this table
        const existingOccupants = (table.invitationCodes || []).filter(
          (ic: { id: string }) => ic.id !== invitationCodeId
        );
        if (existingOccupants.length >= table.capacity) {
          throw new Error(
            `Validation Error: Table "${table.name}" has reached its maximum capacity of ${table.capacity}.`
          );
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

  async autoAssignSeats(author: string = 'Admin'): Promise<AutoAssignResultDTO> {
    return this.repo.transaction(async (txRepo) => {
      const client = txRepo.client;

      // 1. Query all tables with their current occupants
      const tables = await client.seatingTable.findMany({
        include: {
          invitationCodes: {
            orderBy: { seatNumber: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      });

      // 2. Query all unassigned invitation codes
      const unassignedGuests = await client.invitationCode.findMany({
        where: { tableId: null },
        orderBy: [
          { householdName: 'asc' },
          { guestName: 'asc' },
        ],
      });

      if (!unassignedGuests || unassignedGuests.length === 0) {
        return {
          assignedCount: 0,
          unassignedCount: 0,
          assignedGuests: [],
        };
      }

      // Initialize table tracking state
      interface TableState {
        id: string;
        name: string;
        capacity: number;
        remainingCapacity: number;
        usedSeats: Set<number>;
        nextSeat: () => number | null;
      }

      const tableStates: TableState[] = (tables || []).map((t: any) => {
        const occupants = t.invitationCodes || [];
        const usedSeats = new Set<number>(
          occupants
            .map((ic: any) => ic.seatNumber)
            .filter((s: any): s is number => typeof s === 'number' && s > 0)
        );
        const capacity = Number(t.capacity) || 0;
        const remainingCapacity = Math.max(0, capacity - occupants.length);

        return {
          id: t.id,
          name: t.name,
          capacity,
          remainingCapacity,
          usedSeats,
          nextSeat: function () {
            for (let i = 1; i <= this.capacity; i++) {
              if (!this.usedSeats.has(i)) {
                this.usedSeats.add(i);
                return i;
              }
            }
            return null;
          },
        };
      });

      // Group unassigned guests by householdName
      // If householdName is absent or empty, the guest forms their own individual group of size 1
      const householdMap = new Map<string, any[]>();
      let soloCounter = 0;

      for (const guest of unassignedGuests) {
        const household = guest.householdName && typeof guest.householdName === 'string'
          ? guest.householdName.trim()
          : '';

        if (household) {
          if (!householdMap.has(household)) {
            householdMap.set(household, []);
          }
          householdMap.get(household)!.push(guest);
        } else {
          soloCounter++;
          householdMap.set(`__solo_${guest.id || soloCounter}__`, [guest]);
        }
      }

      // Sort household groups in descending order of size for greedy bin packing
      const sortedGroups = Array.from(householdMap.values()).sort((a, b) => {
        if (b.length !== a.length) {
          return b.length - a.length;
        }
        const nameA = a[0]?.householdName || a[0]?.guestName || '';
        const nameB = b[0]?.householdName || b[0]?.guestName || '';
        return nameA.localeCompare(nameB);
      });

      interface PlannedAssignment {
        guestId: string;
        tableId: string;
        seatNumber: number | null;
      }

      const plannedAssignments: PlannedAssignment[] = [];
      const unplacedGroups: any[][] = [];

      // Phase 1: Intact Household Placement (Best-Fit Decreasing)
      for (const group of sortedGroups) {
        const groupSize = group.length;

        // Find tables that can fit the entire group
        const eligibleTables = tableStates.filter((t) => t.remainingCapacity >= groupSize);

        if (eligibleTables.length > 0) {
          // Best-Fit: minimize leftover capacity (remainingCapacity - groupSize)
          eligibleTables.sort((a, b) => {
            const diffA = a.remainingCapacity - groupSize;
            const diffB = b.remainingCapacity - groupSize;
            if (diffA !== diffB) {
              return diffA - diffB;
            }
            return a.name.localeCompare(b.name);
          });

          const chosenTable = eligibleTables[0];
          for (const guest of group) {
            const seatNumber = chosenTable.nextSeat();
            chosenTable.remainingCapacity -= 1;
            plannedAssignments.push({
              guestId: guest.id,
              tableId: chosenTable.id,
              seatNumber,
            });
          }
        } else {
          // Cannot fit intact into any single table
          unplacedGroups.push(group);
        }
      }

      // Phase 2: Split Remaining Household Groups Across Open Table Seats
      if (unplacedGroups.length > 0) {
        for (const group of unplacedGroups) {
          for (const guest of group) {
            // Find tables with remaining capacity > 0
            const availableTables = tableStates.filter((t) => t.remainingCapacity > 0);
            if (availableTables.length === 0) {
              // No capacity left in any table, guest remains unassigned
              break;
            }

            // Choose table with largest remaining capacity
            availableTables.sort((a, b) => {
              if (b.remainingCapacity !== a.remainingCapacity) {
                return b.remainingCapacity - a.remainingCapacity;
              }
              return a.name.localeCompare(b.name);
            });

            const chosenTable = availableTables[0];
            const seatNumber = chosenTable.nextSeat();
            chosenTable.remainingCapacity -= 1;
            plannedAssignments.push({
              guestId: guest.id,
              tableId: chosenTable.id,
              seatNumber,
            });
          }
        }
      }

      // Execute all updates inside transaction and record audit snapshot entries
      const updatedGuests: any[] = [];
      for (const item of plannedAssignments) {
        const updated = await client.invitationCode.update({
          where: { id: item.guestId },
          data: {
            tableId: item.tableId,
            seatNumber: item.seatNumber,
          },
        });
        updatedGuests.push(updated);

        await createAuditSnapshot(
          'InvitationCode',
          item.guestId,
          {
            tableId: item.tableId,
            seatNumber: item.seatNumber,
            action: 'autoAssign',
          },
          author,
          client
        );
      }

      const assignedCount = updatedGuests.length;
      const unassignedCount = unassignedGuests.length - assignedCount;

      return {
        assignedCount,
        unassignedCount,
        assignedGuests: updatedGuests,
      };
    });
  }
}
