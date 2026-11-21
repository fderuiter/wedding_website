import { InvitationCodeDTO } from '@/features/registry';
import { isOneSidedTableShape } from './utils/seatingHelpers';

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

/**
 * Resolves seated guests onto 1-indexed seat numbers without duplicating guests across empty seats.
 *
 * Pass 1: Guests with a valid explicit `seatNumber` (>= 1) claim their seat first (first-seen wins on collisions).
 * Pass 2: Remaining guests without a `seatNumber` (or whose seat collided) fill the lowest unoccupied seats in 1..capacity.
 */
export function resolveSeatAssignments(
  guests: InvitationCodeDTO[] | undefined,
  capacity: number
): Map<number, InvitationCodeDTO> {
  const seatMap = new Map<number, InvitationCodeDTO>();
  if (!guests || guests.length === 0) {
    return seatMap;
  }

  const unplacedGuests: InvitationCodeDTO[] = [];

  for (const guest of guests) {
    const explicitSeat = guest.seatNumber;
    if (
      typeof explicitSeat === 'number' &&
      Number.isInteger(explicitSeat) &&
      explicitSeat >= 1 &&
      !seatMap.has(explicitSeat)
    ) {
      seatMap.set(explicitSeat, guest);
    } else {
      unplacedGuests.push(guest);
    }
  }

  if (unplacedGuests.length > 0) {
    let candidateSeat = 1;
    const maxFallbackSeat = Math.max(capacity, guests.length);
    for (const guest of unplacedGuests) {
      while (seatMap.has(candidateSeat) && candidateSeat <= maxFallbackSeat) {
        candidateSeat++;
      }
      if (candidateSeat <= Math.max(capacity, candidateSeat)) {
        seatMap.set(candidateSeat, guest);
        candidateSeat++;
      }
    }
  }

  return seatMap;
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
