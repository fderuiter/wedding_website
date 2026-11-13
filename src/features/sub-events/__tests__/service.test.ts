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
        count: jest.fn(),
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

  describe('getSubEventByIdForGuest', () => {
    it('throws 404 error if id is missing or whitespace', async () => {
      await expect(service.getSubEventByIdForGuest('')).rejects.toThrow(ApiError);
      await expect(service.getSubEventByIdForGuest('   ')).rejects.toThrow(ApiError);
    });

    it('returns public sub-event for unauthenticated visitor', async () => {
      mockPrisma.subEvent.findUnique.mockResolvedValue({
        id: 'se-1',
        title: 'Main Ceremony',
        description: 'Wedding ceremony',
        isPrivate: false,
        startTime: new Date('2026-06-20T15:00:00Z'),
        endTime: new Date('2026-06-20T16:00:00Z'),
        locationName: 'Chapel',
        location: 'Chapel, Main St',
        category: 'Ceremony',
        accesses: [],
        rsvps: [],
      });

      const event = await service.getSubEventByIdForGuest('se-1');

      expect(event.id).toBe('se-1');
      expect(event.title).toBe('Main Ceremony');
      expect(event.isPrivate).toBe(false);
      expect(event.userRsvp).toBeNull();
    });

    it('returns public sub-event for authenticated guest', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-123',
        code: 'GUESTCODE',
      });
      mockPrisma.subEvent.findUnique.mockResolvedValue({
        id: 'se-1',
        title: 'Main Ceremony',
        isPrivate: false,
        startTime: new Date('2026-06-20T15:00:00Z'),
        endTime: new Date('2026-06-20T16:00:00Z'),
        accesses: [],
        rsvps: [],
      });

      const event = await service.getSubEventByIdForGuest('se-1', 'GUESTCODE');

      expect(event.id).toBe('se-1');
      expect(event.title).toBe('Main Ceremony');
    });

    it('throws 403 error when unauthenticated visitor requests private sub-event', async () => {
      mockPrisma.subEvent.findUnique.mockResolvedValue({
        id: 'se-private',
        title: 'Rehearsal Dinner',
        isPrivate: true,
        accesses: [],
        rsvps: [],
      });

      await expect(service.getSubEventByIdForGuest('se-private')).rejects.toThrow(ApiError);
      await expect(service.getSubEventByIdForGuest('se-private')).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('throws 403 error when guest lacks access to private sub-event', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-unauthorized',
        code: 'NOTINVITED',
      });
      mockPrisma.subEvent.findUnique.mockResolvedValue({
        id: 'se-private',
        title: 'Rehearsal Dinner',
        isPrivate: true,
        accesses: [],
        rsvps: [],
      });

      await expect(service.getSubEventByIdForGuest('se-private', 'NOTINVITED')).rejects.toThrow(ApiError);
      await expect(service.getSubEventByIdForGuest('se-private', 'NOTINVITED')).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('returns private sub-event when authenticated guest has access', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-vip',
        code: 'VIPCODE',
      });
      mockPrisma.subEvent.findUnique.mockResolvedValue({
        id: 'se-private',
        title: 'Rehearsal Dinner',
        description: 'Private dinner',
        isPrivate: true,
        startTime: new Date('2026-06-19T18:00:00Z'),
        endTime: new Date('2026-06-19T21:00:00Z'),
        locationName: 'Bistro',
        accesses: [{ invitationCodeId: 'inv-vip' }],
        rsvps: [{ status: 'attending', plusOneCount: 1, dietaryNotes: 'Vegetarian' }],
      });

      const event = await service.getSubEventByIdForGuest('se-private', 'VIPCODE');

      expect(event.id).toBe('se-private');
      expect(event.title).toBe('Rehearsal Dinner');
      expect(event.isPrivate).toBe(true);
      expect(event.userRsvp).toEqual({
        status: 'attending',
        plusOneCount: 1,
        dietaryNotes: 'Vegetarian',
      });
    });

    it('throws 404 error when sub-event is not found in SubEvent or ContentNode', async () => {
      mockPrisma.subEvent.findUnique.mockResolvedValue(null);
      mockPrisma.contentNode.findUnique = jest.fn().mockResolvedValue(null);

      await expect(service.getSubEventByIdForGuest('nonexistent')).rejects.toThrow(ApiError);
      await expect(service.getSubEventByIdForGuest('nonexistent')).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('returns public ContentNode fallback event if not in SubEvent table', async () => {
      mockPrisma.subEvent.findUnique.mockResolvedValue(null);
      mockPrisma.contentNode.findUnique = jest.fn().mockResolvedValue({
        id: 'cn-1',
        type: 'Schedule',
        data: {
          title: 'Brunch',
          description: 'Farewell Brunch',
          startTime: '2026-06-21T10:00:00Z',
          endTime: '2026-06-21T12:00:00Z',
          locationName: 'Patio',
          isPrivate: false,
          attireRules: 'Casual',
        },
      });

      const event = await service.getSubEventByIdForGuest('cn-1');

      expect(event.id).toBe('cn-1');
      expect(event.title).toBe('Brunch');
      expect(event.attireRules).toBe('Casual');
      expect(event.isPrivate).toBe(false);
    });

    it('throws 403 error for private ContentNode fallback', async () => {
      mockPrisma.subEvent.findUnique.mockResolvedValue(null);
      mockPrisma.contentNode.findUnique = jest.fn().mockResolvedValue({
        id: 'cn-priv',
        type: 'Schedule',
        data: {
          title: 'Secret Party',
          isPrivate: true,
        },
      });

      await expect(service.getSubEventByIdForGuest('cn-priv')).rejects.toThrow(ApiError);
      await expect(service.getSubEventByIdForGuest('cn-priv')).rejects.toMatchObject({
        statusCode: 403,
      });
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

  describe('batchUpdateSubEventAccess', () => {
    it('grants access for guests matched by partyTags in a single transaction', async () => {
      mockPrisma.invitationCode.findMany.mockResolvedValue([
        { id: 'inv-1' },
        { id: 'inv-2' },
      ]);
      mockPrisma.subEventAccess.createMany.mockResolvedValue({ count: 2 });

      const result = await service.batchUpdateSubEventAccess({
        partyTags: ['Bridal Party'],
        subEventIds: ['se-rehearsal'],
        action: 'grant',
      });

      expect(mockPrisma.invitationCode.findMany).toHaveBeenCalledWith({
        where: { OR: [{ partyTags: { hasSome: ['Bridal Party'] } }] },
        select: { id: true },
      });
      expect(mockPrisma.subEventAccess.createMany).toHaveBeenCalledWith({
        data: [
          { subEventId: 'se-rehearsal', invitationCodeId: 'inv-1' },
          { subEventId: 'se-rehearsal', invitationCodeId: 'inv-2' },
        ],
        skipDuplicates: true,
      });
      expect(result).toEqual({
        success: true,
        count: 2,
        updatedCount: 2,
        targetCodeCount: 2,
        subEventIds: ['se-rehearsal'],
        action: 'grant',
      });
    });

    it('revokes access for specified invitationCodeIds', async () => {
      mockPrisma.invitationCode.findMany.mockResolvedValue([
        { id: 'inv-1' },
      ]);
      mockPrisma.subEventAccess.deleteMany.mockResolvedValue({ count: 1 });

      const result = await service.batchUpdateSubEventAccess({
        invitationCodeIds: ['inv-1'],
        subEventIds: ['se-1', 'se-2'],
        action: 'revoke',
      });

      expect(mockPrisma.subEventAccess.deleteMany).toHaveBeenCalledWith({
        where: {
          invitationCodeId: { in: ['inv-1'] },
          subEventId: { in: ['se-1', 'se-2'] },
        },
      });
      expect(result.count).toBe(1);
    });

    it('sets access for guests matched by householdName and partyGroups', async () => {
      mockPrisma.invitationCode.findMany.mockResolvedValue([
        { id: 'inv-10' },
      ]);
      mockPrisma.subEventAccess.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.subEventAccess.createMany.mockResolvedValue({ count: 1 });

      const result = await service.batchUpdateSubEventAccess({
        householdName: 'Smith Family',
        partyGroups: ['VIP'],
        subEventIds: ['se-brunch'],
        action: 'set',
      });

      expect(mockPrisma.invitationCode.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { partyGroup: { in: ['VIP'] } },
            { householdName: { in: ['Smith Family'] } },
          ],
        },
        select: { id: true },
      });
      expect(mockPrisma.subEventAccess.deleteMany).toHaveBeenCalledWith({
        where: {
          invitationCodeId: { in: ['inv-10'] },
          subEventId: { in: ['se-brunch'] },
        },
      });
      expect(mockPrisma.subEventAccess.createMany).toHaveBeenCalledWith({
        data: [{ subEventId: 'se-brunch', invitationCodeId: 'inv-10' }],
        skipDuplicates: true,
      });
      expect(result.count).toBe(1);
    });

    it('returns zero updatedCount if no target invitation codes are found', async () => {
      mockPrisma.invitationCode.findMany.mockResolvedValue([]);

      const result = await service.batchUpdateSubEventAccess({
        partyTags: ['NonExistentTag'],
        subEventIds: ['se-1'],
        action: 'grant',
      });

      expect(result).toEqual({
        success: true,
        count: 0,
        updatedCount: 0,
        targetCodeCount: 0,
        subEventIds: ['se-1'],
        action: 'grant',
      });
    });
  });

  describe('getAccessMatrix', () => {
    it('returns paginated invitation codes with default page=1 and limit=25', async () => {
      mockPrisma.subEvent.findMany.mockResolvedValue([
        { id: 'se-1', title: 'Ceremony', isPrivate: false, accesses: [] },
      ]);
      mockPrisma.invitationCode.count.mockResolvedValue(50);
      mockPrisma.invitationCode.findMany.mockImplementation((args: any) => {
        if (args?.distinct) return Promise.resolve([]);
        if (args?.select && Object.keys(args.select).length === 1 && args.select.partyTags) {
          return Promise.resolve([]);
        }
        return Promise.resolve([
          {
            id: 'inv-1',
            code: 'GUEST1',
            guestName: 'Alice',
            householdName: 'Smith',
            partyGroup: 'Family',
            partyTags: ['VIP'],
            subEventAccesses: [{ subEventId: 'se-1' }],
          },
        ]);
      });

      const matrix = await service.getAccessMatrix();

      expect(matrix.pagination).toEqual({
        total: 50,
        page: 1,
        limit: 25,
        totalPages: 2,
      });
      expect(matrix.invitationCodes).toHaveLength(1);
    });

    it('caps max limit at 100 and applies filter predicates in query', async () => {
      mockPrisma.subEvent.findMany.mockResolvedValue([]);
      mockPrisma.invitationCode.count.mockResolvedValue(150);
      mockPrisma.invitationCode.findMany.mockImplementation((args: any) => {
        if (args?.distinct) return Promise.resolve([]);
        if (args?.select?.partyTags) return Promise.resolve([]);
        return Promise.resolve([]);
      });

      const matrix = await service.getAccessMatrix({
        page: 2,
        limit: 200,
        search: 'Alice',
        partyTag: 'VIP',
        partyGroup: 'Family',
        householdName: 'Smith',
      });

      expect(matrix.pagination.limit).toBe(100);
      expect(mockPrisma.invitationCode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { guestName: { contains: 'Alice', mode: 'insensitive' } },
              { code: { contains: 'Alice', mode: 'insensitive' } },
              { householdName: { contains: 'Alice', mode: 'insensitive' } },
            ],
            partyTags: { has: 'VIP' },
            partyGroup: 'Family',
            householdName: 'Smith',
          },
          skip: 100,
          take: 100,
        })
      );
    });
  });
});
