import { computeSeatPosition, resolveSeatAssignments } from '../seatLayout';
import { createMockInvitationCode } from '@/testing/factories/registryFactory';

describe('seatLayout shared seating geometry and seat resolution', () => {
  describe('resolveSeatAssignments', () => {
    it('returns an empty map when guests list is empty or undefined', () => {
      expect(resolveSeatAssignments(undefined, 8).size).toBe(0);
      expect(resolveSeatAssignments([], 8).size).toBe(0);
    });

    it('preserves explicit seatNumbers and deterministically fills gaps for unnumbered or duplicate seats', () => {
      const guests = [
        createMockInvitationCode({ id: 'g-seat-3', guestName: 'Seat Three', seatNumber: 3 }),
        createMockInvitationCode({ id: 'g-unnumbered', guestName: 'Unnumbered One', seatNumber: null }),
        createMockInvitationCode({ id: 'g-dup-3', guestName: 'Duplicate Three', seatNumber: 3 }),
        createMockInvitationCode({ id: 'g-neg', guestName: 'Invalid Seat', seatNumber: 0 }),
      ];

      const map = resolveSeatAssignments(guests, 4);
      expect(map.size).toBe(4);
      expect(map.get(1)?.id).toBe('g-unnumbered');
      expect(map.get(2)?.id).toBe('g-dup-3');
      expect(map.get(3)?.id).toBe('g-seat-3');
      expect(map.get(4)?.id).toBe('g-neg');
    });
  });

  describe('computeSeatPosition', () => {
    it('distributes round table seats radially starting from 12 o-clock (including empty shape fallback)', () => {
      const top = computeSeatPosition({
        shape: '',
        width: 120,
        height: 120,
        capacity: 4,
        seatNumber: 4,
        offset: 18,
      });
      const right = computeSeatPosition({
        shape: 'round',
        width: 120,
        height: 120,
        capacity: 4,
        seatNumber: 1,
        offset: 18,
      });

      expect(top.x).toBeCloseTo(60, 5);
      expect(top.y).toBeCloseTo(-18, 5);
      expect(right.x).toBeCloseTo(138, 5);
      expect(right.y).toBeCloseTo(60, 5);
    });

    it('places head and sweetheart table seats along the single top edge', () => {
      const headSeat = computeSeatPosition({
        shape: 'head',
        width: 240,
        height: 80,
        capacity: 3,
        seatNumber: 2,
        offset: 18,
      });
      const sweetheartSeat = computeSeatPosition({
        shape: 'sweetheart',
        width: 150,
        height: 80,
        capacity: 2,
        seatNumber: 1,
        offset: 18,
      });

      expect(headSeat).toEqual({ x: 120, y: -18 });
      expect(sweetheartSeat).toEqual({ x: 50, y: -18 });
    });

    it('places rectangular and square table seats clockwise across all 4 edges with optional origin offset', () => {
      const eightSeats = Array.from({ length: 8 }, (_, idx) =>
        computeSeatPosition({
          shape: 'rectangular',
          width: 200,
          height: 100,
          capacity: 8,
          seatNumber: idx + 1,
          offset: 18,
        })
      );

      // Top (2 seats: y = -18), Right (2 seats: x = 218), Bottom (2 seats: y = 118), Left (2 seats: x = -18)
      expect(eightSeats.slice(0, 2).map((p) => p.y)).toEqual([-18, -18]);
      expect(eightSeats.slice(2, 4).map((p) => p.x)).toEqual([218, 218]);
      expect(eightSeats.slice(4, 6).map((p) => p.y)).toEqual([118, 118]);
      expect(eightSeats.slice(6, 8).map((p) => p.x)).toEqual([-18, -18]);

      const squareWithOrigin = computeSeatPosition({
        shape: 'square',
        width: 100,
        height: 100,
        capacity: 4,
        seatNumber: 1,
        offset: 10,
        originX: 50,
        originY: 40,
      });
      expect(squareWithOrigin).toEqual({ x: 100, y: 30 });
    });
  });
});
