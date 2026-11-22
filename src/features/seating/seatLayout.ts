import { InvitationCodeDTO } from '@/features/registry';
import {
  getInvitationPartyMembers,
  isLandmarkTableShape,
  isOneSidedTableShape,
  type DietaryBadgeInfo,
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

export interface ResolvedSeatEntry {
  guest: InvitationCodeDTO;
  seatNumber: number;
  attendeeName: string;
  isPlusOne: boolean;
  plusOneIndex: number | null;
  mealChoice: string | null;
  dietaryBadges: DietaryBadgeInfo[];
}

/**
 * Resolves seated invitations (including each invitation's attending plus-ones) onto distinct
 * 1-indexed chair numbers without duplicating guests across empty seats.
 *
 * Pass 1a: Primary guests with a valid explicit `seatNumber` (>= 1) claim their seat first.
 * Pass 1b: Attending plus-ones with a valid explicit `plusOneSeatNumbers[idx]` (>= 1) claim their seat.
 * Pass 2: Any remaining unplaced primary or plus-one attendees fill the lowest unoccupied chairs in 1..maxSeat.
 */
export function resolveDetailedSeatAssignments(
  guests: InvitationCodeDTO[] | undefined,
  capacity: number
): Map<number, ResolvedSeatEntry> {
  const seatMap = new Map<number, ResolvedSeatEntry>();
  if (!guests || guests.length === 0 || capacity <= 0) {
    return seatMap;
  }

  interface PendingAttendee {
    guest: InvitationCodeDTO;
    attendeeName: string;
    isPlusOne: boolean;
    plusOneIndex: number | null;
    mealChoice: string | null;
    dietaryBadges: DietaryBadgeInfo[];
    explicitSeat: number | null;
  }

  const primaryQueue: PendingAttendee[] = [];
  const plusOneQueue: PendingAttendee[] = [];

  for (const guest of guests) {
    const members = getInvitationPartyMembers(guest);
    if (members.length === 0) {
      // Even if an explicitly passed guest mock is missing attendance flags, fallback to 1 primary seat
      // unless it was already filtered upstream; getInvitationPartyMembers returns >=1 for eligible guests.
      continue;
    }

    const primaryMember = members[0];
    primaryQueue.push({
      guest,
      attendeeName: primaryMember.attendeeName,
      isPlusOne: false,
      plusOneIndex: null,
      mealChoice: primaryMember.mealChoice,
      dietaryBadges: primaryMember.dietaryBadges,
      explicitSeat:
        typeof guest.seatNumber === 'number' &&
        Number.isInteger(guest.seatNumber) &&
        guest.seatNumber >= 1
          ? guest.seatNumber
          : null,
    });

    const explicitPlusOneSeats = Array.isArray(guest.plusOneSeatNumbers)
      ? guest.plusOneSeatNumbers
      : [];

    for (let idx = 1; idx < members.length; idx++) {
      const member = members[idx];
      const plusIdx = idx - 1;
      const rawSeat = explicitPlusOneSeats[plusIdx];
      plusOneQueue.push({
        guest,
        attendeeName: member.attendeeName,
        isPlusOne: true,
        plusOneIndex: plusIdx,
        mealChoice: member.mealChoice,
        dietaryBadges: member.dietaryBadges,
        explicitSeat:
          typeof rawSeat === 'number' && Number.isInteger(rawSeat) && rawSeat >= 1
            ? rawSeat
            : null,
      });
    }
  }

  const unplaced: PendingAttendee[] = [];

  for (const item of primaryQueue) {
    if (item.explicitSeat !== null && !seatMap.has(item.explicitSeat)) {
      seatMap.set(item.explicitSeat, {
        guest: item.guest,
        seatNumber: item.explicitSeat,
        attendeeName: item.attendeeName,
        isPlusOne: false,
        plusOneIndex: null,
        mealChoice: item.mealChoice,
        dietaryBadges: item.dietaryBadges,
      });
    } else {
      unplaced.push(item);
    }
  }

  for (const item of plusOneQueue) {
    if (item.explicitSeat !== null && !seatMap.has(item.explicitSeat)) {
      seatMap.set(item.explicitSeat, {
        guest: item.guest,
        seatNumber: item.explicitSeat,
        attendeeName: item.attendeeName,
        isPlusOne: true,
        plusOneIndex: item.plusOneIndex,
        mealChoice: item.mealChoice,
        dietaryBadges: item.dietaryBadges,
      });
    } else {
      unplaced.push(item);
    }
  }

  if (unplaced.length > 0) {
    const totalAttendees = primaryQueue.length + plusOneQueue.length;
    const maxFallbackSeat = Math.max(capacity, totalAttendees);
    let candidateSeat = 1;
    for (const item of unplaced) {
      while (seatMap.has(candidateSeat) && candidateSeat <= maxFallbackSeat + totalAttendees) {
        candidateSeat++;
      }
      seatMap.set(candidateSeat, {
        guest: item.guest,
        seatNumber: candidateSeat,
        attendeeName: item.attendeeName,
        isPlusOne: item.isPlusOne,
        plusOneIndex: item.plusOneIndex,
        mealChoice: item.mealChoice,
        dietaryBadges: item.dietaryBadges,
      });
      candidateSeat++;
    }
  }

  return seatMap;
}

/**
 * Resolves seated guests (and their attending plus-ones) onto 1-indexed seat numbers without
 * duplicating guests across empty seats. An invitation with N attending plus-ones claims `1 + N` chairs.
 */
export function resolveSeatAssignments(
  guests: InvitationCodeDTO[] | undefined,
  capacity: number
): Map<number, InvitationCodeDTO> {
  const detailed = resolveDetailedSeatAssignments(guests, capacity);
  const seatMap = new Map<number, InvitationCodeDTO>();
  for (const [seatNum, entry] of detailed.entries()) {
    seatMap.set(seatNum, entry.guest);
  }
  return seatMap;
}

/**
 * Computes consistent 2D center coordinates for a 1-indexed seat around a round, 1-sided (head/sweetheart),
 * or 4-sided rectangular/square table. Landmarks do not place seats.
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
  if (isLandmarkTableShape(shape) || capacity <= 0) {
    return {
      x: originX + width / 2,
      y: originY + height / 2,
    };
  }

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
