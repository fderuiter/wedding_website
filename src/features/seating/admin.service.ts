import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { SeatingTableDTO, AutoAssignResultDTO } from './schemas';
import { createAuditSnapshot, createBatchAuditSnapshots } from '@/lib/audit';
import { Prisma } from '@prisma/client';
import { InvitationCodeDTO } from '@/features/registry';
import {
  repackTableSeatNumbers,
  resolveDetailedSeatAssignments,
} from './seatLayout';
import {
  getGuestAttendanceStatus,
  getGuestPartySize,
  getGuestsHeadcount,
  isGuestEligibleForSeating,
} from './utils/seatingHelpers';

const VALID_TABLE_SHAPES = ['round', 'rectangular', 'square', 'head', 'sweetheart'] as const;

type BatchSeatAuditAction = 'assignBatch' | 'clearTable' | 'undo' | 'autoAssign' | 'repackSeats';

interface PlannedSeatUpdate {
  guestId: string;
  tableId: string | null;
  seatNumber: number | null;
}

interface SeatTracker {
  usedSeats: Set<number>;
  nextSeat: () => number | null;
  takePartySeats: (partySize: number, preferredStartSeat?: number | null) => number | null;
}

interface TableOccupantRecord {
  id: string;
  guestName?: string | null;
  seatNumber?: number | null;
  used?: boolean | null;
  extraFields?: unknown;
  partyTags?: unknown;
  plusOneAllocations?: number | null;
  plusOneFirstName?: string | null;
  plusOneLastName?: string | null;
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

  private async loadOptionalGuestById(client: any, guestId: string): Promise<any | null> {
    if (typeof client?.invitationCode?.findUnique === 'function') {
      const found = await client.invitationCode.findUnique({ where: { id: guestId } });
      if (found) return found;
    }
    if (typeof client?.invitationCode?.findMany === 'function') {
      const rows = await client.invitationCode.findMany({ where: { id: { in: [guestId] } } });
      if (Array.isArray(rows) && rows.length > 0) {
        return rows[0];
      }
    }
    return null;
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
    incomingHeadcount: number
  ): TableOccupantRecord[] {
    if (!table) {
      throw new Error('Validation Error: Table not found.');
    }

    const otherOccupants = (table.invitationCodes || []).filter(
      (ic) => !excludedGuestIds.has(ic.id)
    );
    const existingHeadcount = getGuestsHeadcount(otherOccupants);
    if (existingHeadcount + incomingHeadcount > table.capacity) {
      throw new Error(
        `Validation Error: Table "${table.name}" has reached its maximum capacity of ${table.capacity}.`
      );
    }

    return otherOccupants;
  }

