import { InvitationCodeDTO } from '@/features/registry';
import {
  formatCompanionSeatLabel,
  getGuestPartySize,
  getGuestsHeadcount,
  isOneSidedTableShape,
} from './utils/seatingHelpers';

interface SeatPositionOptions {
  shape: string;
  seatNumber: number; // 1-indexed (1 .. capacity)
  capacity: number;
  width: number;
  height: number;
  offset: number;
  originX?: number;
  originY?: number;
}

interface SeatCoordinates {
  x: number;
  y: number;
}

export interface ResolvedSeatOccupant {
  seatNumber: number;
  guest: InvitationCodeDTO;
  isCompanion: boolean;
  companionIndex: number;
  displayName: string;
  partySize: number;
  primarySeatNumber: number;
}

function findContiguousBlock(
  occupied: Set<number>,
  blockSize: number,
  maxSeat: number
): number | null {
  if (blockSize <= 0 || maxSeat < blockSize) {
    return null;
  }
  for (let start = 1; start <= maxSeat - blockSize + 1; start++) {
    let fits = true;
    for (let offset = 0; offset < blockSize; offset++) {
      if (occupied.has(start + offset)) {
        fits = false;
        break;
      }
    }
    if (fits) {
      return start;
    }
  }
  return null;
}

function takeNextOpenSeat(occupied: Set<number>, startSearchAt: number = 1): number {
  let seat = Math.max(1, startSearchAt);
  while (occupied.has(seat)) {
    seat++;
  }
  occupied.add(seat);
  return seat;
}

/**
 * Resolves seated guests and their plus-one companions onto 1-indexed chairs.
 *
 * - Clamps out-of-range explicit `seatNumber > capacity` into `1..capacity` when open chairs exist.
 * - Preserves valid explicit primary `seatNumber` values in `1..capacity` first (first-seen wins on collisions).
 * - Allocates contiguous companion chairs (`primarySeat + 1..`) when unoccupied, falling back to open chairs in `1..capacity`.
 * - Places unnumbered or clamped parties into contiguous blocks in `1..capacity` before fragmented or overflow seats.
 */
export function resolveDetailedSeatAssignments(
  guests: InvitationCodeDTO[] | undefined,
  capacity: number
): Map<number, ResolvedSeatOccupant> {
  const detailedMap = new Map<number, ResolvedSeatOccupant>();
  if (!guests || guests.length === 0) {
    return detailedMap;
  }

  const safeCapacity = Math.max(1, Math.floor(Number(capacity) || 1));
  const totalHeadcount = getGuestsHeadcount(guests);
  const maxBound = Math.max(safeCapacity, totalHeadcount);
  const occupied = new Set<number>();

  interface PlacedPrimaryEntry {
    guest: InvitationCodeDTO;
    primarySeat: number;
    partySize: number;
  }

  const placedExplicit: PlacedPrimaryEntry[] = [];
  const unplacedGuests: InvitationCodeDTO[] = [];

  // Pass 1a: Claim valid explicit primary seats within 1..safeCapacity
  for (const guest of guests) {
    const explicitSeat = guest.seatNumber;
    if (
      typeof explicitSeat === 'number' &&
      Number.isInteger(explicitSeat) &&
      explicitSeat >= 1 &&
      explicitSeat <= safeCapacity &&
      !occupied.has(explicitSeat)
    ) {
      const partySize = getGuestPartySize(guest);
      occupied.add(explicitSeat);
      detailedMap.set(explicitSeat, {
        seatNumber: explicitSeat,
        guest,
        isCompanion: false,
        companionIndex: -1,
        displayName: guest.guestName,
        partySize,
        primarySeatNumber: explicitSeat,
      });
      placedExplicit.push({ guest, primarySeat: explicitSeat, partySize });
    } else {
      unplacedGuests.push(guest);
    }
  }

  // Pass 1b: Allocate companion chairs for Pass 1a parties (preferring contiguous chairs after primarySeat)
  for (const entry of placedExplicit) {
    const companionCount = entry.partySize - 1;
    for (let cIdx = 0; cIdx < companionCount; cIdx++) {
      const preferredSeat = entry.primarySeat + cIdx + 1;
      let assignedCompanionSeat: number;
      if (preferredSeat <= safeCapacity && !occupied.has(preferredSeat)) {
        occupied.add(preferredSeat);
        assignedCompanionSeat = preferredSeat;
      } else {
        assignedCompanionSeat = takeNextOpenSeat(occupied, 1);
      }
      detailedMap.set(assignedCompanionSeat, {
        seatNumber: assignedCompanionSeat,
        guest: entry.guest,
        isCompanion: true,
        companionIndex: cIdx,
        displayName: formatCompanionSeatLabel(entry.guest, cIdx),
        partySize: entry.partySize,
        primarySeatNumber: entry.primarySeat,
      });
    }
  }

  // Pass 2: Place unnumbered, colliding, or clamped (seatNumber > capacity) parties
  for (const guest of unplacedGuests) {
    const partySize = getGuestPartySize(guest);
    const contiguousStart =
      partySize > 1
        ? (findContiguousBlock(occupied, partySize, safeCapacity) ??
          findContiguousBlock(occupied, partySize, maxBound))
        : null;

    if (contiguousStart !== null) {
      for (let offset = 0; offset < partySize; offset++) {
        const seatNum = contiguousStart + offset;
        occupied.add(seatNum);
        const isCompanion = offset > 0;
        const cIdx = offset - 1;
        detailedMap.set(seatNum, {
          seatNumber: seatNum,
          guest,
          isCompanion,
          companionIndex: isCompanion ? cIdx : -1,
          displayName: isCompanion ? formatCompanionSeatLabel(guest, cIdx) : guest.guestName,
          partySize,
          primarySeatNumber: contiguousStart,
        });
      }
    } else {
      const primarySeat = takeNextOpenSeat(occupied, 1);
      detailedMap.set(primarySeat, {
        seatNumber: primarySeat,
        guest,
        isCompanion: false,
        companionIndex: -1,
        displayName: guest.guestName,
        partySize,
        primarySeatNumber: primarySeat,
      });

      for (let cIdx = 0; cIdx < partySize - 1; cIdx++) {
        const companionSeat = takeNextOpenSeat(occupied, primarySeat + 1 <= safeCapacity ? primarySeat + 1 : 1);
        const boundedCompanionSeat =
          companionSeat > safeCapacity
            ? (() => {
              // Check if an earlier seat in 1..safeCapacity is still open before overflowing
              for (let s = 1; s <= safeCapacity; s++) {
                if (!occupied.has(s)) {
                  occupied.delete(companionSeat);
                  occupied.add(s);
                  return s;
                }
              }
              return companionSeat;
            })()
            : companionSeat;

        detailedMap.set(boundedCompanionSeat, {
          seatNumber: boundedCompanionSeat,
          guest,
          isCompanion: true,
          companionIndex: cIdx,
          displayName: formatCompanionSeatLabel(guest, cIdx),
          partySize,
          primarySeatNumber: primarySeat,
        });
      }
    }
  }

  return detailedMap;
}

