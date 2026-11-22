import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { SeatingTableDTO, AutoAssignResultDTO } from './schemas';
import { createAuditSnapshot, createBatchAuditSnapshots } from '@/lib/audit';
import { Prisma } from '@prisma/client';
import { resolveSeatAssignments } from './seatLayout';
import {
  ADDRESS_COLLECTION_TAG,
  ALL_SEATING_TABLE_SHAPES,
  getAttendingPlusOneCount,
  getDefaultShapeDimensions,
  getGuestAttendanceStatus,
  getRequiredChairCount,
  getTableOccupiedChairCount,
  isGuestEligibleForSeating,
  isLandmarkTable,
  isLandmarkTableShape,
} from './utils/seatingHelpers';

type BatchSeatAuditAction = 'assignBatch' | 'clearTable' | 'undo' | 'autoAssign';

interface PlannedSeatUpdate {
  guestId: string;
  tableId: string | null;
  seatNumber: number | null;
  plusOneSeatNumbers: number[];
}

interface SeatTracker {
  usedSeats: Set<number>;
  nextSeat: () => number | null;
}

interface TableOccupantRecord {
  id: string;
  seatNumber?: number | null;
  plusOneSeatNumbers?: number[] | null;
  [key: string]: unknown;
}

export interface AutoAssignOptions {
  includePending?: boolean;
  keepHouseholdsIntact?: boolean;
  partyGroup?: string;
  partyTags?: string[];
}

function extractNormalizedPartyGroup(guest: Record<string, unknown>): string | null {
  if (typeof guest.partyGroup !== 'string') return null;
  const trimmed = guest.partyGroup.trim().toLowerCase();
  return trimmed || null;
}

