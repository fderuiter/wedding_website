import { SubEventService } from '../service';
import { ApiError } from '@/utils/ApiError';

describe('SubEventService', () => {
  let service: SubEventService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      invitationCode: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      subEvent: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      contentNode: {
        findMany: jest.fn(),
      },
      subEventAccess: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      subEventRsvp: {
        upsert: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(mockPrisma)),
    };

    service = new SubEventService(mockPrisma);
  });

  describe('getScheduleForGuest', () => {
    it('returns only public sub-events for unauthenticated requests', async () => {
      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-1',
          title: 'Main Ceremony',
          isPrivate: false,
          startTime: new Date('2026-06-20T15:00:00Z'),
          rsvps: [],
        },
      ]);

      const events = await service.getScheduleForGuest();

      expect(mockPrisma.subEvent.findMany).toHaveBeenCalledWith({
        where: { isPrivate: false },
        orderBy: { startTime: 'asc' },
      });
      expect(events).toHaveLength(1);
      expect(events[0].title).toBe('Main Ceremony');
      expect(events[0].isPrivate).toBe(false);
      expect(events[0].userRsvp).toBeNull();
    });

    it('returns public sub-events and assigned private sub-events for authenticated guest', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-123',
        code: 'VIPGUEST',
      });

      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-1',
          title: 'Main Ceremony',
          isPrivate: false,
          startTime: new Date('2026-06-20T15:00:00Z'),
          rsvps: [],
        },
        {
          id: 'se-2',
          title: 'Rehearsal Dinner',
          isPrivate: true,
          startTime: new Date('2026-06-19T18:00:00Z'),
          rsvps: [
            {
              status: 'attending',
              plusOneCount: 1,
              dietaryNotes: 'Vegetarian',
            },
          ],
        },
      ]);

      const events = await service.getScheduleForGuest('VIPGUEST');

      expect(mockPrisma.invitationCode.findUnique).toHaveBeenCalledWith({
        where: { code: 'VIPGUEST' },
        select: { id: true },
      });

      expect(events).toHaveLength(2);
      expect(events[0].title).toBe('Main Ceremony');
      expect(events[1].title).toBe('Rehearsal Dinner');
      expect(events[1].isPrivate).toBe(true);
      expect(events[1].userRsvp).toEqual({
        status: 'attending',
        plusOneCount: 1,
        dietaryNotes: 'Vegetarian',
      });
    });

    it('falls back to ContentNode schedule items if SubEvent table is empty', async () => {
      mockPrisma.subEvent.findMany.mockResolvedValue([]);
      mockPrisma.contentNode.findMany.mockResolvedValue([
        {
          id: 'cn-1',
          type: 'Schedule',
          data: { title: 'Welcome Drinks', startTime: '2026-06-19T17:00:00Z', isPrivate: false },
        },
      ]);

      const events = await service.getScheduleForGuest();

      expect(events).toHaveLength(1);
      expect(events[0].title).toBe('Welcome Drinks');
    });
  });

  describe('submitSubEventRsvps', () => {
    it('throws 401 error if invitation code is invalid', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue(null);

      await expect(
        service.submitSubEventRsvps('INVALID', [
          { subEventId: 'se-1', status: 'attending' },
        ])
      ).rejects.toThrow(ApiError);
    });

    it('throws 403 error if guest attempts to RSVP to an unassigned private event', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-123',
        guestName: 'John Doe',
      });

      mockPrisma.subEvent.findUnique.mockResolvedValue({
        id: 'se-private',
        title: 'Secret Dinner',
        isPrivate: true,
        accesses: [], // Guest does NOT have access
      });

      await expect(
        service.submitSubEventRsvps('MYCODE', [
          { subEventId: 'se-private', status: 'attending' },
        ])
      ).rejects.toThrow(ApiError);
    });

    it('upserts sub-event RSVP if authorized', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-123',
        guestName: 'John Doe',
      });

      mockPrisma.subEvent.findUnique.mockResolvedValue({
        id: 'se-private',
        title: 'Rehearsal Dinner',
        isPrivate: true,
        accesses: [{ invitationCodeId: 'inv-123' }], // Authorized!
      });

      mockPrisma.subEventRsvp.upsert.mockResolvedValue({
        id: 'rsvp-1',
        subEventId: 'se-private',
        invitationCodeId: 'inv-123',
        status: 'attending',
        plusOneCount: 1,
        dietaryNotes: 'Gluten-Free',
      });

      const results = await service.submitSubEventRsvps('MYCODE', [
        { subEventId: 'se-private', status: 'attending', plusOneCount: 1, dietaryNotes: 'Gluten-Free' },
      ]);

      expect(results).toHaveLength(1);
      expect(mockPrisma.subEventRsvp.upsert).toHaveBeenCalledWith({
        where: {
          subEventId_invitationCodeId: {
            subEventId: 'se-private',
            invitationCodeId: 'inv-123',
          },
        },
        create: {
          subEventId: 'se-private',
          invitationCodeId: 'inv-123',
          status: 'attending',
          plusOneCount: 1,
          dietaryNotes: 'Gluten-Free',
        },
        update: {
          status: 'attending',
          plusOneCount: 1,
          dietaryNotes: 'Gluten-Free',
        },
      });
    });
  });

  describe('updateInvitationSubEventAccess', () => {
    it('updates allowed sub-events for an invitation code', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-123',
        code: 'CODE123',
      });

      const result = await service.updateInvitationSubEventAccess('inv-123', ['se-1', 'se-2']);

      expect(mockPrisma.subEventAccess.deleteMany).toHaveBeenCalledWith({
        where: { invitationCodeId: 'inv-123' },
      });
      expect(mockPrisma.subEventAccess.createMany).toHaveBeenCalledWith({
        data: [
          { subEventId: 'se-1', invitationCodeId: 'inv-123' },
          { subEventId: 'se-2', invitationCodeId: 'inv-123' },
        ],
      });
      expect(result.allowedSubEventIds).toEqual(['se-1', 'se-2']);
    });
  });
});
