import { InvitationCodeDTO } from '@/features/registry';
import { isOneSidedTableShape } from './utils/seatingHelpers';

interface SeatPositionOptions {
  seatNumber: number;
  capacity: number;
  shape?: string | null;
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
 * Resolves table seat assignments (1..capacity) in two deterministic passes:
 * 1. Explicit `seatNumber` values within `1..capacity` claim their designated seats first.
 * 2. Remaining unnumbered (or colliding/out-of-range) guests are placed into the lowest open seats.
 *
 * Unlike positional `assignedGuests[i - 1]` fallbacks, sparse explicit seat assignments leave
 * unassigned seat numbers empty rather than duplicating occupants onto lower seats.
 */
export function resolveSeatAssignments(
  guests: InvitationCodeDTO[] | undefined,
  capacity: number
): Map<number, InvitationCodeDTO> {
  const seatMap = new Map<number, InvitationCodeDTO>();
  if (!guests || guests.length === 0 || capacity <= 0) {
    return seatMap;
  }

  const unplacedGuests: InvitationCodeDTO[] = [];

  for (const guest of guests) {
    const explicitSeat = guest.seatNumber;
    if (
      typeof explicitSeat === 'number' &&
      Number.isInteger(explicitSeat) &&
      explicitSeat >= 1 &&
      explicitSeat <= capacity &&
      !seatMap.has(explicitSeat)
    ) {
      seatMap.set(explicitSeat, guest);
    } else if (explicitSeat == null || explicitSeat < 1 || seatMap.has(explicitSeat)) {
      unplacedGuests.push(guest);
    } else {
      // Guest has explicit seatNumber > capacity (e.g., table capacity shrunk); place if open seat exists
      unplacedGuests.push(guest);
    }
  }

  if (unplacedGuests.length > 0) {
    let nextCandidateSeat = 1;
    for (const guest of unplacedGuests) {
      while (nextCandidateSeat <= capacity && seatMap.has(nextCandidateSeat)) {
        nextCandidateSeat++;
      }
      if (nextCandidateSeat > capacity) {
        break;
      }
      seatMap.set(nextCandidateSeat, guest);
      nextCandidateSeat++;
    }
  }

  return seatMap;
}

/**
 * Computes seat center coordinates around a round, 1-sided (head/sweetheart),
 * or four-edged (rectangular/square) table.
 * For 1-sided tables, places all seats evenly along the single top edge.
 * For rectangular/square tables, distributes `capacity` seats clockwise across the 4 edges
 * (Top, Right, Bottom, Left) and spaces seats evenly along each edge using
 * `(edgeIndex + 1) / (edgeSeatCount + 1)`.
 */
export function computeSeatPosition({
  seatNumber,
  capacity,
  shape,
  width,
  height,
  offset,
  originX = 0,
  originY = 0,
}: SeatPositionOptions): SeatCoordinates {
  const safeCapacity = Math.max(1, capacity);
  const isRound = (shape || 'round').toLowerCase() === 'round';

  if (isRound) {
    const cx = originX + width / 2;
    const cy = originY + height / 2;
    const radius = Math.min(width, height) / 2 + offset;
    const angle = (seatNumber * 2 * Math.PI) / safeCapacity - Math.PI / 2;
    return {
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    };
  }

  if (isOneSidedTableShape(shape)) {
    return {
      x: originX + (width / (safeCapacity + 1)) * seatNumber,
      y: originY - offset,
    };
  }

  const perimeterIndex = Math.max(0, Math.min(safeCapacity - 1, seatNumber - 1));
  const side = Math.min(3, Math.max(0, Math.floor((perimeterIndex * 4) / safeCapacity)));
  const edgeStart = Math.ceil((side * safeCapacity) / 4);
  const edgeEnd = Math.ceil(((side + 1) * safeCapacity) / 4);
  const edgeSeatCount = Math.max(1, edgeEnd - edgeStart);
  const edgeIndex = perimeterIndex - edgeStart;
  const edgeFraction = (edgeIndex + 1) / (edgeSeatCount + 1);

  if (side === 0) {
    // Top edge (left to right)
    return {
      x: originX + width * edgeFraction,
      y: originY - offset,
    };
  }

  if (side === 1) {
    // Right edge (top to bottom)
    return {
      x: originX + width + offset,
      y: originY + height * edgeFraction,
    };
  }

  if (side === 2) {
    // Bottom edge (right to left)
    return {
      x: originX + width - width * edgeFraction,
      y: originY + height + offset,
    };
  }

  // Left edge (bottom to top)
  return {
    x: originX - offset,
    y: originY + height - height * edgeFraction,
  };
}