function extractNormalizedPartyTags(guest: Record<string, unknown>): string[] {
  if (!Array.isArray(guest.partyTags)) return [];
  const tags: string[] = [];
  for (const raw of guest.partyTags) {
    if (typeof raw !== 'string') continue;
    const normalized = raw.trim().toLowerCase();
    if (!normalized || normalized === ADDRESS_COLLECTION_TAG) continue;
    if (!tags.includes(normalized)) {
      tags.push(normalized);
    }
  }
  return tags.sort();
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
      | {
        name: string;
        shape?: string | null;
        capacity: number;
        invitationCodes?: TableOccupantRecord[] | null;
      }
      | null
      | undefined,
    excludedGuestIds: Set<string>,
    incomingChairCount: number
  ): TableOccupantRecord[] {
    if (!table) {
      throw new Error('Validation Error: Table not found.');
    }

    if (isLandmarkTable(table)) {
      throw new Error(
        `Validation Error: Cannot assign guests to landmark "${table.name}".`
      );
    }

    const otherOccupants = (table.invitationCodes || []).filter(
      (ic) => !excludedGuestIds.has(ic.id)
    );
    const occupiedChairs = getTableOccupiedChairCount(otherOccupants);

    if (occupiedChairs + incomingChairCount > table.capacity) {
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
    const resolved = resolveSeatAssignments(occupants as any, capacity);
    const usedSeats = new Set<number>(resolved.keys());

    for (const occ of occupants || []) {
      if (typeof occ.seatNumber === 'number' && occ.seatNumber > 0) {
        usedSeats.add(occ.seatNumber);
      }
      if (Array.isArray(occ.plusOneSeatNumbers)) {
        for (const s of occ.plusOneSeatNumbers) {
          if (typeof s === 'number' && s > 0) {
            usedSeats.add(s);
          }
        }
      }
    }

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
      const plusOneArraySql =
        item.plusOneSeatNumbers.length > 0
          ? Prisma.sql`ARRAY[${Prisma.join(
            item.plusOneSeatNumbers.map((s) => Prisma.sql`${s}::integer`),
            ', '
          )}]::integer[]`
          : Prisma.sql`ARRAY[]::integer[]`;

      return Prisma.sql`(${item.guestId}::text, ${item.tableId}::text, ${item.seatNumber}::integer, ${plusOneArraySql})`;
    });
    const values = Prisma.join(rows, ', ');

    const bulkUpdateQuery = Prisma.sql`
      UPDATE "InvitationCode" AS t
      SET
        "tableId" = v."tableId",
        "seatNumber" = v."seatNumber",
        "plusOneSeatNumbers" = v."plusOneSeatNumbers",
        "updatedAt" = NOW()
      FROM (VALUES ${values}) AS v(
        "id",
        "tableId",
        "seatNumber",
        "plusOneSeatNumbers"
      )
      WHERE t."id" = v."id"
    `;

    await client.$executeRaw(bulkUpdateQuery);

    const auditRecords = updates.map((item) => ({
      entityId: item.guestId,
      data: {
        tableId: item.tableId,
        seatNumber: item.seatNumber,
        ...(item.plusOneSeatNumbers.length > 0
          ? { plusOneSeatNumbers: item.plusOneSeatNumbers }
          : {}),
        action: actionLabel,
      },
    }));

    await createBatchAuditSnapshots('InvitationCode', auditRecords, author, client);

    return updates.map((item) => ({
      ...(guestById.get(item.guestId) || {}),
      id: item.guestId,
      tableId: item.tableId,
      seatNumber: item.seatNumber,
      plusOneSeatNumbers: item.plusOneSeatNumbers,
    }));
  }

  protected async validate(data: any): Promise<void> {
    if (data.name !== undefined) {
      if (typeof data.name !== 'string' || data.name.trim() === '') {
        throw new Error('Validation Error: Table name is required.');
      }
    }
    if (data.shape !== undefined) {
      if (!(ALL_SEATING_TABLE_SHAPES as readonly string[]).includes(data.shape)) {
        throw new Error(
          'Validation Error: Shape must be round, rectangular, square, head, or sweetheart. Landmark shapes (dance-floor, bar, dj, buffet, cake) are also supported.'
        );
      }
    }
    const isLandmark = isLandmarkTableShape(data.shape);
    if (data.capacity !== undefined) {
      const cap = Number(data.capacity);
      if (isLandmark) {
        if (isNaN(cap) || cap !== 0) {
          throw new Error('Validation Error: Landmarks must have 0 capacity.');
        }
      } else if (isNaN(cap) || cap < 1) {
        throw new Error('Validation Error: Capacity must be at least 1.');
      }
    }
  }

  protected async preSave(data: any, _client?: any, _author?: string): Promise<any> {
    const processed = { ...data };
    if (processed.name && typeof processed.name === 'string') {
      processed.name = processed.name.trim();
    }
    if (isLandmarkTableShape(processed.shape)) {
      processed.capacity = 0;
      const defaults = getDefaultShapeDimensions(processed.shape);
      if (processed.width === undefined) processed.width = defaults.width;
      if (processed.height === undefined) processed.height = defaults.height;
    } else if (processed.capacity !== undefined) {
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
      const existingAtTable = await txRepo.client.invitationCode.findMany?.({
        where: { tableId: id },
      });
      const hasPlusOneSeats =
        Array.isArray(existingAtTable) &&
        existingAtTable.some(
          (g: any) => Array.isArray(g?.plusOneSeatNumbers) && g.plusOneSeatNumbers.length > 0
        );

      await txRepo.client.invitationCode.updateMany({
        where: { tableId: id },
        data: hasPlusOneSeats
          ? { tableId: null, seatNumber: null, plusOneSeatNumbers: [] }
          : { tableId: null, seatNumber: null },
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
      const foundGuests = await client.invitationCode.findMany?.({
        where: { id: { in: [invitationCodeId] } },
      });
      let targetGuest = Array.isArray(foundGuests) ? foundGuests[0] : undefined;

      if (tableId) {
        const table = await this.findTableWithOccupants(client, tableId);
        if (!targetGuest && Array.isArray(table.invitationCodes)) {
          targetGuest = table.invitationCodes.find((ic: any) => ic.id === invitationCodeId);
        }

        const plusOneCount = targetGuest ? getAttendingPlusOneCount(targetGuest) : 0;
        const requiredChairs = 1 + plusOneCount;

        const otherOccupants = this.filterOtherOccupantsAndAssertCapacity(
          table,
          new Set([invitationCodeId]),
          requiredChairs
        );

        let effectiveOccupants = otherOccupants;

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
            await client.invitationCode.update({
              where: { id: occupant.id },
              data: { seatNumber: null },
            });
            effectiveOccupants = otherOccupants.map((occ) =>
              occ.id === occupant.id ? { ...occ, seatNumber: null } : occ
            );
          }
        }

        const hadPlusOneSeats =
          Array.isArray(targetGuest?.plusOneSeatNumbers) &&
          targetGuest.plusOneSeatNumbers.length > 0;

        let resolvedPrimarySeat: number | null = seatNumber ?? null;
        let resolvedPlusOneSeats: number[] | undefined;

        if (plusOneCount > 0) {
          const { usedSeats, nextSeat } = this.createSeatTracker(
            effectiveOccupants,
            table.capacity
          );

          if (
            typeof resolvedPrimarySeat === 'number' &&
            resolvedPrimarySeat >= 1 &&
            resolvedPrimarySeat <= table.capacity &&
            !usedSeats.has(resolvedPrimarySeat)
          ) {
            usedSeats.add(resolvedPrimarySeat);
          } else {
            resolvedPrimarySeat = nextSeat();
          }

          resolvedPlusOneSeats = [];
          for (let i = 0; i < plusOneCount; i++) {
            const nextOpen = nextSeat();
            if (nextOpen !== null) {
              resolvedPlusOneSeats.push(nextOpen);
            }
          }
        } else if (hadPlusOneSeats) {
          resolvedPlusOneSeats = [];
        }

        const updateData: Record<string, unknown> = {
          tableId,
          seatNumber: resolvedPrimarySeat,
          ...(resolvedPlusOneSeats !== undefined
            ? { plusOneSeatNumbers: resolvedPlusOneSeats }
            : {}),
        };

        const updatedGuest = await client.invitationCode.update({
          where: { id: invitationCodeId },
          data: updateData,
        });

        await createAuditSnapshot(
          'InvitationCode',
          invitationCodeId,
          {
            tableId,
            seatNumber: resolvedPrimarySeat,
            ...(resolvedPlusOneSeats !== undefined
              ? { plusOneSeatNumbers: resolvedPlusOneSeats }
              : {}),
            action: 'assignSeat',
          },
          author,
          client
        );

        return updatedGuest;
      }

      const hadPlusOneSeats =
        Array.isArray(targetGuest?.plusOneSeatNumbers) &&
        targetGuest.plusOneSeatNumbers.length > 0;

      const updatedGuest = await client.invitationCode.update({
        where: { id: invitationCodeId },
        data: hadPlusOneSeats
          ? { tableId: null, seatNumber: null, plusOneSeatNumbers: [] }
          : { tableId: null, seatNumber: null },
      });

      await createAuditSnapshot(
        'InvitationCode',
        invitationCodeId,
        { tableId: null, seatNumber: null, action: 'assignSeat' },
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
        let totalIncomingChairs = 0;
        for (const guest of targetGuests) {
          if (!isGuestEligibleForSeating(guest)) {
            throw new Error(
              'Validation Error: Declined RSVPs and address-collection entries cannot be assigned to tables.'
            );
          }
          totalIncomingChairs += getRequiredChairCount(guest);
        }

        const table = await this.findTableWithOccupants(client, tableId);
        const existingOtherOccupants = this.filterOtherOccupantsAndAssertCapacity(
          table,
          targetIdSet,
          totalIncomingChairs
        );
        const { usedSeats, nextSeat } = this.createSeatTracker(
          existingOtherOccupants,
          table.capacity
        );

        for (const guestId of uniqueIds) {
          const existing = guestById.get(guestId);
          const plusOneCount = existing ? getAttendingPlusOneCount(existing) : 0;
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

          const assignedPlusOneSeats: number[] = [];
          const existingPlusOneSeats =
            existing?.tableId === tableId && Array.isArray(existing.plusOneSeatNumbers)
              ? existing.plusOneSeatNumbers
              : [];

          for (let i = 0; i < plusOneCount; i++) {
            const candidate = existingPlusOneSeats[i];
            if (
              typeof candidate === 'number' &&
              candidate >= 1 &&
              candidate <= table.capacity &&
              !usedSeats.has(candidate)
            ) {
              usedSeats.add(candidate);
              assignedPlusOneSeats.push(candidate);
            } else {
              const nextOpen = nextSeat();
              if (nextOpen !== null) {
                assignedPlusOneSeats.push(nextOpen);
              }
            }
          }

          plannedUpdates.push({
            guestId,
            tableId,
            seatNumber: assignedSeat,
            plusOneSeatNumbers: assignedPlusOneSeats,
          });
        }
      } else {
        for (const guestId of uniqueIds) {
          plannedUpdates.push({
            guestId,
            tableId: null,
            seatNumber: null,
            plusOneSeatNumbers: [],
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
      plusOneSeatNumbers?: number[];
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
      {
        invitationCodeId: string;
        tableId: string | null;
        seatNumber: number | null;
        plusOneSeatNumbers: number[];
      }
    >();
    for (const entry of assignments) {
      const id = entry.invitationCodeId?.trim();
      if (!id) continue;
      const normalizedTableId = entry.tableId || null;
      dedupedMap.set(id, {
        invitationCodeId: id,
        tableId: normalizedTableId,
        seatNumber: normalizedTableId ? (entry.seatNumber ?? null) : null,
        plusOneSeatNumbers:
          normalizedTableId && Array.isArray(entry.plusOneSeatNumbers)
            ? entry.plusOneSeatNumbers
            : [],
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
          const incomingChairs = incomingForTable.reduce((sum, entry) => {
            const guest = guestById.get(entry.invitationCodeId);
            return sum + (guest ? getRequiredChairCount(guest) : 1);
          }, 0);

          const otherOccupants = this.filterOtherOccupantsAndAssertCapacity(
            table,
            batchIdSet,
            incomingChairs
          );

          const incomingSeats = new Set<number>();
          for (const e of incomingForTable) {
            if (typeof e.seatNumber === 'number' && e.seatNumber > 0) {
              incomingSeats.add(e.seatNumber);
            }
            for (const ps of e.plusOneSeatNumbers) {
              if (typeof ps === 'number' && ps > 0) {
                incomingSeats.add(ps);
              }
            }
          }

          for (const occ of otherOccupants) {
            const primaryCollides =
              typeof occ.seatNumber === 'number' && incomingSeats.has(occ.seatNumber);
            const plusOnes = Array.isArray(occ.plusOneSeatNumbers)
              ? occ.plusOneSeatNumbers
              : [];
            const plusOneCollides = plusOnes.some(
              (ps) => typeof ps === 'number' && incomingSeats.has(ps)
            );
            if (primaryCollides || plusOneCollides) {
              displacedSeatUpdates.push({
                guestId: occ.id,
                tableId: tid,
                seatNumber: primaryCollides ? null : (occ.seatNumber ?? null),
                plusOneSeatNumbers: plusOneCollides
                  ? plusOnes.filter((ps) => !incomingSeats.has(ps))
                  : plusOnes,
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
          plusOneSeatNumbers: e.plusOneSeatNumbers,
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
    options?: AutoAssignOptions
  ): Promise<AutoAssignResultDTO> {
    const includePending = options?.includePending ?? true;
    const keepHouseholdsIntact = options?.keepHouseholdsIntact ?? false;
    const filterGroup = options?.partyGroup?.trim().toLowerCase() || null;
    const filterTags =
      options?.partyTags && options.partyTags.length > 0
        ? new Set(options.partyTags.map((t) => t.trim().toLowerCase()).filter(Boolean))
        : null;

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

      // 2. Query all unassigned invitation codes and filter out ineligible/filtered entries
      const rawUnassignedGuests = await client.invitationCode.findMany({
        where: { tableId: null },
        orderBy: [{ householdName: 'asc' }, { guestName: 'asc' }],
      });

      const unassignedGuests = (rawUnassignedGuests || []).filter((guest: any) => {
        if (!isGuestEligibleForSeating(guest)) {
          return false;
        }
        if (!includePending && getGuestAttendanceStatus(guest) !== 'attending') {
          return false;
        }
        if (filterGroup && extractNormalizedPartyGroup(guest) !== filterGroup) {
          return false;
        }
        if (filterTags) {
          const gTags = extractNormalizedPartyTags(guest);
          if (!gTags.some((t) => filterTags.has(t))) {
            return false;
          }
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

      // Initialize seating table tracking state (skipping zero-capacity landmarks)
      interface TableState {
        id: string;
        name: string;
        capacity: number;
        remainingCapacity: number;
        usedSeats: Set<number>;
        nextSeat: () => number | null;
        groups: Set<string>;
        tags: Set<string>;
      }

      const tableStates: TableState[] = (tables || [])
        .filter((t: any) => !isLandmarkTable(t) && Number(t.capacity) > 0)
        .map((t: any) => {
          const occupants: any[] = (t.invitationCodes || []).filter((g: any) =>
            isGuestEligibleForSeating(g)
          );
          const capacity = Number(t.capacity) || 0;
          const { usedSeats, nextSeat } = this.createSeatTracker(occupants, capacity);
          const occupiedChairs = getTableOccupiedChairCount(occupants);
          const remainingCapacity = Math.max(0, capacity - occupiedChairs);

          const groups = new Set<string>();
          const tags = new Set<string>();
          for (const occ of occupants) {
            const pg = extractNormalizedPartyGroup(occ);
            if (pg) groups.add(pg);
            for (const tag of extractNormalizedPartyTags(occ)) {
              tags.add(tag);
            }
          }

          return {
            id: t.id,
            name: t.name,
            capacity,
            remainingCapacity,
            usedSeats,
            nextSeat,
            groups,
            tags,
          };
        });

      interface HouseholdUnit {
        key: string;
        isNamedHousehold: boolean;
        guests: any[];
        totalChairs: number;
        groups: string[];
        tags: string[];
        clusterKey: string;
      }

      const householdMap = new Map<string, any[]>();
      let soloCounter = 0;

      for (const guest of unassignedGuests) {
        const household =
          guest.householdName && typeof guest.householdName === 'string'
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

      const householdUnits: HouseholdUnit[] = Array.from(householdMap.entries()).map(
        ([key, guests]) => {
          const groupSet = new Set<string>();
          const tagSet = new Set<string>();
          let totalChairs = 0;

          for (const g of guests) {
            totalChairs += getRequiredChairCount(g);
            const pg = extractNormalizedPartyGroup(g);
            if (pg) groupSet.add(pg);
            for (const tag of extractNormalizedPartyTags(g)) {
              tagSet.add(tag);
            }
          }

          const groups = Array.from(groupSet).sort();
          const tags = Array.from(tagSet).sort();
          const clusterKey =
            groups.length > 0
              ? `group:${groups[0]}`
              : tags.length > 0
                ? `tag:${tags[0]}`
                : '';

          return {
            key,
            isNamedHousehold: !key.startsWith('__solo_'),
            guests,
            totalChairs,
            groups,
            tags,
            clusterKey,
          };
        }
      );

      const plannedAssignments: PlannedSeatUpdate[] = [];

      const computeAffinityScore = (
        table: TableState,
        groups: string[],
        tags: string[]
      ): number => {
        let score = 0;
        for (const g of groups) {
          if (table.groups.has(g)) score += 200;
        }
        for (const tag of tags) {
          if (table.tags.has(tag)) score += 100;
        }
        return score;
      };

      const seatGuestAtTable = (guest: any, chosenTable: TableState) => {
        const plusOneCount = getAttendingPlusOneCount(guest);
        const requiredChairs = 1 + plusOneCount;
        const seatNumber = chosenTable.nextSeat();
        const plusOneSeatNumbers: number[] = [];
        for (let i = 0; i < plusOneCount; i++) {
          const ps = chosenTable.nextSeat();
          if (ps !== null) {
            plusOneSeatNumbers.push(ps);
          }
        }
        chosenTable.remainingCapacity -= requiredChairs;

        const pg = extractNormalizedPartyGroup(guest);
        if (pg) chosenTable.groups.add(pg);
        for (const tag of extractNormalizedPartyTags(guest)) {
          chosenTable.tags.add(tag);
        }

        plannedAssignments.push({
          guestId: guest.id,
          tableId: chosenTable.id,
          seatNumber,
          plusOneSeatNumbers,
        });
      };

      // Group HouseholdUnits by non-empty affinity cluster (`partyGroup` / `partyTags`) so
      // multi-unit friend/family/tag clusters pack together onto shared tables first when possible.
      const clusterBuckets = new Map<string, HouseholdUnit[]>();
      const remainingUnits: HouseholdUnit[] = [];

      for (const unit of householdUnits) {
        if (unit.clusterKey) {
          if (!clusterBuckets.has(unit.clusterKey)) {
            clusterBuckets.set(unit.clusterKey, []);
          }
          clusterBuckets.get(unit.clusterKey)!.push(unit);
        } else {
          remainingUnits.push(unit);
        }
      }

      const sortedClusters = Array.from(clusterBuckets.entries()).sort((a, b) => {
        const chairsA = a[1].reduce((s, u) => s + u.totalChairs, 0);
        const chairsB = b[1].reduce((s, u) => s + u.totalChairs, 0);
        if (chairsB !== chairsA) return chairsB - chairsA;
        return a[0].localeCompare(b[0]);
      });

      for (const [, clusterUnits] of sortedClusters) {
        const clusterTotalChairs = clusterUnits.reduce((s, u) => s + u.totalChairs, 0);
        if (clusterUnits.length > 1) {
          const allGroups = Array.from(new Set(clusterUnits.flatMap((u) => u.groups)));
          const allTags = Array.from(new Set(clusterUnits.flatMap((u) => u.tags)));
          const eligibleClusterTables = tableStates.filter(
            (t) => t.remainingCapacity >= clusterTotalChairs
          );

          if (eligibleClusterTables.length > 0) {
            eligibleClusterTables.sort((a, b) => {
              const affDiff =
                computeAffinityScore(b, allGroups, allTags) -
                computeAffinityScore(a, allGroups, allTags);
              if (affDiff !== 0) return affDiff;
              const diffA = a.remainingCapacity - clusterTotalChairs;
              const diffB = b.remainingCapacity - clusterTotalChairs;
              if (diffA !== diffB) return diffA - diffB;
              return a.name.localeCompare(b.name);
            });

            const chosenTable = eligibleClusterTables[0];
            for (const unit of clusterUnits) {
              for (const guest of unit.guests) {
                seatGuestAtTable(guest, chosenTable);
              }
            }
            continue;
          }
        }

        remainingUnits.push(...clusterUnits);
      }

      // Sort remaining HouseholdUnits in descending order of required chairs (Best-Fit Decreasing + Affinity)
      remainingUnits.sort((a, b) => {
        if (b.totalChairs !== a.totalChairs) {
          return b.totalChairs - a.totalChairs;
        }
        if (a.clusterKey !== b.clusterKey) {
          return b.clusterKey.localeCompare(a.clusterKey);
        }
        const nameA = a.guests[0]?.householdName || a.guests[0]?.guestName || '';
        const nameB = b.guests[0]?.householdName || b.guests[0]?.guestName || '';
        return nameA.localeCompare(nameB);
      });

      const unplacedUnits: HouseholdUnit[] = [];

      // Phase 1: Intact Household Placement (Affinity-Aware Best-Fit Decreasing)
      for (const unit of remainingUnits) {
        const eligibleTables = tableStates.filter(
          (t) => t.remainingCapacity >= unit.totalChairs
        );

        if (eligibleTables.length > 0) {
          eligibleTables.sort((a, b) => {
            const affDiff =
              computeAffinityScore(b, unit.groups, unit.tags) -
              computeAffinityScore(a, unit.groups, unit.tags);
            if (affDiff !== 0) return affDiff;
            const diffA = a.remainingCapacity - unit.totalChairs;
            const diffB = b.remainingCapacity - unit.totalChairs;
            if (diffA !== diffB) return diffA - diffB;
            return a.name.localeCompare(b.name);
          });

          const chosenTable = eligibleTables[0];
          for (const guest of unit.guests) {
            seatGuestAtTable(guest, chosenTable);
          }
        } else {
          unplacedUnits.push(unit);
        }
      }

      // Phase 2: Split Oversized Households Across Open Tables (unless keepHouseholdsIntact is enabled)
      if (unplacedUnits.length > 0) {
        for (const unit of unplacedUnits) {
          if (keepHouseholdsIntact && unit.isNamedHousehold && unit.guests.length > 1) {
            continue;
          }

          for (const guest of unit.guests) {
            const requiredChairs = getRequiredChairCount(guest);
            const gGroup = extractNormalizedPartyGroup(guest);
            const gGroups = gGroup ? [gGroup] : [];
            const gTags = extractNormalizedPartyTags(guest);

            const availableTables = tableStates.filter(
              (t) => t.remainingCapacity >= requiredChairs
            );
            if (availableTables.length === 0) {
              continue;
            }

            availableTables.sort((a, b) => {
              const affDiff =
                computeAffinityScore(b, gGroups, gTags) -
                computeAffinityScore(a, gGroups, gTags);
              if (affDiff !== 0) return affDiff;
              if (b.remainingCapacity !== a.remainingCapacity) {
                return b.remainingCapacity - a.remainingCapacity;
              }
              return a.name.localeCompare(b.name);
            });

            seatGuestAtTable(guest, availableTables[0]);
          }
        }
      }

      // Execute single batch raw SQL update and bulk audit snapshot inside transaction
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
