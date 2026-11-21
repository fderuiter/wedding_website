import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { SeatingTableDTO, AutoAssignResultDTO } from './schemas';
import { createAuditSnapshot, createBatchAuditSnapshots } from '@/lib/audit';
import { Prisma } from '@prisma/client';
import {
  getGuestAttendanceStatus,
  isGuestEligibleForSeating,
} from './utils/seatingHelpers';

const VALID_TABLE_SHAPES = ['round', 'rectangular', 'square', 'head', 'sweetheart'] as const;

type BatchSeatAuditAction = 'assignBatch' | 'clearTable' | 'undo' | 'autoAssign';

interface PlannedSeatUpdate {
  guestId: string;
  tableId: string | null;
  seatNumber: number | null;
}

interface SeatTracker {
  usedSeats: Set<number>;
  nextSeat: () => number | null;
}

interface TableOccupantRecord {
  id: string;
  seatNumber?: number | null;
  [key: string]: unknown;
}

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

  private async loadGuestsByIds(
    client: any,
    uniqueIds: string[]
  ): Promise<{ targetGuests: any[]; guestById: Map<string, any> }> {
    const targetGuests = await client.invitationCode.findMany({
      where: { id: { in: uniqueIds } },
    });

    if (!targetGuests || targetGuests.length !== uniqueIds.length) {
      throw new Error('Validation Error: One or more guests not found.');
    }

    const guestById = new Map<string, any>(targetGuests.map((g: any) => [g.id, g]));
    return { targetGuests, guestById };
  }

  private async findTableWithOccupants(client: any, tableId: string): Promise<any> {
    const table = await client.seatingTable.findUnique({
      where: { id: tableId },
      include: { invitationCodes: true },
    });

    if (!table) {
      throw new Error('Validation Error: Table not found.');
    }

    return table;
  }

  private filterOtherOccupantsAndAssertCapacity(
    table:
      | { name: string; capacity: number; invitationCodes?: TableOccupantRecord[] | null }
      | null
      | undefined,
    excludedGuestIds: Set<string>,
    incomingCount: number
  ): TableOccupantRecord[] {
    if (!table) {
      throw new Error('Validation Error: Table not found.');
    }

    const otherOccupants = (table.invitationCodes || []).filter(
      (ic) => !excludedGuestIds.has(ic.id)
    );
    if (otherOccupants.length + incomingCount > table.capacity) {
      throw new Error(
        `Validation Error: Table "${table.name}" has reached its maximum capacity of ${table.capacity}.`
      );
    }

    return otherOccupants;
  }

  private createSeatTracker(
    occupants: Array<{ seatNumber?: unknown }>,
    capacity: number
  ): SeatTracker {
    const usedSeats = new Set<number>(
      (occupants || [])
        .map((ic) => ic.seatNumber)
        .filter((s): s is number => typeof s === 'number' && s > 0)
    );

    const nextSeat = (): number | null => {
      for (let i = 1; i <= capacity; i++) {
        if (!usedSeats.has(i)) {
          usedSeats.add(i);
          return i;
        }
      }
      return null;
    };

    return { usedSeats, nextSeat };
  }

  private async applyBatchSeatUpdates(
    client: any,
    updates: PlannedSeatUpdate[],
    guestById: Map<string, any>,
    actionLabel: BatchSeatAuditAction,
    author: string
  ): Promise<any[]> {
    if (updates.length === 0) {
      return [];
    }

    const rows = updates.map((item) => {
      return Prisma.sql`(${item.guestId}::text, ${item.tableId}::text, ${item.seatNumber}::integer)`;
    });
    const values = Prisma.join(rows, ', ');

    const bulkUpdateQuery = Prisma.sql`
      UPDATE "InvitationCode" AS t
      SET
        "tableId" = v."tableId",
        "seatNumber" = v."seatNumber",
        "updatedAt" = NOW()
      FROM (VALUES ${values}) AS v(
        "id",
        "tableId",
        "seatNumber"
      )
      WHERE t."id" = v."id"
    `;

    await client.$executeRaw(bulkUpdateQuery);

    const auditRecords = updates.map((item) => ({
      entityId: item.guestId,
      data: {
        tableId: item.tableId,
        seatNumber: item.seatNumber,
        action: actionLabel,
      },
    }));

    await createBatchAuditSnapshots('InvitationCode', auditRecords, author, client);

    return updates.map((item) => ({
      ...(guestById.get(item.guestId) || {}),
      id: item.guestId,
      tableId: item.tableId,
      seatNumber: item.seatNumber,
    }));
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
      if (!(VALID_TABLE_SHAPES as readonly string[]).includes(data.shape)) {
        throw new Error(
          'Validation Error: Shape must be round, rectangular, square, head, or sweetheart.'
        );
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
        const table = await this.findTableWithOccupants(client, tableId);
        // Check table capacity, excluding the target guest if already assigned to this table
        this.filterOtherOccupantsAndAssertCapacity(table, new Set([invitationCodeId]), 1);

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

  async assignSeatsBatch(
    invitationCodeIds: string[],
    tableId: string | null,
    options?: {
      action?: 'assignBatch' | 'clearTable' | 'undo';
      author?: string;
    }
  ) {
    const uniqueIds = Array.from(
      new Set((invitationCodeIds || []).map((id) => id?.trim()).filter(Boolean))
    );
    if (uniqueIds.length === 0) {
      throw new Error('Validation Error: At least one invitation code ID is required.');
    }

    const author = options?.author?.trim() || 'Admin';
    const actionLabel = options?.action || (tableId ? 'assignBatch' : 'clearTable');

    return this.repo.transaction(async (txRepo) => {
      const client = txRepo.client;

      const { targetGuests, guestById } = await this.loadGuestsByIds(client, uniqueIds);
      const targetIdSet = new Set<string>(uniqueIds);
      const plannedUpdates: PlannedSeatUpdate[] = [];

      if (tableId) {
        for (const guest of targetGuests) {
          if (!isGuestEligibleForSeating(guest)) {
            throw new Error(
              'Validation Error: Declined RSVPs and address-collection entries cannot be assigned to tables.'
            );
          }
        }

        const table = await this.findTableWithOccupants(client, tableId);
        const existingOtherOccupants = this.filterOtherOccupantsAndAssertCapacity(
          table,
          targetIdSet,
          uniqueIds.length
        );
        const { usedSeats, nextSeat } = this.createSeatTracker(
          existingOtherOccupants,
          table.capacity
        );

        for (const guestId of uniqueIds) {
          const existing = guestById.get(guestId);
          let assignedSeat: number | null = null;
          if (
            existing?.tableId === tableId &&
            typeof existing.seatNumber === 'number' &&
            existing.seatNumber >= 1 &&
            existing.seatNumber <= table.capacity &&
            !usedSeats.has(existing.seatNumber)
          ) {
            usedSeats.add(existing.seatNumber);
            assignedSeat = existing.seatNumber;
          } else {
            assignedSeat = nextSeat();
          }

          plannedUpdates.push({
            guestId,
            tableId,
            seatNumber: assignedSeat,
          });
        }
      } else {
        for (const guestId of uniqueIds) {
          plannedUpdates.push({
            guestId,
            tableId: null,
            seatNumber: null,
          });
        }
      }

      const updatedGuests = await this.applyBatchSeatUpdates(
        client,
        plannedUpdates,
        guestById,
        actionLabel,
        author
      );

      return {
        updatedGuests,
      };
    });
  }

  async restoreSeatAssignments(
    assignments: Array<{
      invitationCodeId: string;
      tableId: string | null;
      seatNumber?: number | null;
    }>,
    options?: {
      action?: 'assignBatch' | 'clearTable' | 'undo';
      author?: string;
    }
  ) {
    if (!assignments || assignments.length === 0) {
      throw new Error('Validation Error: At least one assignment is required.');
    }

    const dedupedMap = new Map<
      string,
      { invitationCodeId: string; tableId: string | null; seatNumber: number | null }
    >();
    for (const entry of assignments) {
      const id = entry.invitationCodeId?.trim();
      if (!id) continue;
      const normalizedTableId = entry.tableId || null;
      dedupedMap.set(id, {
        invitationCodeId: id,
        tableId: normalizedTableId,
        seatNumber: normalizedTableId ? (entry.seatNumber ?? null) : null,
      });
    }

    const normalizedEntries = Array.from(dedupedMap.values());
    if (normalizedEntries.length === 0) {
      throw new Error('Validation Error: At least one assignment is required.');
    }

    const author = options?.author?.trim() || 'Admin';
    const actionLabel = options?.action || 'undo';
    const uniqueIds = normalizedEntries.map((e) => e.invitationCodeId);
    const batchIdSet = new Set(uniqueIds);

    return this.repo.transaction(async (txRepo) => {
      const client = txRepo.client;

      const { guestById } = await this.loadGuestsByIds(client, uniqueIds);

      const targetTableIds = Array.from(
        new Set(
          normalizedEntries
            .map((e) => e.tableId)
            .filter((tid): tid is string => Boolean(tid))
        )
      );

      const displacedSeatUpdates: PlannedSeatUpdate[] = [];

      if (targetTableIds.length > 0) {
        const tables = await client.seatingTable.findMany({
          where: { id: { in: targetTableIds } },
          include: { invitationCodes: true },
        });

        const tableMap = new Map<string, any>((tables || []).map((t: any) => [t.id, t]));

        for (const tid of targetTableIds) {
          const table = tableMap.get(tid);
          const incomingForTable = normalizedEntries.filter((e) => e.tableId === tid);
          const otherOccupants = this.filterOtherOccupantsAndAssertCapacity(
            table,
            batchIdSet,
            incomingForTable.length
          );

          const incomingSeats = new Set<number>(
            incomingForTable
              .map((e) => e.seatNumber)
              .filter((s): s is number => typeof s === 'number' && s > 0)
          );

          for (const occ of otherOccupants) {
            if (typeof occ.seatNumber === 'number' && incomingSeats.has(occ.seatNumber)) {
              displacedSeatUpdates.push({
                guestId: occ.id,
                tableId: tid,
                seatNumber: null,
              });
              guestById.set(occ.id, occ);
            }
          }
        }
      }

      const allUpdates: PlannedSeatUpdate[] = [
        ...displacedSeatUpdates,
        ...normalizedEntries.map((e) => ({
          guestId: e.invitationCodeId,
          tableId: e.tableId,
          seatNumber: e.seatNumber,
        })),
      ];

      const updatedGuests = await this.applyBatchSeatUpdates(
        client,
        allUpdates,
        guestById,
        actionLabel,
        author
      );

      return {
        updatedGuests,
      };
    });
  }

  async autoAssignSeats(
    author: string = 'Admin',
    options?: { includePending?: boolean }
  ): Promise<AutoAssignResultDTO> {
    const includePending = options?.includePending ?? true;

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

      // 2. Query all unassigned invitation codes and filter out declined & address-collection entries
      const rawUnassignedGuests = await client.invitationCode.findMany({
        where: { tableId: null },
        orderBy: [
          { householdName: 'asc' },
          { guestName: 'asc' },
        ],
      });

      const unassignedGuests = (rawUnassignedGuests || []).filter((guest: any) => {
        if (!isGuestEligibleForSeating(guest)) {
          return false;
        }
        if (!includePending && getGuestAttendanceStatus(guest) !== 'attending') {
          return false;
        }
        return true;
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
        const capacity = Number(t.capacity) || 0;
        const { usedSeats, nextSeat } = this.createSeatTracker(occupants, capacity);
        const remainingCapacity = Math.max(0, capacity - occupants.length);

        return {
          id: t.id,
          name: t.name,
          capacity,
          remainingCapacity,
          usedSeats,
          nextSeat,
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

      const plannedAssignments: PlannedSeatUpdate[] = [];
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

      // Execute batch raw SQL update and bulk audit snapshot inside transaction
      const guestById = new Map<string, any>(unassignedGuests.map((g: any) => [g.id, g]));
      const updatedGuests = await this.applyBatchSeatUpdates(
        client,
        plannedAssignments,
        guestById,
        'autoAssign',
        author
      );

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