/**
 * Resolves seated guests onto 1-indexed seat numbers without duplicating solo guests across empty seats.
 * Multi-person invitations claim their full party headcount of chairs, and explicit `seatNumber > capacity`
 * values are clamped into `1..capacity` when open chairs exist.
 */
export function resolveSeatAssignments(
  guests: InvitationCodeDTO[] | undefined,
  capacity: number
): Map<number, InvitationCodeDTO> {
  const detailed = resolveDetailedSeatAssignments(guests, capacity);
  const seatMap = new Map<number, InvitationCodeDTO>();
  detailed.forEach((entry, seatNum) => {
    seatMap.set(seatNum, entry.guest);
  });
  return seatMap;
}

/**
 * Computes deterministic primary `seatNumber` assignments clamped/repacked into `1..capacity`
 * for every seated guest on a table (used when shrinking table capacity).
 */
export function repackTableSeatNumbers(
  guests: InvitationCodeDTO[] | undefined,
  capacity: number
): Map<string, number> {
  const repacked = new Map<string, number>();
  if (!guests || guests.length === 0) {
    return repacked;
  }
  const detailed = resolveDetailedSeatAssignments(guests, capacity);
  detailed.forEach((entry) => {
    if (!entry.isCompanion && entry.guest.id) {
      repacked.set(entry.guest.id, entry.seatNumber);
    }
  });
  return repacked;
}

/**
 * Computes consistent 2D center coordinates for a 1-indexed seat around a round, 1-sided (head/sweetheart),
 * or 4-sided rectangular/square table.
 */
export function computeSeatPosition({
  shape,
  seatNumber,
  capacity,
  width,
  height,
  offset,
  originX = 0,
  originY = 0,
}: SeatPositionOptions): SeatCoordinates {
  const safeCapacity = Math.max(1, capacity);
  const shapeLower = (shape || 'round').toLowerCase();

  if (shapeLower === 'round') {
    const cx = originX + width / 2;
    const cy = originY + height / 2;
    const radius = Math.min(width, height) / 2 + offset;
    const angle = (seatNumber * 2 * Math.PI) / safeCapacity - Math.PI / 2;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  }

  if (isOneSidedTableShape(shapeLower)) {
    return {
      x: originX + (width / (safeCapacity + 1)) * seatNumber,
      y: originY - offset,
    };
  }

  const perimeterIndex = seatNumber - 1;
  const side = Math.min(3, Math.max(0, Math.floor((perimeterIndex * 4) / safeCapacity)));
  const edgeStart = Math.ceil((side * safeCapacity) / 4);
  const edgeEnd = Math.ceil(((side + 1) * safeCapacity) / 4);
  const edgeSeatCount = Math.max(1, edgeEnd - edgeStart);
  const edgeIndex = perimeterIndex - edgeStart;
  const fraction = (edgeIndex + 1) / (edgeSeatCount + 1);

  if (side === 0) {
    // Top edge (left -> right)
    return {
      x: originX + width * fraction,
      y: originY - offset,
    };
  }

  if (side === 1) {
    // Right edge (top -> bottom)
    return {
      x: originX + width + offset,
      y: originY + height * fraction,
    };
  }

  if (side === 2) {
    // Bottom edge (right -> left)
    return {
      x: originX + width * (1 - fraction),
      y: originY + height + offset,
    };
  }

  // Left edge (bottom -> top)
  return {
    x: originX - offset,
    y: originY + height * (1 - fraction),
  };
}
