import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { SeatingTableDTO, AutoAssignResultDTO } from './schemas';
import { createAuditSnapshot, createBatchAuditSnapshots } from '@/lib/audit';
import { qualifyPostgresTable } from '@/lib/postgres-url.js';
import { Prisma } from '@prisma/client';
import { InvitationCodeDTO } from '@/features/registry';
import {
  repackTableSeatNumbers,
  resolveDetailedSeatAssignments,
} from './seatLayout';
import {
  ADDRESS_COLLECTION_TAG,
  ALL_SEATING_TABLE_SHAPES,
  getDefaultShapeDimensions,
  getGuestAttendanceStatus,
  getGuestPartySize,
  getGuestsHeadcount,
  isGuestEligibleForSeating,
  isLandmarkTable,
  isLandmarkTableShape,
} from './utils/seatingHelpers';

type BatchSeatAuditAction = 'assignBatch' | 'clearTable' | 'undo' | 'autoAssign' | 'repackSeats';

interface PlannedSeatUpdate {
  guestId: string;
  tableId: string | null;
  seatNumber: number | null;
  plusOneSeatNumbers: number[];
}

interface PartySeatAllocation {
  primarySeat: number | null;
  plusOneSeats: number[];
}

interface SeatTracker {
  usedSeats: Set<number>;
  nextSeat: () => number | null;
  takePartySeats: (partySize: number, preferredStartSeat?: number | null) => number | null;
  allocatePartySeats: (
    partySize: number,
    preferredStartSeat?: number | null,
    preferredPlusOneSeats?: number[]
  ) => PartySeatAllocation;
}

