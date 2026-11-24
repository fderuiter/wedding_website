import type { InvitationCodeDTO } from '@/features/registry';
import {
  formatCompanionSeatLabel,
  getDietaryBadges,
  getInvitationPartyMembers,
  isLandmarkTableShape,
  isOneSidedTableShape,
  type DietaryBadgeInfo,
  type PartyMemberAttendeeInfo,
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

export interface ScaledTableDimensionsOptions {
  shape: string;
  capacity: number;
  width?: number | null;
  height?: number | null;
  rotation?: number | null;
  offset?: number;
}

export interface ScaledTableDimensions {
  width: number;
  height: number;
}

const GUEST_TABLE_MIN_MARGIN_PX = 36;
const SEAT_CLEARANCE_RADIUS_PX = 18;

/**
 * Computes minimum stage X and Y coordinates so rotated table surfaces and 32x32px perimeter seat
 * targets remain unclipped inside the scrollable floorplan stage (`>= 36px` for guest tables, `>= 0px` for landmarks).
 */
export function computeTableMinBounds(
  options: ScaledTableDimensionsOptions
): { minX: number; minY: number } {
  const { width: scaledWidth, height: scaledHeight } = computeScaledTableDimensions(options);
  const cx = scaledWidth / 2;
  const cy = scaledHeight / 2;
  const normalizedRotation = (((Number(options.rotation) || 0) % 360) + 360) % 360;
  const rad = (normalizedRotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const surfaceHalfExtentX = Math.abs(cx * cos) + Math.abs(cy * sin);
  const surfaceHalfExtentY = Math.abs(cx * sin) + Math.abs(cy * cos);

  if (isLandmarkTableShape(options.shape) || options.capacity <= 0) {
    return {
      minX: Math.max(0, Math.ceil(surfaceHalfExtentX - cx)),
      minY: Math.max(0, Math.ceil(surfaceHalfExtentY - cy)),
    };
  }

  const safeCapacity = Math.max(1, Math.floor(Number(options.capacity) || 1));
  const shapeLower = (options.shape || 'round').toLowerCase();
  const isRound = shapeLower === 'round';
  const isOneSided = isOneSidedTableShape(shapeLower);
  const resolvedOffset = options.offset ?? (isRound || isOneSided ? 18 : 16);

  let maxLeftFromCenter = surfaceHalfExtentX;
  let maxTopFromCenter = surfaceHalfExtentY;

  for (let seatNumber = 1; seatNumber <= safeCapacity; seatNumber++) {
    const local = computeSeatPosition({
      shape: options.shape,
      seatNumber,
      capacity: safeCapacity,
      width: scaledWidth,
      height: scaledHeight,
      offset: resolvedOffset,
    });
    const dx = local.x - cx;
    const dy = local.y - cy;
    const rotX = dx * cos - dy * sin;
    const rotY = dx * sin + dy * cos;
    maxLeftFromCenter = Math.max(maxLeftFromCenter, -rotX + SEAT_CLEARANCE_RADIUS_PX);
    maxTopFromCenter = Math.max(maxTopFromCenter, -rotY + SEAT_CLEARANCE_RADIUS_PX);
  }

  return {
    minX: Math.max(GUEST_TABLE_MIN_MARGIN_PX, Math.ceil(maxLeftFromCenter - cx)),
    minY: Math.max(GUEST_TABLE_MIN_MARGIN_PX, Math.ceil(maxTopFromCenter - cy)),
  };
}

/**
 * Scales rendered table bounds automatically for capacities 1 through 50 so adjacent seat targets
 * maintain at least 24x24 CSS pixels of unobscured space (WCAG 2.5.8 & C42) on the floorplan
 * and exported PDF schematics, while preserving configured dimensions for landmarks and tables that already fit.
 */
export function computeScaledTableDimensions({
  shape,
  capacity,
  width,
  height,
  rotation = 0,
  offset,
}: ScaledTableDimensionsOptions): ScaledTableDimensions {
  const baseWidth = Math.max(60, Number(width) || 120);
  const baseHeight = Math.max(60, Number(height) || 120);

  if (isLandmarkTableShape(shape) || capacity <= 0) {
    return { width: baseWidth, height: baseHeight };
  }

  const safeCapacity = Math.max(1, Math.floor(Number(capacity) || 1));
  const shapeLower = (shape || 'round').toLowerCase();
  const isRound = shapeLower === 'round';
  const isOneSided = isOneSidedTableShape(shapeLower);
  const resolvedOffset = offset ?? (isRound || isOneSided ? 18 : 16);

  // 36px center-to-center spacing guarantees >= 25.45px (> 24px) axis-aligned separation even at 45° diagonals
  const diagonalSafeSpacing = 36;
  // 33px axis-aligned spacing preserves zero overlap for 32x32px seat buttons on unrotated 2-seat edges
  const axisAlignedTwoSeatSpacing = 33;
  const normalizedRotation = (((Number(rotation) || 0) % 360) + 360) % 360;
  const isAxisAligned = normalizedRotation % 90 === 0;

  if (isRound) {
    if (safeCapacity <= 1) {
      return { width: baseWidth, height: baseHeight };
    }
    const sinHalfAngle = Math.sin(Math.PI / safeCapacity);
    const minRadius = diagonalSafeSpacing / (2 * sinHalfAngle);
    const minDiameter = Math.ceil(Math.max(60, (minRadius - resolvedOffset) * 2));
    return {
      width: Math.max(baseWidth, minDiameter),
      height: Math.max(baseHeight, minDiameter),
    };
  }

  if (isOneSided) {
    const minOneSidedWidth = Math.ceil(diagonalSafeSpacing * (safeCapacity + 1));
    return {
      width: Math.max(baseWidth, minOneSidedWidth),
      height: baseHeight,
    };
  }

  const sideCounts = [0, 0, 0, 0];
  for (let s = 1; s <= safeCapacity; s++) {
    const perimeterIndex = s - 1;
    const side = Math.min(3, Math.max(0, Math.floor((perimeterIndex * 4) / safeCapacity)));
    sideCounts[side]++;
  }

  const maxHorizontalEdgeSeats = Math.max(sideCounts[0], sideCounts[2]);
  const maxVerticalEdgeSeats = Math.max(sideCounts[1], sideCounts[3]);

  const requiredEdgeDimension = (edgeSeats: number, rawDim: number): number => {
    if (edgeSeats <= 1) {
      return rawDim;
    }
    if (edgeSeats === 2 && isAxisAligned && rawDim >= axisAlignedTwoSeatSpacing * 3) {
      return rawDim;
    }
    return Math.max(rawDim, Math.ceil(diagonalSafeSpacing * (edgeSeats + 1)));
  };

  let scaledWidth = requiredEdgeDimension(maxHorizontalEdgeSeats, baseWidth);
  let scaledHeight = requiredEdgeDimension(maxVerticalEdgeSeats, baseHeight);

  if (shapeLower === 'square') {
    const squareSide = Math.max(scaledWidth, scaledHeight);
    scaledWidth = squareSide;
    scaledHeight = squareSide;
  }

  return {
    width: scaledWidth,
    height: scaledHeight,
  };
}

interface ResolvedSeatOccupant {
  seatNumber: number;
  guest: InvitationCodeDTO;
  attendeeName: string;
  displayName: string;
  isCompanion: boolean;
  isPlusOne: boolean;
  companionIndex: number;
  plusOneIndex: number | null;
  partySize: number;
  primarySeatNumber: number;
  mealChoice: string | null;
  dietaryBadges: DietaryBadgeInfo[];
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

function resolvePartyMembersWithFallback(guest: InvitationCodeDTO): PartyMemberAttendeeInfo[] {
  const members = getInvitationPartyMembers(guest);
  if (members.length > 0) {
    return members;
  }
  return [
    {
      attendeeName: (guest.guestName || 'Guest').trim() || 'Guest',
      isPlusOne: false,
      plusOneIndex: null,
      mealChoice: null,
      dietaryBadges: getDietaryBadges(guest.dietaryNotes, guest.extraFields, guest.partyTags),
    },
  ];
}

function buildSeatOccupant(
  guest: InvitationCodeDTO,
  seatNumber: number,
  primarySeatNumber: number,
  members: PartyMemberAttendeeInfo[],
  memberIndex: number
): ResolvedSeatOccupant {
  const member = members[memberIndex] || members[0];
  const isCompanion = memberIndex > 0;
  const companionIndex = isCompanion ? memberIndex - 1 : -1;
  const displayName = isCompanion
    ? formatCompanionSeatLabel(guest, companionIndex)
    : guest.guestName;

  return {
    seatNumber,
    guest,
    attendeeName: member.attendeeName,
    displayName,
    isCompanion,
    isPlusOne: isCompanion,
    companionIndex,
    plusOneIndex: isCompanion ? companionIndex : null,
    partySize: members.length,
    primarySeatNumber,
    mealChoice: member.mealChoice,
    dietaryBadges: member.dietaryBadges,
  };
}

/**
 * Resolves seated guests and their plus-one companions onto distinct 1-indexed chairs.
 *
 * - Returns an empty map for zero-capacity landmarks (`capacity <= 0`).
 * - Clamps out-of-range explicit `seatNumber > capacity` into `1..capacity` when open chairs exist.
 * - Preserves valid explicit primary `seatNumber` values in `1..capacity` first (first-seen wins on collisions).
 * - Honors valid `plusOneSeatNumbers` in `1..capacity` when unoccupied, otherwise prefers contiguous chairs
 *   after `primarySeat` (`primarySeat + 1..`), falling back to open chairs in `1..capacity`.
 * - Places unnumbered or clamped parties into contiguous blocks in `1..capacity` before fragmented or overflow seats.
 */
export function resolveDetailedSeatAssignments(
  guests: InvitationCodeDTO[] | undefined,
  capacity: number
): Map<number, ResolvedSeatOccupant> {
  const detailedMap = new Map<number, ResolvedSeatOccupant>();
  if (!guests || guests.length === 0 || capacity <= 0) {
    return detailedMap;
  }

  const safeCapacity = Math.max(1, Math.floor(Number(capacity) || 1));
  const occupied = new Set<number>();

  interface PlacedPrimaryEntry {
    guest: InvitationCodeDTO;
    primarySeat: number;
    members: PartyMemberAttendeeInfo[];
  }

  interface UnplacedPartyEntry {
    guest: InvitationCodeDTO;
    members: PartyMemberAttendeeInfo[];
  }

  const placedExplicit: PlacedPrimaryEntry[] = [];
  const unplacedParties: UnplacedPartyEntry[] = [];
  let totalHeadcount = 0;

  // Pass 1a: Resolve each party once and claim valid explicit primary seats within 1..safeCapacity
  for (const guest of guests) {
    const members = resolvePartyMembersWithFallback(guest);
    totalHeadcount += members.length;
    const explicitSeat = guest.seatNumber;
    if (
      typeof explicitSeat === 'number' &&
      Number.isInteger(explicitSeat) &&
      explicitSeat >= 1 &&
      explicitSeat <= safeCapacity &&
      !occupied.has(explicitSeat)
    ) {
      occupied.add(explicitSeat);
      detailedMap.set(
        explicitSeat,
        buildSeatOccupant(guest, explicitSeat, explicitSeat, members, 0)
      );
      placedExplicit.push({ guest, primarySeat: explicitSeat, members });
    } else {
      unplacedParties.push({ guest, members });
    }
  }

  const maxBound = Math.max(safeCapacity, totalHeadcount);

  // Pass 1b: Allocate companion chairs for Pass 1a parties (honoring explicit plusOneSeatNumbers, else contiguous)
  for (const entry of placedExplicit) {
    const companionCount = entry.members.length - 1;
    const explicitPlusOneSeats = Array.isArray(entry.guest.plusOneSeatNumbers)
      ? entry.guest.plusOneSeatNumbers
      : [];

    for (let cIdx = 0; cIdx < companionCount; cIdx++) {
      const explicitCompanionSeat = explicitPlusOneSeats[cIdx];
      const preferredSeat = entry.primarySeat + cIdx + 1;
      let assignedCompanionSeat: number;

      if (
        typeof explicitCompanionSeat === 'number' &&
        Number.isInteger(explicitCompanionSeat) &&
        explicitCompanionSeat >= 1 &&
        explicitCompanionSeat <= safeCapacity &&
        !occupied.has(explicitCompanionSeat)
      ) {
        occupied.add(explicitCompanionSeat);
        assignedCompanionSeat = explicitCompanionSeat;
      } else if (preferredSeat <= safeCapacity && !occupied.has(preferredSeat)) {
        occupied.add(preferredSeat);
        assignedCompanionSeat = preferredSeat;
      } else {
        assignedCompanionSeat = takeNextOpenSeat(occupied, 1);
      }

      detailedMap.set(
        assignedCompanionSeat,
        buildSeatOccupant(
          entry.guest,
          assignedCompanionSeat,
          entry.primarySeat,
          entry.members,
          cIdx + 1
        )
      );
    }
  }

  // Pass 2: Place unnumbered, colliding, or clamped (seatNumber > capacity) parties
  for (const { guest, members } of unplacedParties) {
    const partySize = members.length;
    const contiguousStart =
      partySize > 1
        ? (findContiguousBlock(occupied, partySize, safeCapacity) ??
          findContiguousBlock(occupied, partySize, maxBound))
        : null;

    if (contiguousStart !== null) {
      for (let offset = 0; offset < partySize; offset++) {
        const seatNum = contiguousStart + offset;
        occupied.add(seatNum);
        detailedMap.set(
          seatNum,
          buildSeatOccupant(guest, seatNum, contiguousStart, members, offset)
        );
      }
    } else {
      const primarySeat = takeNextOpenSeat(occupied, 1);
      detailedMap.set(
        primarySeat,
        buildSeatOccupant(guest, primarySeat, primarySeat, members, 0)
      );

      for (let cIdx = 0; cIdx < partySize - 1; cIdx++) {
        const companionSeat = takeNextOpenSeat(
          occupied,
          primarySeat + 1 <= safeCapacity ? primarySeat + 1 : 1
        );
        const boundedCompanionSeat =
          companionSeat > safeCapacity
            ? (() => {
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

        detailedMap.set(
          boundedCompanionSeat,
          buildSeatOccupant(guest, boundedCompanionSeat, primarySeat, members, cIdx + 1)
        );
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