  private createSeatTracker(
    occupants: TableOccupantRecord[],
    capacity: number
  ): SeatTracker {
    const usedSeats = new Set<number>();
    const safeCap = Math.max(1, Number(capacity) || 1);

    if (occupants && occupants.length > 0) {
      const resolved = resolveDetailedSeatAssignments(
        occupants as unknown as InvitationCodeDTO[],
        safeCap
      );
      resolved.forEach((_entry, seatNum) => {
        if (seatNum >= 1 && seatNum <= safeCap) {
          usedSeats.add(seatNum);
        }
      });
    }

    const takePartySeats = (
      rawPartySize: number,
      preferredStartSeat?: number | null
    ): number | null => {
      const partySize = Math.max(1, Math.floor(rawPartySize || 1));

      // 1. Honor preferredStartSeat if all contiguous chairs fit in 1..safeCap and are open
      if (
        typeof preferredStartSeat === 'number' &&
        Number.isInteger(preferredStartSeat) &&
        preferredStartSeat >= 1 &&
        preferredStartSeat <= safeCap
      ) {
        if (preferredStartSeat + partySize - 1 <= safeCap) {
          let allFree = true;
          for (let offset = 0; offset < partySize; offset++) {
            if (usedSeats.has(preferredStartSeat + offset)) {
              allFree = false;
              break;
            }
          }
          if (allFree) {
            for (let offset = 0; offset < partySize; offset++) {
              usedSeats.add(preferredStartSeat + offset);
            }
            return preferredStartSeat;
          }
        }
        // If preferred primary seat itself is open, claim it and fill remaining companions from open seats
        if (!usedSeats.has(preferredStartSeat)) {
          const openSeats: number[] = [];
          for (let s = 1; s <= safeCap && openSeats.length < partySize - 1; s++) {
            if (s !== preferredStartSeat && !usedSeats.has(s)) {
              openSeats.push(s);
            }
          }
          if (openSeats.length === partySize - 1) {
            usedSeats.add(preferredStartSeat);
            for (const s of openSeats) usedSeats.add(s);
            return preferredStartSeat;
          }
        }
      }

      // 2. Prefer a contiguous block of `partySize` open seats within 1..safeCap
      if (partySize <= safeCap) {
        for (let start = 1; start <= safeCap - partySize + 1; start++) {
          let fits = true;
          for (let offset = 0; offset < partySize; offset++) {
            if (usedSeats.has(start + offset)) {
              fits = false;
              break;
            }
          }
          if (fits) {
            for (let offset = 0; offset < partySize; offset++) {
              usedSeats.add(start + offset);
            }
            return start;
          }
        }
      }

      // 3. Fallback: reserve the lowest `partySize` open seats in 1..safeCap
      const chosen: number[] = [];
      for (let i = 1; i <= safeCap && chosen.length < partySize; i++) {
        if (!usedSeats.has(i)) {
          chosen.push(i);
        }
      }
      if (chosen.length === 0) {
        return null;
      }
      for (const s of chosen) {
        usedSeats.add(s);
      }
      return chosen[0];
    };

    const nextSeat = (): number | null => takePartySeats(1);

    return { usedSeats, nextSeat, takePartySeats };
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

  async update(id: string, data: any, author: string = 'Admin'): Promise<SeatingTableDTO> {
    return this.repo.transaction(async (txRepo) => {
      const client = txRepo.client;
      await this.validate(data);
      const processedData = await this.preSave(data, client, author);
      const updatedRecord = await txRepo.update(id, processedData);

      let repackedInvitationCodes: any[] | undefined = (updatedRecord as any)?.invitationCodes;

      if (
        processedData.capacity !== undefined &&
        typeof client?.invitationCode?.findMany === 'function'
      ) {
        const newCapacity = Number(processedData.capacity);
        const occupants = await client.invitationCode.findMany({
          where: { tableId: id },
          orderBy: { seatNumber: 'asc' },
        });

        if (Array.isArray(occupants) && occupants.length > 0) {
          const repackedSeats = repackTableSeatNumbers(
            occupants as InvitationCodeDTO[],
            newCapacity
          );
          const guestById = new Map<string, any>(occupants.map((g: any) => [g.id, g]));
          const updates: PlannedSeatUpdate[] = [];

          for (const occ of occupants) {
            const nextSeat = repackedSeats.get(occ.id) ?? occ.seatNumber ?? null;
            if (
              typeof nextSeat === 'number' &&
              nextSeat <= newCapacity &&
              occ.seatNumber !== nextSeat
            ) {
              updates.push({
                guestId: occ.id,
                tableId: id,
                seatNumber: nextSeat,
              });
            }
          }

          if (updates.length > 0) {
            await this.applyBatchSeatUpdates(
              client,
              updates,
              guestById,
              'repackSeats',
              author
            );
          }

          const updateLookup = new Map(updates.map((u) => [u.guestId, u.seatNumber]));
          repackedInvitationCodes = occupants
            .map((occ: any) => ({
              ...occ,
              seatNumber: updateLookup.has(occ.id) ? updateLookup.get(occ.id) : occ.seatNumber,
            }))
            .sort((a: any, b: any) => (a.seatNumber ?? 999) - (b.seatNumber ?? 999));
        }
      }

      const finalRecord: SeatingTableDTO =
        repackedInvitationCodes !== undefined
          ? ({ ...updatedRecord, invitationCodes: repackedInvitationCodes } as SeatingTableDTO)
          : updatedRecord;

      await this.createSnapshot((finalRecord as any).id || id, finalRecord, author, client);
      return finalRecord;
    });
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
      let resolvedSeatNumber: number | null = tableId ? (seatNumber ?? null) : null;

      if (tableId) {
        const table = await this.findTableWithOccupants(client, tableId);
        const existingAtTable = (table.invitationCodes || []).find(
          (ic: any) => ic.id === invitationCodeId
        );
        const targetGuest =
          existingAtTable || (await this.loadOptionalGuestById(client, invitationCodeId));

        const incomingHeadcount = targetGuest ? getGuestPartySize(targetGuest) : 1;

        // Check table capacity using party headcount, excluding the target guest if already assigned to this table
        const otherOccupants = this.filterOtherOccupantsAndAssertCapacity(
          table,
          new Set([invitationCodeId]),
          incomingHeadcount
        );

        if (resolvedSeatNumber && resolvedSeatNumber > table.capacity) {
          const tracker = this.createSeatTracker(otherOccupants, table.capacity);
          resolvedSeatNumber = tracker.takePartySeats(incomingHeadcount);
        } else if (resolvedSeatNumber === null && incomingHeadcount > 1) {
          const tracker = this.createSeatTracker(otherOccupants, table.capacity);
          resolvedSeatNumber = tracker.takePartySeats(incomingHeadcount);
        }

        // If seatNumber is specified, check if that seat is already taken by another guest
        if (resolvedSeatNumber) {
          const occupant = await client.invitationCode.findFirst({
            where: {
              tableId,
              seatNumber: resolvedSeatNumber,
              NOT: { id: invitationCodeId },
            },
          });
          if (occupant) {
            // Unassign occupant's explicit seat so seatLayout resolves both parties cleanly
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
          seatNumber: tableId ? resolvedSeatNumber : null,
        },
      });

      await createAuditSnapshot(
        'InvitationCode',
        invitationCodeId,
        { tableId, seatNumber: resolvedSeatNumber, action: 'assignSeat' },
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

        const incomingHeadcount = getGuestsHeadcount(targetGuests);
        const table = await this.findTableWithOccupants(client, tableId);
        const existingOtherOccupants = this.filterOtherOccupantsAndAssertCapacity(
          table,
          targetIdSet,
          incomingHeadcount
        );
        const { takePartySeats } = this.createSeatTracker(
          existingOtherOccupants,
          table.capacity
        );

        for (const guestId of uniqueIds) {
          const existing = guestById.get(guestId);
          const partySize = existing ? getGuestPartySize(existing) : 1;
          const preferredSeat =
            existing?.tableId === tableId &&
            typeof existing.seatNumber === 'number' &&
            existing.seatNumber >= 1 &&
            existing.seatNumber <= table.capacity
              ? existing.seatNumber
              : null;

          const assignedSeat = takePartySeats(partySize, preferredSeat);

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
      const clampedEntrySeatMap = new Map<string, number | null>();

      if (targetTableIds.length > 0) {
        const tables = await client.seatingTable.findMany({
          where: { id: { in: targetTableIds } },
          include: { invitationCodes: true },
        });

        const tableMap = new Map<string, any>((tables || []).map((t: any) => [t.id, t]));

        for (const tid of targetTableIds) {
          const table = tableMap.get(tid);
          const incomingForTable = normalizedEntries.filter((e) => e.tableId === tid);
          const incomingHeadcount = incomingForTable.reduce((sum, entry) => {
            const guest = guestById.get(entry.invitationCodeId);
            return sum + (guest ? getGuestPartySize(guest) : 1);
          }, 0);

          const otherOccupants = this.filterOtherOccupantsAndAssertCapacity(
            table,
            batchIdSet,
            incomingHeadcount
          );

          const incomingSeats = new Set<number>();
          for (const e of incomingForTable) {
            const guest = guestById.get(e.invitationCodeId);
            const partySize = guest ? getGuestPartySize(guest) : 1;
            if (typeof e.seatNumber === 'number' && e.seatNumber >= 1 && e.seatNumber <= table.capacity) {
              for (let offset = 0; offset < partySize; offset++) {
                if (e.seatNumber + offset <= table.capacity) {
                  incomingSeats.add(e.seatNumber + offset);
                }
              }
            }
          }

          const remainingOccupants: TableOccupantRecord[] = [];
          for (const occ of otherOccupants) {
            if (typeof occ.seatNumber === 'number' && incomingSeats.has(occ.seatNumber)) {
              displacedSeatUpdates.push({
                guestId: occ.id,
                tableId: tid,
                seatNumber: null,
              });
              guestById.set(occ.id, occ);
              remainingOccupants.push({ ...occ, seatNumber: null });
            } else {
              remainingOccupants.push(occ);
            }
          }

          const tracker = this.createSeatTracker(remainingOccupants, table.capacity);
          for (const e of incomingForTable) {
            const guest = guestById.get(e.invitationCodeId);
            const partySize = guest ? getGuestPartySize(guest) : 1;
            if (typeof e.seatNumber === 'number' && e.seatNumber >= 1 && e.seatNumber <= table.capacity) {
              const reserved = tracker.takePartySeats(partySize, e.seatNumber);
              clampedEntrySeatMap.set(e.invitationCodeId, reserved);
            } else if (typeof e.seatNumber === 'number' && e.seatNumber > table.capacity) {
              const reserved = tracker.takePartySeats(partySize);
              clampedEntrySeatMap.set(e.invitationCodeId, reserved);
            } else {
              clampedEntrySeatMap.set(e.invitationCodeId, e.seatNumber);
            }
          }
        }
      }

      const allUpdates: PlannedSeatUpdate[] = [
        ...displacedSeatUpdates,
        ...normalizedEntries.map((e) => ({
          guestId: e.invitationCodeId,
          tableId: e.tableId,
          seatNumber: clampedEntrySeatMap.has(e.invitationCodeId)
            ? clampedEntrySeatMap.get(e.invitationCodeId)!
            : e.seatNumber,
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

      // Precompute party headcount per InvitationCode in O(G)
      const partySizeById = new Map<string, number>();
      for (const guest of unassignedGuests) {
        partySizeById.set(guest.id, getGuestPartySize(guest));
      }

      // Initialize table tracking state accounting for existing party headcounts
      interface TableState {
        id: string;
        name: string;
        capacity: number;
        remainingCapacity: number;
        takePartySeats: (partySize: number) => number | null;
      }

      const tableStates: TableState[] = (tables || []).map((t: any) => {
        const occupants = t.invitationCodes || [];
        const capacity = Number(t.capacity) || 0;
        const { takePartySeats } = this.createSeatTracker(occupants, capacity);
        const occupiedHeadcount = getGuestsHeadcount(occupants);
        const remainingCapacity = Math.max(0, capacity - occupiedHeadcount);

        return {
          id: t.id,
          name: t.name,
          capacity,
          remainingCapacity,
          takePartySeats,
        };
      });

      interface HouseholdBucket {
        members: any[];
        headcount: number;
        sortLabel: string;
      }

      // Group unassigned guests by householdName
      const householdMap = new Map<string, HouseholdBucket>();
      let soloCounter = 0;

      for (const guest of unassignedGuests) {
        const guestHeadcount = partySizeById.get(guest.id) || 1;
        const household =
          guest.householdName && typeof guest.householdName === 'string'
            ? guest.householdName.trim()
            : '';

        if (household) {
          const existing = householdMap.get(household);
          if (existing) {
            existing.members.push(guest);
            existing.headcount += guestHeadcount;
          } else {
            householdMap.set(household, {
              members: [guest],
              headcount: guestHeadcount,
              sortLabel: household,
            });
          }
        } else {
          soloCounter++;
          householdMap.set(`__solo_${guest.id || soloCounter}__`, {
            members: [guest],
            headcount: guestHeadcount,
            sortLabel: guest.guestName || '',
          });
        }
      }

      // Sort household groups in descending order of total attendee headcount for Best-Fit Decreasing
      const sortedGroups = Array.from(householdMap.values()).sort((a, b) => {
        if (b.headcount !== a.headcount) {
          return b.headcount - a.headcount;
        }
        return a.sortLabel.localeCompare(b.sortLabel);
      });

      const plannedAssignments: PlannedSeatUpdate[] = [];
      const unplacedGroups: HouseholdBucket[] = [];

      // Phase 1: Intact Household Placement (Best-Fit Decreasing by total party headcount)
      for (const bucket of sortedGroups) {
        const groupHeadcount = bucket.headcount;

        let bestTable: TableState | null = null;
        let bestDiff = Infinity;
        for (let i = 0; i < tableStates.length; i++) {
          const candidate = tableStates[i];
          if (candidate.remainingCapacity >= groupHeadcount) {
            const diff = candidate.remainingCapacity - groupHeadcount;
            if (
              diff < bestDiff ||
              (diff === bestDiff &&
                bestTable !== null &&
                candidate.name.localeCompare(bestTable.name) < 0)
            ) {
              bestDiff = diff;
              bestTable = candidate;
            }
          }
        }

        if (bestTable) {
          for (const guest of bucket.members) {
            const guestHeadcount = partySizeById.get(guest.id) || 1;
            const seatNumber = bestTable.takePartySeats(guestHeadcount);
            bestTable.remainingCapacity -= guestHeadcount;
            plannedAssignments.push({
              guestId: guest.id,
              tableId: bestTable.id,
              seatNumber,
            });
          }
        } else {
          unplacedGroups.push(bucket);
        }
      }

      // Phase 2: Split multi-invitation household groups across open tables,
      // NEVER splitting an individual InvitationCode party across separate tables.
      if (unplacedGroups.length > 0) {
        for (const bucket of unplacedGroups) {
          for (const guest of bucket.members) {
            const guestHeadcount = partySizeById.get(guest.id) || 1;

            let bestTable: TableState | null = null;
            for (let i = 0; i < tableStates.length; i++) {
              const candidate = tableStates[i];
              if (candidate.remainingCapacity >= guestHeadcount) {
                if (
                  bestTable === null ||
                  candidate.remainingCapacity > bestTable.remainingCapacity ||
                  (candidate.remainingCapacity === bestTable.remainingCapacity &&
                    candidate.name.localeCompare(bestTable.name) < 0)
                ) {
                  bestTable = candidate;
                }
              }
            }

            if (!bestTable) {
              continue;
            }

            const seatNumber = bestTable.takePartySeats(guestHeadcount);
            bestTable.remainingCapacity -= guestHeadcount;
            plannedAssignments.push({
              guestId: guest.id,
              tableId: bestTable.id,
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

      const totalPoolHeadcount = getGuestsHeadcount(unassignedGuests);
      const assignedCount = updatedGuests.reduce(
        (sum: number, g: any) => sum + (partySizeById.get(g.id) || getGuestPartySize(g)),
        0
      );
      const unassignedCount = Math.max(0, totalPoolHeadcount - assignedCount);

      return {
        assignedCount,
        unassignedCount,
        assignedGuests: updatedGuests,
      };
    });
  }
}