interface TableOccupantRecord {
  id: string;
  guestName?: string | null;
  seatNumber?: number | null;
  plusOneSeatNumbers?: number[] | null;
  used?: boolean | null;
  extraFields?: unknown;
  partyTags?: unknown;
  plusOneAllocations?: number | null;
  plusOneFirstName?: string | null;
  plusOneLastName?: string | null;
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
  return tags;
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
      if (found && (!found.id || found.id === guestId)) return found;
    }
    if (typeof client?.invitationCode?.findMany === 'function') {
      const rows = await client.invitationCode.findMany({ where: { id: { in: [guestId] } } });
      if (Array.isArray(rows) && rows.length > 0) {
        const matched = rows.find((r: any) => r?.id === guestId);
        if (matched) return matched;
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
      | {
        name: string;
        shape?: string | null;
        capacity: number;
        invitationCodes?: TableOccupantRecord[] | null;
      }
      | null
      | undefined,
    excludedGuestIds: Set<string>,
    incomingHeadcount: number
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

      for (const occ of occupants) {
        if (
          typeof occ.seatNumber === 'number' &&
          occ.seatNumber >= 1 &&
          occ.seatNumber <= safeCap
        ) {
          usedSeats.add(occ.seatNumber);
        }
        if (Array.isArray(occ.plusOneSeatNumbers)) {
          for (const s of occ.plusOneSeatNumbers) {
            if (typeof s === 'number' && s >= 1 && s <= safeCap) {
              usedSeats.add(s);
            }
          }
        }
      }
    }

    const allocatePartySeats = (
      rawPartySize: number,
      preferredStartSeat?: number | null,
      preferredPlusOneSeats?: number[]
    ): PartySeatAllocation => {
      const partySize = Math.max(1, Math.floor(rawPartySize || 1));
      const plusOneCount = partySize - 1;

      // 1. Honor preferredStartSeat if valid in 1..safeCap
      if (
        typeof preferredStartSeat === 'number' &&
        Number.isInteger(preferredStartSeat) &&
        preferredStartSeat >= 1 &&
        preferredStartSeat <= safeCap &&
        !usedSeats.has(preferredStartSeat)
      ) {
        if (Array.isArray(preferredPlusOneSeats) && preferredPlusOneSeats.length >= plusOneCount) {
          const validPreferredCompanions: number[] = [];
          const candidateSet = new Set<number>([preferredStartSeat]);
          for (const s of preferredPlusOneSeats) {
            if (
              validPreferredCompanions.length < plusOneCount &&
              typeof s === 'number' &&
              Number.isInteger(s) &&
              s >= 1 &&
              s <= safeCap &&
              !usedSeats.has(s) &&
              !candidateSet.has(s)
            ) {
              candidateSet.add(s);
              validPreferredCompanions.push(s);
            }
          }
          if (validPreferredCompanions.length === plusOneCount) {
            usedSeats.add(preferredStartSeat);
            for (const s of validPreferredCompanions) usedSeats.add(s);
            return {
              primarySeat: preferredStartSeat,
              plusOneSeats: validPreferredCompanions,
            };
          }
        }

        if (preferredStartSeat + partySize - 1 <= safeCap) {
          let allFree = true;
          for (let offset = 0; offset < partySize; offset++) {
            if (usedSeats.has(preferredStartSeat + offset)) {
              allFree = false;
              break;
            }
          }
          if (allFree) {
            const plusOneSeats: number[] = [];
            usedSeats.add(preferredStartSeat);
            for (let offset = 1; offset < partySize; offset++) {
              const s = preferredStartSeat + offset;
              usedSeats.add(s);
              plusOneSeats.push(s);
            }
            return { primarySeat: preferredStartSeat, plusOneSeats };
          }
        }

        // Claim preferred primary seat and fill remaining companions from open seats
        const openSeats: number[] = [];
        for (let s = 1; s <= safeCap && openSeats.length < plusOneCount; s++) {
          if (s !== preferredStartSeat && !usedSeats.has(s)) {
            openSeats.push(s);
          }
        }
        if (openSeats.length === plusOneCount) {
          usedSeats.add(preferredStartSeat);
          for (const s of openSeats) usedSeats.add(s);
          return { primarySeat: preferredStartSeat, plusOneSeats: openSeats };
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
            const plusOneSeats: number[] = [];
            usedSeats.add(start);
            for (let offset = 1; offset < partySize; offset++) {
              const s = start + offset;
              usedSeats.add(s);
              plusOneSeats.push(s);
            }
            return { primarySeat: start, plusOneSeats };
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
        return { primarySeat: null, plusOneSeats: [] };
      }
      for (const s of chosen) {
        usedSeats.add(s);
      }
      return {
        primarySeat: chosen[0],
        plusOneSeats: chosen.slice(1),
      };
    };

    const takePartySeats = (
      rawPartySize: number,
      preferredStartSeat?: number | null
    ): number | null => allocatePartySeats(rawPartySize, preferredStartSeat).primarySeat;

    const nextSeat = (): number | null => allocatePartySeats(1).primarySeat;

    return { usedSeats, nextSeat, takePartySeats, allocatePartySeats };
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
    const invitationCodeTable = Prisma.raw(qualifyPostgresTable('InvitationCode'));

    const bulkUpdateQuery = Prisma.sql`
      UPDATE ${invitationCodeTable} AS t
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

  async update(id: string, data: any, author: string = 'Admin'): Promise<SeatingTableDTO> {
    return this.repo.transaction(async (txRepo) => {
      const client = txRepo.client;
      await this.validate(data);
      const processedData = await this.preSave(data, client, author);
      const updatedRecord = await txRepo.update(id, processedData);

      let repackedInvitationCodes: any[] | undefined = (updatedRecord as any)?.invitationCodes;

      if (
        processedData.capacity !== undefined &&
        !isLandmarkTableShape(processedData.shape) &&
        Number(processedData.capacity) > 0
      ) {
        const newCapacity = Number(processedData.capacity);
        const queriedOccupants =
          typeof client?.invitationCode?.findMany === 'function'
            ? await client.invitationCode.findMany({
              where: { tableId: id },
              orderBy: { seatNumber: 'asc' },
            })
            : undefined;
        const occupants =
          Array.isArray(queriedOccupants) &&
          (queriedOccupants.length === 0
            ? !Array.isArray(repackedInvitationCodes)
            : queriedOccupants.every((o: any) => o?.tableId === id))
            ? queriedOccupants
            : repackedInvitationCodes;

        if (Array.isArray(occupants) && occupants.length > 0) {
          const repackedSeats = repackTableSeatNumbers(
            occupants as InvitationCodeDTO[],
            newCapacity
          );
          const guestById = new Map<string, any>(occupants.map((g: any) => [g.id, g]));
          const updates: PlannedSeatUpdate[] = [];

          for (const occ of occupants) {
            const nextSeat = repackedSeats.get(occ.id) ?? occ.seatNumber ?? null;
            const prevPlusOnes: number[] = Array.isArray(occ.plusOneSeatNumbers)
              ? occ.plusOneSeatNumbers
              : [];
            const clampedPlusOnes = prevPlusOnes.filter(
              (s: number) => typeof s === 'number' && s >= 1 && s <= newCapacity && s !== nextSeat
            );
            const plusOnesChanged = clampedPlusOnes.length !== prevPlusOnes.length;
            if (
              typeof nextSeat === 'number' &&
              nextSeat <= newCapacity &&
              (occ.seatNumber !== nextSeat || plusOnesChanged)
            ) {
              updates.push({
                guestId: occ.id,
                tableId: id,
                seatNumber: nextSeat,
                plusOneSeatNumbers: clampedPlusOnes,
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

          const updateLookup = new Map(updates.map((u) => [u.guestId, u]));
          repackedInvitationCodes = occupants
            .map((occ: any) => {
              const upd = updateLookup.get(occ.id);
              return upd
                ? {
                  ...occ,
                  seatNumber: upd.seatNumber,
                  ...(Array.isArray(occ.plusOneSeatNumbers)
                    ? { plusOneSeatNumbers: upd.plusOneSeatNumbers }
                    : {}),
                }
                : occ;
            })
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
      const existingAtTable = await txRepo.client.invitationCode.findMany?.({
        where: { tableId: id },
      });
      const hasPlusOneSeats =
        Array.isArray(existingAtTable) &&
        existingAtTable.some(
          (g: any) =>
            g?.tableId === id &&
            Array.isArray(g?.plusOneSeatNumbers) &&
            g.plusOneSeatNumbers.length > 0
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

      if (tableId) {
        const table = await this.findTableWithOccupants(client, tableId);
        const existingAtTable = (table.invitationCodes || []).find(
          (ic: any) => ic.id === invitationCodeId
        );
        const targetGuest =
          existingAtTable || (await this.loadOptionalGuestById(client, invitationCodeId));

        const incomingHeadcount = targetGuest ? getGuestPartySize(targetGuest) : 1;
        const plusOneCount = Math.max(0, incomingHeadcount - 1);

        // Check table capacity using party headcount, excluding the target guest if already assigned to this table
        const otherOccupants = this.filterOtherOccupantsAndAssertCapacity(
          table,
          new Set([invitationCodeId]),
          incomingHeadcount
        );

        let effectiveOccupants = otherOccupants;
        const requestedSeatInRange =
          typeof seatNumber === 'number' && seatNumber >= 1 && seatNumber <= table.capacity
            ? seatNumber
            : null;

        // If a valid seatNumber is specified, displace any other occupant holding that primary seat
        if (requestedSeatInRange !== null) {
          const occupant = await client.invitationCode.findFirst({
            where: {
              tableId,
              seatNumber: requestedSeatInRange,
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
          const tracker = this.createSeatTracker(effectiveOccupants, table.capacity);
          const allocation = tracker.allocatePartySeats(
            incomingHeadcount,
            requestedSeatInRange
          );
          resolvedPrimarySeat = allocation.primarySeat;
          resolvedPlusOneSeats = allocation.plusOneSeats;
        } else {
          if (resolvedPrimarySeat !== null && resolvedPrimarySeat > table.capacity) {
            const tracker = this.createSeatTracker(effectiveOccupants, table.capacity);
            resolvedPrimarySeat = tracker.takePartySeats(1);
          }
          if (hadPlusOneSeats) {
            resolvedPlusOneSeats = [];
          }
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

      const targetGuest = await this.loadOptionalGuestById(client, invitationCodeId);
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
        const { allocatePartySeats } = this.createSeatTracker(
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

          const existingPlusOneSeats =
            existing?.tableId === tableId && Array.isArray(existing.plusOneSeatNumbers)
              ? existing.plusOneSeatNumbers
              : undefined;

          const allocation = allocatePartySeats(
            partySize,
            preferredSeat,
            existingPlusOneSeats
          );

          plannedUpdates.push({
            guestId,
            tableId,
            seatNumber: allocation.primarySeat,
            plusOneSeatNumbers: allocation.plusOneSeats,
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
      const clampedEntryMap = new Map<string, PartySeatAllocation>();

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
            if (
              typeof e.seatNumber === 'number' &&
              e.seatNumber >= 1 &&
              e.seatNumber <= table.capacity
            ) {
              incomingSeats.add(e.seatNumber);
              if (e.plusOneSeatNumbers.length > 0) {
                for (const ps of e.plusOneSeatNumbers) {
                  if (typeof ps === 'number' && ps >= 1 && ps <= table.capacity) {
                    incomingSeats.add(ps);
                  }
                }
              } else {
                for (let offset = 1; offset < partySize; offset++) {
                  if (e.seatNumber + offset <= table.capacity) {
                    incomingSeats.add(e.seatNumber + offset);
                  }
                }
              }
            } else {
              for (const ps of e.plusOneSeatNumbers) {
                if (typeof ps === 'number' && ps >= 1 && ps <= table.capacity) {
                  incomingSeats.add(ps);
                }
              }
            }
          }

          const remainingOccupants: TableOccupantRecord[] = [];
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
              remainingOccupants.push({ ...occ, seatNumber: null });
            } else {
              remainingOccupants.push(occ);
            }
          }

          const tracker = this.createSeatTracker(remainingOccupants, table.capacity);
          for (const e of incomingForTable) {
            const guest = guestById.get(e.invitationCodeId);
            const partySize = guest ? getGuestPartySize(guest) : 1;
            if (
              typeof e.seatNumber === 'number' &&
              e.seatNumber >= 1 &&
              e.seatNumber <= table.capacity
            ) {
              const reserved = tracker.allocatePartySeats(
                partySize,
                e.seatNumber,
                e.plusOneSeatNumbers
              );
              clampedEntryMap.set(e.invitationCodeId, reserved);
            } else if (typeof e.seatNumber === 'number' && e.seatNumber > table.capacity) {
              const reserved = tracker.allocatePartySeats(partySize);
              clampedEntryMap.set(e.invitationCodeId, reserved);
            } else {
              clampedEntryMap.set(e.invitationCodeId, {
                primarySeat: e.seatNumber,
                plusOneSeats: e.plusOneSeatNumbers,
              });
            }
          }
        }
      }

      const allUpdates: PlannedSeatUpdate[] = [
        ...displacedSeatUpdates,
        ...normalizedEntries.map((e) => ({
          guestId: e.invitationCodeId,
          tableId: e.tableId,
          seatNumber: clampedEntryMap.has(e.invitationCodeId)
            ? clampedEntryMap.get(e.invitationCodeId)!.primarySeat
            : e.seatNumber,
          plusOneSeatNumbers: clampedEntryMap.has(e.invitationCodeId)
            ? clampedEntryMap.get(e.invitationCodeId)!.plusOneSeats
            : e.plusOneSeatNumbers,
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

      interface CachedGuestPartyMetadata {
        partySize: number;
        partyGroup: string | null;
        partyGroups: string[];
        partyTags: string[];
      }

      const metadataByGuest = new Map<any, CachedGuestPartyMetadata>();
      const partySizeById = new Map<string, number>();
      const unassignedGuests: any[] = [];
      let totalPoolHeadcount = 0;

      for (const guest of rawUnassignedGuests || []) {
        if (!isGuestEligibleForSeating(guest)) {
          continue;
        }
        if (!includePending && getGuestAttendanceStatus(guest) !== 'attending') {
          continue;
        }
        const partyGroup = extractNormalizedPartyGroup(guest);
        if (filterGroup && partyGroup !== filterGroup) {
          continue;
        }
        const partyTags = extractNormalizedPartyTags(guest);
        if (filterTags && !partyTags.some((t) => filterTags.has(t))) {
          continue;
        }

        const partySize = getGuestPartySize(guest);
        unassignedGuests.push(guest);
        metadataByGuest.set(guest, {
          partySize,
          partyGroup,
          partyGroups: partyGroup ? [partyGroup] : [],
          partyTags,
        });
        if (guest.id) {
          partySizeById.set(guest.id, partySize);
        }
        totalPoolHeadcount += partySize;
      }

      if (unassignedGuests.length === 0) {
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
        allocatePartySeats: (partySize: number) => PartySeatAllocation;
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
          const { allocatePartySeats } = this.createSeatTracker(occupants, capacity);
          const occupiedHeadcount = getGuestsHeadcount(occupants);
          const remainingCapacity = Math.max(0, capacity - occupiedHeadcount);

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
            allocatePartySeats,
            groups,
            tags,
          };
        });

      tableStates.sort((a, b) => a.name.localeCompare(b.name));

      interface HouseholdUnit {
        key: string;
        isNamedHousehold: boolean;
        guests: any[];
        totalChairs: number;
        groups: string[];
        tags: string[];
        clusterKey: string;
        sortLabel: string;
      }

      // Group unassigned guests by householdName
      const householdMap = new Map<string, { members: any[]; headcount: number; sortLabel: string }>();
      let soloCounter = 0;

      for (const guest of unassignedGuests) {
        const guestHeadcount = metadataByGuest.get(guest)?.partySize || 1;
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

      const householdUnits: HouseholdUnit[] = Array.from(householdMap.entries()).map(
        ([key, bucket]) => {
          const groupSet = new Set<string>();
          const tagSet = new Set<string>();

          for (const g of bucket.members) {
            const meta = metadataByGuest.get(g);
            const pg = meta ? meta.partyGroup : extractNormalizedPartyGroup(g);
            if (pg) groupSet.add(pg);
            const gTags = meta ? meta.partyTags : extractNormalizedPartyTags(g);
            for (const tag of gTags) {
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
            guests: bucket.members,
            totalChairs: bucket.headcount,
            groups,
            tags,
            clusterKey,
            sortLabel: bucket.sortLabel,
          };
        }
      );

      const plannedAssignments: PlannedSeatUpdate[] = [];

      const computeAffinityScore = (
        table: TableState,
        groups: readonly string[],
        tags: readonly string[]
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

      const selectBestTable = (
        requiredChairs: number,
        groups: readonly string[],
        tags: readonly string[],
        preferLargerRemainingCapacity: boolean = false
      ): TableState | null => {
        const hasAffinityCriteria = groups.length > 0 || tags.length > 0;
        let bestTable: TableState | null = null;
        let bestAffinity = -1;

        for (const table of tableStates) {
          if (table.remainingCapacity < requiredChairs) {
            continue;
          }

          const affinity = hasAffinityCriteria
            ? computeAffinityScore(table, groups, tags)
            : 0;

          if (
            bestTable === null ||
            affinity > bestAffinity ||
            (affinity === bestAffinity &&
              (preferLargerRemainingCapacity
                ? table.remainingCapacity > bestTable.remainingCapacity
                : table.remainingCapacity < bestTable.remainingCapacity))
          ) {
            bestTable = table;
            bestAffinity = affinity;
          }
        }

        return bestTable;
      };

      const seatGuestAtTable = (guest: any, chosenTable: TableState) => {
        const meta = metadataByGuest.get(guest);
        const requiredChairs = meta ? meta.partySize : getGuestPartySize(guest);
        const allocation = chosenTable.allocatePartySeats(requiredChairs);
        chosenTable.remainingCapacity -= requiredChairs;

        const pg = meta ? meta.partyGroup : extractNormalizedPartyGroup(guest);
        if (pg) chosenTable.groups.add(pg);
        const gTags = meta ? meta.partyTags : extractNormalizedPartyTags(guest);
        for (const tag of gTags) {
          chosenTable.tags.add(tag);
        }

        plannedAssignments.push({
          guestId: guest.id,
          tableId: chosenTable.id,
          seatNumber: allocation.primarySeat,
          plusOneSeatNumbers: allocation.plusOneSeats,
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
          const chosenTable = selectBestTable(clusterTotalChairs, allGroups, allTags, false);

          if (chosenTable) {
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

      // Sort remaining HouseholdUnits in descending order of total attendee headcount (Best-Fit Decreasing + Affinity)
      remainingUnits.sort((a, b) => {
        if (b.totalChairs !== a.totalChairs) {
          return b.totalChairs - a.totalChairs;
        }
        if (a.clusterKey !== b.clusterKey) {
          return b.clusterKey.localeCompare(a.clusterKey);
        }
        return a.sortLabel.localeCompare(b.sortLabel);
      });

      const unplacedUnits: HouseholdUnit[] = [];

      // Phase 1: Intact Household Placement (Affinity-Aware Best-Fit Decreasing)
      for (const unit of remainingUnits) {
        const chosenTable = selectBestTable(unit.totalChairs, unit.groups, unit.tags, false);

        if (chosenTable) {
          for (const guest of unit.guests) {
            seatGuestAtTable(guest, chosenTable);
          }
        } else {
          unplacedUnits.push(unit);
        }
      }

      // Phase 2: Split multi-invitation household groups across open tables (unless keepHouseholdsIntact is enabled),
      // NEVER splitting an individual InvitationCode party across separate tables.
      if (unplacedUnits.length > 0) {
        for (const unit of unplacedUnits) {
          if (keepHouseholdsIntact && unit.isNamedHousehold && unit.guests.length > 1) {
            continue;
          }

          for (const guest of unit.guests) {
            const meta = metadataByGuest.get(guest);
            const requiredChairs = meta ? meta.partySize : getGuestPartySize(guest);
            const gGroups = meta
              ? meta.partyGroups
              : (() => {
                const pg = extractNormalizedPartyGroup(guest);
                return pg ? [pg] : [];
              })();
            const gTags = meta ? meta.partyTags : extractNormalizedPartyTags(guest);

            const chosenTable = selectBestTable(requiredChairs, gGroups, gTags, true);
            if (!chosenTable) {
              continue;
            }

            seatGuestAtTable(guest, chosenTable);
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
