import { SubEventService } from '../service';
import { ApiError } from '@/utils/ApiError';
import { getAttendanceStatus, matchDietaryCategory } from '@/features/registry';
import { summarizeBroadcastAudience } from '@/features/broadcast';

describe('SubEventService', () => {
  let service: SubEventService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      invitationCode: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
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
        findMany: jest.fn().mockResolvedValue([]),
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
      expect(events[0].isReadOnly).toBe(false);
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
        where: { code: 'VIPGUEST', isSample: false },
        select: { id: true, dietaryNotes: true, partyTags: true },
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
      expect(events[0].isReadOnly).toBe(true);
    });

    it('filters private ContentNode fallback items with boolean or string "true" while keeping string "false" public', async () => {
      mockPrisma.subEvent.findMany.mockResolvedValue([]);
      mockPrisma.contentNode.findMany.mockResolvedValue([
        {
          id: 'cn-priv-bool',
          type: 'Schedule',
          data: { title: 'Private Bool Event', startTime: '2026-06-19T17:00:00Z', isPrivate: true },
        },
        {
          id: 'cn-priv-str',
          type: 'Schedule',
          data: { title: 'Private String Event', startTime: '2026-06-19T18:00:00Z', isPrivate: 'TRUE' },
        },
        {
          id: 'cn-pub-str',
          type: 'Schedule',
          data: { title: 'Public String False Event', startTime: '2026-06-20T15:00:00Z', isPrivate: 'false' },
        },
      ]);

      const events = await service.getScheduleForGuest();

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('cn-pub-str');
      expect(events[0].title).toBe('Public String False Event');
    });

    it('treats sample invitation code as unauthenticated and returns only public sub-events', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'sample-inv-1',
        code: 'SMITH2026',
        isSample: true,
      });
      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-1',
          title: 'Main Ceremony',
          isPrivate: false,
          startTime: new Date('2026-06-20T15:00:00Z'),
        },
      ]);

      const events = await service.getScheduleForGuest('SMITH2026');

      expect(mockPrisma.invitationCode.findUnique).toHaveBeenCalledWith({
        where: { code: 'SMITH2026', isSample: false },
        select: { id: true, dietaryNotes: true, partyTags: true },
      });
      expect(mockPrisma.subEvent.findMany).toHaveBeenCalledWith({
        where: { isPrivate: false },
        orderBy: { startTime: 'asc' },
      });
      expect(events).toHaveLength(1);
    });

    it('pre-populates userRsvp dietaryNotes from InvitationCode when guest has no SubEventRsvp yet', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-allergy',
        code: 'ALLERGY26',
        dietaryNotes: 'Severe peanut allergy',
      });
      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-ceremony',
          title: 'Ceremony',
          isPrivate: false,
          startTime: new Date('2026-06-20T15:00:00Z'),
          rsvps: [],
        },
        {
          id: 'se-dinner',
          title: 'Reception Dinner',
          isPrivate: false,
          startTime: new Date('2026-06-20T18:00:00Z'),
          rsvps: [
            {
              status: 'attending',
              plusOneCount: 0,
              dietaryNotes: 'Vegan, Severe peanut allergy',
            },
          ],
        },
      ]);

      const events = await service.getScheduleForGuest('ALLERGY26');

      expect(events[0].userRsvp).toEqual({
        status: 'pending',
        plusOneCount: 0,
        dietaryNotes: 'Severe peanut allergy',
      });
      expect(events[1].userRsvp).toEqual({
        status: 'attending',
        plusOneCount: 0,
        dietaryNotes: 'Vegan, Severe peanut allergy',
      });
    });
  });

  describe('getPlusOneAllowanceForGuest', () => {
    it('returns null when code is missing or invitation is not found', async () => {
      expect(await service.getPlusOneAllowanceForGuest()).toBeNull();

      mockPrisma.invitationCode.findUnique.mockResolvedValue(null);
      expect(await service.getPlusOneAllowanceForGuest('UNKNOWN')).toBeNull();
    });

    it('returns non-negative plusOneAllocations for valid invitation code', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        plusOneAllocations: 2,
      });

      expect(await service.getPlusOneAllowanceForGuest('VIPGUEST')).toBe(2);
      expect(mockPrisma.invitationCode.findUnique).toHaveBeenCalledWith({
        where: { code: 'VIPGUEST', isSample: false },
        select: { plusOneAllocations: true },
      });
    });

    it('returns null for sample invitation code', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        plusOneAllocations: 2,
        isSample: true,
      });

      expect(await service.getPlusOneAllowanceForGuest('JOHNSON2026')).toBeNull();
      expect(mockPrisma.invitationCode.findUnique).toHaveBeenCalledWith({
        where: { code: 'JOHNSON2026', isSample: false },
        select: { plusOneAllocations: true },
      });
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

    it('throws 403 error when sample invitation code requests private sub-event', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'sample-inv-1',
        code: 'SMITH2026',
        isSample: true,
      });
      mockPrisma.subEvent.findUnique.mockResolvedValue({
        id: 'se-private',
        title: 'Rehearsal Dinner',
        isPrivate: true,
        accesses: [{ invitationCodeId: 'sample-inv-1' }],
        rsvps: [],
      });

      await expect(service.getSubEventByIdForGuest('se-private', 'SMITH2026')).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(mockPrisma.invitationCode.findUnique).toHaveBeenCalledWith({
        where: { code: 'SMITH2026', isSample: false },
        select: { id: true, dietaryNotes: true, partyTags: true },
      });
    });

    it('pre-populates userRsvp dietaryNotes on getSubEventByIdForGuest when guest has no SubEventRsvp yet', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-allergy',
        code: 'ALLERGY26',
        dietaryNotes: 'Celiac gluten-free',
      });
      mockPrisma.subEvent.findUnique.mockResolvedValue({
        id: 'se-1',
        title: 'Reception',
        isPrivate: false,
        startTime: new Date('2026-06-20T18:00:00Z'),
        accesses: [],
        rsvps: [],
      });

      const event = await service.getSubEventByIdForGuest('se-1', 'ALLERGY26');
      expect(event.userRsvp).toEqual({
        status: 'pending',
        plusOneCount: 0,
        dietaryNotes: 'Celiac gluten-free',
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

    it('enforces 403 for case-insensitive string "true" and allows string "false" on ContentNode fallback', async () => {
      mockPrisma.subEvent.findUnique.mockResolvedValue(null);
      mockPrisma.contentNode.findUnique = jest
        .fn()
        .mockResolvedValueOnce({
          id: 'cn-priv-str',
          type: 'Schedule',
          data: { title: 'String Private Party', isPrivate: 'True' },
        })
        .mockResolvedValueOnce({
          id: 'cn-pub-str',
          type: 'Schedule',
          data: { title: 'String Public Brunch', isPrivate: 'false' },
        });

      await expect(service.getSubEventByIdForGuest('cn-priv-str')).rejects.toMatchObject({
        statusCode: 403,
      });

      const pubEvent = await service.getSubEventByIdForGuest('cn-pub-str');
      expect(pubEvent.id).toBe('cn-pub-str');
      expect(pubEvent.title).toBe('String Public Brunch');
      expect(pubEvent.isPrivate).toBe(false);
    });
  });

  describe('submitSubEventRsvps', () => {
    it('throws 401 error if invitation code is invalid', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue(null);

      await expect(
        service.submitSubEventRsvps('INVALID', [
          { subEventId: 'se-1', status: 'attending', plusOneCount: 0, dietaryNotes: '' },
        ])
      ).rejects.toThrow(ApiError);
    });

    it('throws 401 error if invitation code is a sample record', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'sample-inv-1',
        guestName: 'Mr. & Mrs. Robert Smith',
        plusOneAllocations: 0,
        isSample: true,
      });

      await expect(
        service.submitSubEventRsvps('SMITH2026', [
          { subEventId: 'se-1', status: 'attending', plusOneCount: 0, dietaryNotes: '' },
        ])
      ).rejects.toMatchObject({
        statusCode: 401,
        message: 'Invalid invitation session.',
      });
      expect(mockPrisma.invitationCode.findUnique).toHaveBeenCalledWith({
        where: { code: 'SMITH2026', isSample: false },
        select: { id: true, guestName: true, plusOneAllocations: true, partyTags: true },
      });
    });

    it('returns an empty array immediately if submission list is empty', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-123',
        guestName: 'John Doe',
      });

      const results = await service.submitSubEventRsvps('MYCODE', []);

      expect(results).toEqual([]);
      expect(mockPrisma.subEvent.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws 404 error if any requested sub-event is missing', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-123',
        guestName: 'John Doe',
      });

      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-1',
          title: 'Ceremony',
          isPrivate: false,
          accesses: [],
        },
      ]);

      await expect(
        service.submitSubEventRsvps('MYCODE', [
          { subEventId: 'se-1', status: 'attending', plusOneCount: 0, dietaryNotes: '' },
          { subEventId: 'se-nonexistent', status: 'attending', plusOneCount: 0, dietaryNotes: '' },
        ])
      ).rejects.toThrow(new ApiError(404, 'Sub-event with ID se-nonexistent not found.'));
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws 403 error if guest attempts to RSVP to an unassigned private event', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-123',
        guestName: 'John Doe',
      });

      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-private',
          title: 'Secret Dinner',
          isPrivate: true,
          accesses: [], // Guest does NOT have access
        },
      ]);

      await expect(
        service.submitSubEventRsvps('MYCODE', [
          { subEventId: 'se-private', status: 'attending', plusOneCount: 0, dietaryNotes: '' },
        ])
      ).rejects.toThrow(new ApiError(403, 'Forbidden: You do not have access to private event "Secret Dinner".'));
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('upserts sub-event RSVP if authorized', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-123',
        guestName: 'John Doe',
        plusOneAllocations: 1,
      });

      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-private',
          title: 'Rehearsal Dinner',
          isPrivate: true,
          accesses: [{ invitationCodeId: 'inv-123' }], // Authorized!
        },
      ]);

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

      expect(mockPrisma.subEvent.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['se-private'] },
        },
        include: {
          accesses: {
            where: {
              invitationCodeId: 'inv-123',
            },
          },
        },
      });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
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
          mealSelections: [],
          customAnswers: {},
          plusOneNames: [],
        },
        update: {
          status: 'attending',
          plusOneCount: 1,
          dietaryNotes: 'Gluten-Free',
          mealSelections: [],
          customAnswers: {},
          plusOneNames: [],
        },
      });
    });

    it('batches multiple sub-event submissions in a single findMany and single transaction', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-123',
        guestName: 'John Doe',
      });

      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-1',
          title: 'Ceremony',
          isPrivate: false,
          accesses: [],
        },
        {
          id: 'se-2',
          title: 'Rehearsal Dinner',
          isPrivate: true,
          accesses: [{ invitationCodeId: 'inv-123' }],
        },
      ]);

      mockPrisma.subEventRsvp.upsert
        .mockResolvedValueOnce({
          id: 'rsvp-1',
          subEventId: 'se-1',
          invitationCodeId: 'inv-123',
          status: 'attending',
          plusOneCount: 0,
          dietaryNotes: '',
        })
        .mockResolvedValueOnce({
          id: 'rsvp-2',
          subEventId: 'se-2',
          invitationCodeId: 'inv-123',
          status: 'declined',
          plusOneCount: 0,
          dietaryNotes: 'None',
        });

      const submissions = [
        { subEventId: 'se-1', status: 'attending' as const, plusOneCount: 0, dietaryNotes: '' },
        { subEventId: 'se-2', status: 'declined' as const, plusOneCount: 0, dietaryNotes: 'None' },
      ];

      const results = await service.submitSubEventRsvps('MYCODE', submissions);

      expect(mockPrisma.subEvent.findMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['se-1', 'se-2'] },
        },
        include: {
          accesses: {
            where: {
              invitationCodeId: 'inv-123',
            },
          },
        },
      });
      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.subEventRsvp.upsert).toHaveBeenCalledTimes(2);
      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('rsvp-1');
      expect(results[1].id).toBe('rsvp-2');
    });

    it('rolls back transaction if a database write fails during batch execution', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-123',
        guestName: 'John Doe',
      });

      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-1',
          title: 'Ceremony',
          isPrivate: false,
          accesses: [],
        },
      ]);

      mockPrisma.subEventRsvp.upsert.mockRejectedValue(new Error('Database write error'));

      await expect(
        service.submitSubEventRsvps('MYCODE', [
          { subEventId: 'se-1', status: 'attending', plusOneCount: 0, dietaryNotes: '' },
        ])
      ).rejects.toThrow('Database write error');

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('throws 400 error if guest attempts to RSVP to a read-only ContentNode fallback item', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-123',
        guestName: 'John Doe',
        plusOneAllocations: 1,
      });
      mockPrisma.subEvent.findMany.mockResolvedValue([]);
      mockPrisma.contentNode.findMany.mockResolvedValue([
        {
          id: 'cn-fallback-1',
          type: 'Schedule',
          data: { title: 'Fallback Schedule Item' },
        },
      ]);

      await expect(
        service.submitSubEventRsvps('MYCODE', [
          { subEventId: 'cn-fallback-1', status: 'attending', plusOneCount: 0, dietaryNotes: '' },
        ])
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'RSVPs cannot be submitted for read-only schedule items.',
      });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects plusOneCount > 0 when guest plusOneAllocations is 0', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-zero',
        guestName: 'Solo Guest',
        plusOneAllocations: 0,
      });
      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-1',
          title: 'Ceremony',
          isPrivate: false,
          accesses: [],
        },
      ]);

      await expect(
        service.submitSubEventRsvps('SOLOCODE', [
          { subEventId: 'se-1', status: 'attending', plusOneCount: 1, dietaryNotes: '' },
        ])
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Plus-one guests are not allocated for your invitation.',
      });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('allows submitting up to positive plusOneAllocations and rejects above that limit', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-two',
        guestName: 'Party Guest',
        plusOneAllocations: 2,
      });
      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-1',
          title: 'Reception',
          isPrivate: false,
          accesses: [],
        },
      ]);
      mockPrisma.subEventRsvp.upsert.mockResolvedValue({
        id: 'rsvp-ok',
        subEventId: 'se-1',
        invitationCodeId: 'inv-two',
        status: 'attending',
        plusOneCount: 2,
        dietaryNotes: '',
      });

      const okResult = await service.submitSubEventRsvps('PARTY2', [
        { subEventId: 'se-1', status: 'attending', plusOneCount: 2, dietaryNotes: '' },
      ]);
      expect(okResult).toHaveLength(1);
      expect(okResult[0].plusOneCount).toBe(2);

      await expect(
        service.submitSubEventRsvps('PARTY2', [
          { subEventId: 'se-1', status: 'attending', plusOneCount: 3, dietaryNotes: '' },
        ])
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Plus-one count (3) exceeds your allocated limit of 2.',
      });
    });

    it('treats null or undefined plusOneAllocations on legacy InvitationCode rows as 0', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-legacy',
        guestName: 'Legacy Guest',
        plusOneAllocations: null,
      });
      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-1',
          title: 'Ceremony',
          isPrivate: false,
          accesses: [],
        },
      ]);

      await expect(
        service.submitSubEventRsvps('LEGACYCODE', [
          { subEventId: 'se-1', status: 'attending', plusOneCount: 1, dietaryNotes: '' },
        ])
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Plus-one guests are not allocated for your invitation.',
      });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects batch submission before transaction if any item exceeds plusOneAllocations', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-batch',
        guestName: 'Batch Guest',
        plusOneAllocations: 1,
      });
      mockPrisma.subEvent.findMany.mockResolvedValue([
        { id: 'se-1', title: 'Ceremony', isPrivate: false, accesses: [] },
        { id: 'se-2', title: 'Reception', isPrivate: false, accesses: [] },
      ]);

      await expect(
        service.submitSubEventRsvps('BATCHCODE', [
          { subEventId: 'se-1', status: 'attending', plusOneCount: 1, dietaryNotes: '' },
          { subEventId: 'se-2', status: 'attending', plusOneCount: 2, dietaryNotes: '' },
        ])
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Plus-one count (2) exceeds your allocated limit of 1.',
      });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockPrisma.subEventRsvp.upsert).not.toHaveBeenCalled();
    });

    it('resets plusOneCount to 0 when status is declined even after plusOneAllocations is lowered', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-declined',
        guestName: 'Declining Guest',
        plusOneAllocations: 0,
      });
      mockPrisma.subEvent.findMany.mockResolvedValue([
        { id: 'se-1', title: 'Reception', isPrivate: false, accesses: [] },
      ]);
      mockPrisma.subEventRsvp.upsert.mockResolvedValue({
        id: 'rsvp-declined',
        subEventId: 'se-1',
        invitationCodeId: 'inv-declined',
        status: 'declined',
        plusOneCount: 0,
        dietaryNotes: 'Cannot make it',
      });

      const results = await service.submitSubEventRsvps('DECLINECODE', [
        { subEventId: 'se-1', status: 'declined', plusOneCount: 2, dietaryNotes: 'Cannot make it' },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].plusOneCount).toBe(0);
      expect(mockPrisma.subEventRsvp.upsert).toHaveBeenCalledWith({
        where: {
          subEventId_invitationCodeId: {
            subEventId: 'se-1',
            invitationCodeId: 'inv-declined',
          },
        },
        create: {
          subEventId: 'se-1',
          invitationCodeId: 'inv-declined',
          status: 'declined',
          plusOneCount: 0,
          dietaryNotes: 'Cannot make it',
          mealSelections: [],
          customAnswers: {},
          plusOneNames: [],
        },
        update: {
          status: 'declined',
          plusOneCount: 0,
          dietaryNotes: 'Cannot make it',
          mealSelections: [],
          customAnswers: {},
          plusOneNames: [],
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

    it('returns full sub-event schedule metadata and uncapped allowedInvitationCodeIds across >100 guests', async () => {
      const uncappedAccesses = Array.from({ length: 135 }, (_, idx) => ({
        invitationCodeId: `inv-${idx + 1}`,
      }));

      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-vip',
          title: 'Rehearsal Dinner',
          description: 'Bridal party dinner',
          startTime: new Date('2026-09-18T18:00:00.000Z'),
          endTime: new Date('2026-09-18T21:00:00.000Z'),
          locationName: 'Grand Ballroom',
          location: '100 Main St',
          category: 'Dining',
          isPrivate: true,
          accesses: uncappedAccesses,
        },
      ]);
      mockPrisma.invitationCode.count.mockResolvedValue(135);
      mockPrisma.invitationCode.findMany.mockImplementation((args: any) => {
        if (args?.distinct) return Promise.resolve([]);
        if (args?.select?.partyTags) return Promise.resolve([]);
        return Promise.resolve([]);
      });

      const matrix = await service.getAccessMatrix({ page: 1, limit: 25 });

      expect(matrix.subEvents).toEqual([
        {
          id: 'se-vip',
          title: 'Rehearsal Dinner',
          description: 'Bridal party dinner',
          startTime: '2026-09-18T18:00:00.000Z',
          endTime: '2026-09-18T21:00:00.000Z',
          locationName: 'Grand Ballroom',
          location: '100 Main St',
          category: 'Dining',
          isPrivate: true,
          allowedInvitationCodeIds: uncappedAccesses.map((a) => a.invitationCodeId),
        },
      ]);
      expect(matrix.subEvents[0].allowedInvitationCodeIds).toHaveLength(135);
      expect(matrix.subEvents[0].allowedInvitationCodeIds).toContain('inv-135');
    });

    it('runs count, scalar findMany, and one $queryRaw metadata query concurrently and matches fallback output', async () => {
      const startTime = new Date('2026-09-18T18:00:00.000Z');
      const endTime = new Date('2026-09-18T21:00:00.000Z');

      const rawClient: any = {
        invitationCode: {
          count: jest.fn().mockResolvedValue(2),
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'inv-1',
              code: 'VIP01',
              guestName: 'Alice Smith',
              householdName: 'Smith Family',
              partyGroup: 'Bridal Party',
              partyTags: ['VIP', 'Bridal Party'],
            },
            {
              id: 'inv-2',
              code: 'FRD02',
              guestName: 'Bob Jones',
              householdName: 'Jones Family',
              partyGroup: 'Friends',
              partyTags: ['Friends'],
            },
          ]),
        },
        subEvent: {
          findMany: jest.fn(),
        },
        $queryRaw: jest.fn().mockResolvedValue([
          {
            subEvents: [
              {
                id: 'se-1',
                title: 'Rehearsal Dinner',
                description: 'Private dinner',
                startTime: '2026-09-18T18:00:00.000Z',
                endTime: '2026-09-18T21:00:00.000Z',
                locationName: 'Oak Room',
                location: '100 Main St',
                category: 'Dining',
                isPrivate: true,
                mealOptions: [{ id: 'm-1', label: 'Salmon', dietaryTags: ['gluten-free'] }],
                customQuestions: [],
                allowedInvitationCodeIds: ['inv-1', 'inv-99'],
              },
              {
                id: 'se-2',
                title: 'Farewell Brunch',
                description: '',
                startTime: null,
                endTime: null,
                locationName: '',
                location: '',
                category: '',
                isPrivate: true,
                mealOptions: [],
                customQuestions: [],
                allowedInvitationCodeIds: ['inv-1'],
              },
            ],
            partyGroups: ['Friends', 'Bridal Party'],
            householdNames: ['Smith Family', 'Jones Family'],
            partyTags: [' VIP ', 'Friends', 'Bridal Party'],
          },
        ]),
      };

      const rawService = new SubEventService(rawClient);
      const rawMatrix = await rawService.getAccessMatrix({ page: 1, limit: 25 });

      expect(rawClient.$queryRaw).toHaveBeenCalledTimes(1);
      expect(rawClient.invitationCode.count).toHaveBeenCalledTimes(1);
      expect(rawClient.invitationCode.findMany).toHaveBeenCalledTimes(1);
      expect(rawClient.subEvent.findMany).not.toHaveBeenCalled();

      const scalarSelect = rawClient.invitationCode.findMany.mock.calls[0][0].select;
      expect(scalarSelect).not.toHaveProperty('subEventAccesses');

      expect(rawMatrix.invitationCodes[0].allowedSubEventIds).toEqual(['se-1', 'se-2']);
      expect(rawMatrix.invitationCodes[1].allowedSubEventIds).toEqual([]);
      expect(rawMatrix.subEvents[0].allowedInvitationCodeIds).toEqual(['inv-1', 'inv-99']);
      expect(rawMatrix.filterOptions).toEqual({
        partyTags: ['Bridal Party', 'Friends', 'VIP'],
        partyGroups: ['Bridal Party', 'Friends'],
        householdNames: ['Jones Family', 'Smith Family'],
      });

      // Verify identical output through the fallback path when $queryRaw is absent
      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-1',
          title: 'Rehearsal Dinner',
          description: 'Private dinner',
          startTime,
          endTime,
          locationName: 'Oak Room',
          location: '100 Main St',
          category: 'Dining',
          isPrivate: true,
          mealOptions: [{ id: 'm-1', label: 'Salmon', dietaryTags: ['gluten-free'] }],
          customQuestions: [],
          accesses: [{ invitationCodeId: 'inv-1' }, { invitationCodeId: 'inv-99' }],
        },
        {
          id: 'se-2',
          title: 'Farewell Brunch',
          description: '',
          startTime: null,
          endTime: null,
          locationName: '',
          location: '',
          category: '',
          isPrivate: true,
          mealOptions: [],
          customQuestions: [],
          accesses: [{ invitationCodeId: 'inv-1' }],
        },
      ]);
      mockPrisma.invitationCode.count.mockResolvedValue(2);
      mockPrisma.invitationCode.findMany.mockImplementation((args: any) => {
        if (args?.distinct?.includes('partyGroup')) {
          return Promise.resolve([{ partyGroup: 'Friends' }, { partyGroup: 'Bridal Party' }]);
        }
        if (args?.distinct?.includes('householdName')) {
          return Promise.resolve([
            { householdName: 'Smith Family' },
            { householdName: 'Jones Family' },
          ]);
        }
        if (args?.select && Object.keys(args.select).length === 1 && args.select.partyTags) {
          return Promise.resolve([
            { partyTags: [' VIP ', 'Bridal Party'] },
            { partyTags: ['Friends'] },
          ]);
        }
        return Promise.resolve([
          {
            id: 'inv-1',
            code: 'VIP01',
            guestName: 'Alice Smith',
            householdName: 'Smith Family',
            partyGroup: 'Bridal Party',
            partyTags: ['VIP', 'Bridal Party'],
            subEventAccesses: [{ subEventId: 'se-2' }, { subEventId: 'se-1' }],
          },
          {
            id: 'inv-2',
            code: 'FRD02',
            guestName: 'Bob Jones',
            householdName: 'Jones Family',
            partyGroup: 'Friends',
            partyTags: ['Friends'],
            subEventAccesses: [],
          },
        ]);
      });

      const fallbackMatrix = await service.getAccessMatrix({ page: 1, limit: 25 });
      expect(rawMatrix).toEqual(fallbackMatrix);
    });
  });

  describe('RSVP deadline, silent grace period, and manual lock enforcement', () => {
    it('accepts submissions silently during an active grace window and rejects with 403 once grace expires', async () => {
      mockPrisma.appConfig = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'global',
          rsvpOpen: true,
          rsvpDeadlineDate: '2026-08-15',
          rsvpGracePeriodHours: 48,
          rsvpClosedMessage: 'Online RSVPs have closed. Email hosts@example.com.',
          timezone: 'America/Chicago',
        }),
      };
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-1',
        guestName: 'Jane Guest',
        plusOneAllocations: 1,
        isSample: false,
      });
      mockPrisma.subEvent.findMany.mockResolvedValue([
        { id: 'se-1', title: 'Reception', isPrivate: false, accesses: [] },
      ]);
      mockPrisma.subEventRsvp.upsert.mockResolvedValue({
        id: 'rsvp-1',
        subEventId: 'se-1',
        invitationCodeId: 'inv-1',
        status: 'attending',
        plusOneCount: 1,
        dietaryNotes: 'Vegan',
      });

      // 12 hours past midnight America/Chicago (inside 48h grace window) -> accepted!
      const duringGrace = new Date('2026-08-16T17:00:00.000Z');
      const saved = await service.submitSubEventRsvps(
        'GUEST1',
        [{ subEventId: 'se-1', status: 'attending', plusOneCount: 1, dietaryNotes: 'Vegan' }],
        duringGrace
      );
      expect(saved).toHaveLength(1);
      expect(mockPrisma.subEventRsvp.upsert).toHaveBeenCalledTimes(1);

      // 49 hours past midnight America/Chicago (past 48h grace window) -> rejected with 403!
      const afterGrace = new Date('2026-08-18T06:00:00.000Z');
      await expect(
        service.submitSubEventRsvps(
          'GUEST1',
          [{ subEventId: 'se-1', status: 'declined', plusOneCount: 0, dietaryNotes: '' }],
          afterGrace
        )
      ).rejects.toMatchObject({
        statusCode: 403,
        message: 'Online RSVPs have closed. Email hosts@example.com.',
      });
      expect(mockPrisma.subEventRsvp.upsert).toHaveBeenCalledTimes(1);
    });

    it('rejects submissions with 403 when RSVPs are manually locked via rsvpOpen=false', async () => {
      mockPrisma.appConfig = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'global',
          rsvpOpen: false,
          rsvpDeadlineDate: '',
          rsvpGracePeriodHours: 0,
          rsvpClosedMessage: '<script>bad()</script>Seating is finalized — text Alex!',
          timezone: 'America/Chicago',
        }),
      };
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-1',
        guestName: 'Jane Guest',
        plusOneAllocations: 0,
        isSample: false,
      });

      await expect(
        service.submitSubEventRsvps('GUEST1', [
          { subEventId: 'se-1', status: 'attending', plusOneCount: 0, dietaryNotes: '' },
        ])
      ).rejects.toMatchObject({
        statusCode: 403,
        message: 'bad()Seating is finalized — text Alex!',
      });
      expect(mockPrisma.subEvent.findMany).not.toHaveBeenCalled();
    });
  });

  describe('JSONB mealOptions, customQuestions, plusOneNames, and InvitationCode atomic sync', () => {
    it('returns mealOptions, customQuestions, and saved plusOneNames for authenticated guests', async () => {
      mockPrisma.invitationCode.findUnique
        .mockResolvedValueOnce({ id: 'inv-jsonb' })
        .mockResolvedValueOnce({
          plusOneFirstName: 'Jordan',
          plusOneLastName: 'Taylor',
          extraFields: { plusOneNames: ['Jordan Taylor', 'Casey Morgan'] },
        });

      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-reception',
          title: 'Evening Reception',
          isPrivate: false,
          startTime: new Date('2026-06-20T18:00:00Z'),
          mealOptions: [
            { id: 'm-1', label: 'Herb Salmon', dietaryTags: ['gluten-free'] },
          ],
          customQuestions: [
            { id: 'q-1', prompt: 'Shuttle needed?', type: 'choice', required: true, options: ['Yes', 'No'] },
          ],
          rsvps: [
            {
              status: 'attending',
              plusOneCount: 1,
              dietaryNotes: '',
              mealSelections: ['m-1', 'm-1'],
              customAnswers: { 'q-1': 'Yes' },
              plusOneNames: ['Jordan Taylor'],
            },
          ],
        },
      ]);

      const schedule = await service.getScheduleForGuest('GUESTJSONB');
      const savedNames = await service.getSavedPlusOneNamesForGuest('GUESTJSONB');

      expect(schedule[0].mealOptions).toEqual([
        { id: 'm-1', label: 'Herb Salmon', description: '', dietaryTags: ['gluten-free'] },
      ]);
      expect(schedule[0].customQuestions).toEqual([
        { id: 'q-1', prompt: 'Shuttle needed?', type: 'choice', required: true, options: ['Yes', 'No'] },
      ]);
      expect(schedule[0].userRsvp).toEqual({
        status: 'attending',
        plusOneCount: 1,
        dietaryNotes: '',
        mealSelections: ['m-1', 'm-1'],
        customAnswers: { 'q-1': 'Yes' },
        plusOneNames: ['Jordan Taylor'],
      });
      expect(savedNames).toEqual(['Jordan Taylor', 'Casey Morgan']);
    });

    it('rejects inactive meal option IDs, missing party meal selections, and unanswered required custom questions', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-val',
        guestName: 'Alex Guest',
        plusOneAllocations: 1,
      });

      const receptionEvent = {
        id: 'se-rec',
        title: 'Evening Reception',
        isPrivate: false,
        accesses: [],
        mealOptions: [
          { id: 'meal-beef', label: 'Braised Beef', dietaryTags: ['gluten-free'] },
          { id: 'meal-veg', label: 'Wild Mushroom Risotto', dietaryTags: ['vegetarian'] },
        ],
        customQuestions: [
          {
            id: 'q-shuttle',
            prompt: 'Shuttle bus?',
            type: 'choice',
            required: true,
            options: ['Yes', 'No'],
          },
        ],
      };

      mockPrisma.subEvent.findMany.mockResolvedValue([receptionEvent]);

      await expect(
        service.submitSubEventRsvps('GUESTVAL', [
          {
            subEventId: 'se-rec',
            status: 'attending',
            plusOneCount: 0,
            dietaryNotes: '',
            mealSelections: ['stale-meal-id'],
            customAnswers: { 'q-shuttle': 'Yes' },
          },
        ])
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Invalid meal option "stale-meal-id" for event "Evening Reception".',
      });

      await expect(
        service.submitSubEventRsvps('GUESTVAL', [
          {
            subEventId: 'se-rec',
            status: 'attending',
            plusOneCount: 1,
            dietaryNotes: '',
            mealSelections: ['meal-beef'],
            customAnswers: { 'q-shuttle': 'Yes' },
          },
        ])
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Please select a meal option for all 2 attending guests for "Evening Reception".',
      });

      await expect(
        service.submitSubEventRsvps('GUESTVAL', [
          {
            subEventId: 'se-rec',
            status: 'attending',
            plusOneCount: 0,
            dietaryNotes: '',
            mealSelections: ['meal-beef'],
            customAnswers: {},
          },
        ])
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Please answer required question "Shuttle bus?" for "Evening Reception".',
      });

      await expect(
        service.submitSubEventRsvps('GUESTVAL', [
          {
            subEventId: 'se-rec',
            status: 'attending',
            plusOneCount: 0,
            dietaryNotes: '',
            mealSelections: ['meal-beef'],
            customAnswers: { 'q-shuttle': 'Maybe' },
          },
        ])
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Invalid choice "Maybe" for question "Shuttle bus?" in "Evening Reception".',
      });
    });

    it('clears mealSelections, customAnswers, plusOneNames, and plusOneCount when status changes to declined while preserving seated alert state', async () => {
      mockPrisma.invitationCode.findUnique
        .mockResolvedValueOnce({
          id: 'inv-clear',
          guestName: 'Sam Guest',
          plusOneAllocations: 2,
        })
        .mockResolvedValueOnce({
          used: true,
          usedAt: new Date('2026-05-01T12:00:00Z'),
          plusOneFirstName: 'Pat',
          plusOneLastName: 'Partner',
          dietaryNotes: 'No dairy',
          extraFields: { phone: '+15550001111', attendanceStatus: 'attending' },
        });

      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-rec',
          title: 'Evening Reception',
          isPrivate: false,
          accesses: [],
          mealOptions: [{ id: 'm-1', label: 'Risotto', dietaryTags: ['vegan'] }],
          customQuestions: [{ id: 'q-1', prompt: 'Shuttle?', type: 'text', required: true, options: [] }],
        },
      ]);

      mockPrisma.subEventRsvp.upsert.mockImplementation(({ create }: any) => Promise.resolve(create));

      await service.submitSubEventRsvps('CLEARCODE', [
        {
          subEventId: 'se-rec',
          status: 'declined',
          plusOneCount: 2,
          dietaryNotes: '',
          mealSelections: ['m-1', 'm-1'],
          customAnswers: { 'q-1': 'Yes' },
          plusOneNames: ['Pat Partner', 'Chris Friend'],
        },
      ]);

      expect(mockPrisma.subEventRsvp.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            status: 'declined',
            plusOneCount: 0,
            mealSelections: [],
            customAnswers: {},
            plusOneNames: [],
          }),
        })
      );

      expect(mockPrisma.invitationCode.update).toHaveBeenCalledWith({
        where: { id: 'inv-clear' },
        data: expect.objectContaining({
          used: true,
          plusOneFirstName: null,
          plusOneLastName: null,
          extraFields: expect.objectContaining({
            phone: '+15550001111',
            attendanceStatus: 'declined',
            plusOneCount: 0,
            plusOneNames: [],
            dietaryTags: [],
            mealSummary: '',
            customAnswersSummary: '',
          }),
        }),
      });
      const updatePayload = mockPrisma.invitationCode.update.mock.calls[0][0].data;
      expect(updatePayload).not.toHaveProperty('tableId');
      expect(updatePayload).not.toHaveProperty('seatNumber');
    });

    it('atomically syncs InvitationCode so getAttendanceStatus, dietary filters, and broadcast audience reflect RSVPs immediately', async () => {
      const submissionTime = new Date('2026-06-01T15:30:00.000Z');
      mockPrisma.invitationCode.findUnique
        .mockResolvedValueOnce({
          id: 'inv-sync',
          guestName: 'Jane Doe',
          plusOneAllocations: 1,
        })
        .mockResolvedValueOnce({
          used: false,
          usedAt: null,
          plusOneFirstName: null,
          plusOneLastName: null,
          dietaryNotes: null,
          extraFields: { phone: '+15559998888' },
        });

      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-rec',
          title: 'Evening Reception',
          isPrivate: false,
          accesses: [],
          mealOptions: [
            { id: 'm-salmon', label: 'Herb Salmon', dietaryTags: ['gluten-free', 'dairy-free'] },
            { id: 'm-gnocchi', label: 'Truffle Gnocchi', dietaryTags: ['vegan'] },
          ],
          customQuestions: [
            {
              id: 'q-shuttle',
              prompt: 'Hotel shuttle?',
              type: 'choice',
              required: true,
              options: ['Yes, round-trip', 'No'],
            },
          ],
        },
      ]);

      let syncedInviteRecord: any = null;
      mockPrisma.invitationCode.update.mockImplementation(({ data }: any) => {
        syncedInviteRecord = {
          id: 'inv-sync',
          guestName: 'Jane Doe',
          email: 'jane@example.com',
          partyTags: ['Friends'],
          ...data,
        };
        return Promise.resolve(syncedInviteRecord);
      });
      mockPrisma.subEventRsvp.upsert.mockImplementation(({ create }: any) => Promise.resolve(create));

      await service.submitSubEventRsvps(
        'JANE2026',
        [
          {
            subEventId: 'se-rec',
            status: 'attending',
            plusOneCount: 1,
            dietaryNotes: 'No shellfish',
            mealSelections: ['m-salmon', 'm-gnocchi'],
            customAnswers: { 'q-shuttle': 'Yes, round-trip' },
            plusOneNames: ['John Doe'],
          },
        ],
        submissionTime
      );

      expect(syncedInviteRecord).not.toBeNull();
      expect(syncedInviteRecord.used).toBe(true);
      expect(syncedInviteRecord.usedAt).toEqual(submissionTime);
      expect(syncedInviteRecord.plusOneFirstName).toBe('John');
      expect(syncedInviteRecord.plusOneLastName).toBe('Doe');
      expect(syncedInviteRecord.dietaryNotes).toBe('No shellfish');
      expect(syncedInviteRecord.extraFields.phone).toBe('+15559998888');
      expect(syncedInviteRecord.extraFields.mealSummary).toBe(
        'Jane Doe: Herb Salmon (gluten-free, dairy-free); John Doe: Truffle Gnocchi (vegan)'
      );
      expect(syncedInviteRecord.extraFields.customAnswersSummary).toBe(
        'Hotel shuttle?: Yes, round-trip'
      );

      expect(getAttendanceStatus(syncedInviteRecord)).toBe('attending');
      expect(matchDietaryCategory(syncedInviteRecord.dietaryNotes, 'vegan', syncedInviteRecord.extraFields)).toBe(true);
      expect(matchDietaryCategory(syncedInviteRecord.dietaryNotes, 'gluten-free', syncedInviteRecord.extraFields)).toBe(true);

      const audienceSummary = summarizeBroadcastAudience(
        [syncedInviteRecord],
        { attendanceStatus: 'attending', dietaryCategory: 'vegan' },
        'EMAIL'
      );
      expect(audienceSummary.matchedCount).toBe(1);
      expect(audienceSummary.reachableCount).toBe(1);
    });

    it('rejects pending status in submitSubEventRsvps with HTTP 400', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-pending',
        guestName: 'Pending Guest',
        plusOneAllocations: 1,
      });
      mockPrisma.subEvent.findMany.mockResolvedValue([
        { id: 'se-1', title: 'Ceremony', isPrivate: false, accesses: [] },
      ]);

      await expect(
        service.submitSubEventRsvps('PENDINGCODE', [
          { subEventId: 'se-1', status: 'pending' as any, plusOneCount: 0, dietaryNotes: '' },
        ])
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Please select Attending or Declined before saving.',
      });
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('preserves pre-seeded InvitationCode.dietaryNotes when RSVP notes stay blank, and clears when clearDietaryNotes is true', async () => {
      mockPrisma.invitationCode.findUnique
        .mockResolvedValueOnce({
          id: 'inv-preserve',
          guestName: 'Allergy Guest',
          plusOneAllocations: 0,
        })
        .mockResolvedValueOnce({
          used: false,
          usedAt: null,
          plusOneFirstName: null,
          plusOneLastName: null,
          dietaryNotes: 'Severe tree nut allergy',
          extraFields: null,
        });
      mockPrisma.subEvent.findMany.mockResolvedValue([
        { id: 'se-1', title: 'Ceremony', isPrivate: false, accesses: [] },
      ]);
      mockPrisma.subEventRsvp.findMany
        .mockResolvedValueOnce([]) // priorRsvps before upsert
        .mockResolvedValueOnce([
          {
            id: 'rsvp-1',
            subEventId: 'se-1',
            invitationCodeId: 'inv-preserve',
            status: 'attending',
            plusOneCount: 0,
            dietaryNotes: '',
            mealSelections: [],
            customAnswers: {},
            plusOneNames: [],
            subEvent: { title: 'Ceremony', startTime: new Date('2026-06-20T15:00:00Z'), mealOptions: [], customQuestions: [] },
          },
        ]);
      mockPrisma.subEventRsvp.upsert.mockResolvedValue({
        id: 'rsvp-1',
        subEventId: 'se-1',
        invitationCodeId: 'inv-preserve',
        status: 'attending',
        plusOneCount: 0,
        dietaryNotes: '',
      });

      await service.submitSubEventRsvps('PRESERVE26', [
        { subEventId: 'se-1', status: 'attending', plusOneCount: 0, dietaryNotes: '' },
      ]);

      expect(mockPrisma.invitationCode.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-preserve' },
          data: expect.objectContaining({
            dietaryNotes: 'Severe tree nut allergy',
          }),
        })
      );

      // Now intentionally clear pre-filled dietary notes via clearDietaryNotes: true
      mockPrisma.invitationCode.update.mockClear();
      mockPrisma.invitationCode.findUnique
        .mockResolvedValueOnce({
          id: 'inv-preserve',
          guestName: 'Allergy Guest',
          plusOneAllocations: 0,
        })
        .mockResolvedValueOnce({
          used: true,
          usedAt: new Date('2026-06-01T00:00:00Z'),
          plusOneFirstName: null,
          plusOneLastName: null,
          dietaryNotes: 'Severe tree nut allergy',
          extraFields: null,
        });
      mockPrisma.subEventRsvp.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'rsvp-1',
            subEventId: 'se-1',
            invitationCodeId: 'inv-preserve',
            status: 'attending',
            plusOneCount: 0,
            dietaryNotes: '',
            mealSelections: [],
            customAnswers: {},
            plusOneNames: [],
            subEvent: { title: 'Ceremony', startTime: new Date('2026-06-20T15:00:00Z'), mealOptions: [], customQuestions: [] },
          },
        ]);

      await service.submitSubEventRsvps('PRESERVE26', [
        {
          subEventId: 'se-1',
          status: 'attending',
          plusOneCount: 0,
          dietaryNotes: '',
          clearDietaryNotes: true,
        },
      ]);

      expect(mockPrisma.invitationCode.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-preserve' },
          data: expect.objectContaining({
            dietaryNotes: null,
          }),
        })
      );
    });

    it('rejects blank companion names on attending meal events while allowing named companions', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-meal-comp',
        guestName: 'Alex Host',
        plusOneAllocations: 2,
      });

      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-dinner',
          title: 'Plated Dinner',
          isPrivate: false,
          accesses: [],
          mealOptions: [
            { id: 'm-1', label: 'Short Rib', dietaryTags: [] },
            { id: 'm-2', label: 'Kids Pasta', dietaryTags: ['kids'] },
          ],
          customQuestions: [],
        },
      ]);

      await expect(
        service.submitSubEventRsvps('COMP2026', [
          {
            subEventId: 'se-dinner',
            status: 'attending',
            plusOneCount: 2,
            dietaryNotes: '',
            mealSelections: ['m-1', 'm-1', 'm-2'],
            plusOneNames: ['Sam Partner', '   '],
          },
        ])
      ).rejects.toThrow(ApiError);
    });

    it('excludes isSample and declined rows while tallying per-plate kids meals in getRsvpSummary and populates eventRsvps in getAccessMatrix', async () => {
      mockPrisma.invitationCode.findMany.mockResolvedValue([
        {
          id: 'inv-real',
          guestName: 'Parent Guest',
          used: true,
          isSample: false,
          plusOneAllocations: 2,
          plusOneFirstName: 'Child',
          plusOneLastName: 'One',
          dietaryNotes: '',
          partyTags: [],
          extraFields: { attendanceStatus: 'attending' },
        },
        {
          id: 'inv-declined',
          guestName: 'Declined Guest',
          used: true,
          isSample: false,
          plusOneAllocations: 1,
          plusOneFirstName: null,
          plusOneLastName: null,
          dietaryNotes: 'Kids meal, Vegan',
          partyTags: ['kids'],
          extraFields: { attendanceStatus: 'declined' },
        },
        {
          id: 'inv-sample',
          guestName: 'Sample Household',
          used: true,
          isSample: true,
          plusOneAllocations: 2,
          plusOneFirstName: 'Sample',
          plusOneLastName: 'Kid',
          dietaryNotes: 'Kids meal',
          partyTags: ['kids'],
          extraFields: { attendanceStatus: 'attending' },
        },
      ]);

      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-rec',
          title: 'Reception',
          isPrivate: false,
          startTime: null,
          mealOptions: [
            { id: 'm-adult', label: 'Filet', dietaryTags: [] },
            { id: 'm-kids', label: 'Kids Chicken Tenders', dietaryTags: ['kids'] },
          ],
          customQuestions: [
            { id: 'q-chair', prompt: 'High chair?', type: 'choice', required: false, options: ['Yes', 'No'] },
          ],
          accesses: [],
          rsvps: [
            {
              invitationCodeId: 'inv-real',
              status: 'attending',
              plusOneCount: 2,
              dietaryNotes: '',
              mealSelections: ['m-adult', 'm-kids', 'm-kids'],
              customAnswers: { 'q-chair': 'Yes' },
              plusOneNames: ['Child One', 'Child Two'],
            },
            {
              invitationCodeId: 'inv-declined',
              status: 'declined',
              plusOneCount: 0,
              dietaryNotes: 'Kids meal',
              mealSelections: ['m-kids'],
              customAnswers: {},
              plusOneNames: [],
            },
            {
              invitationCodeId: 'inv-sample',
              status: 'attending',
              plusOneCount: 2,
              dietaryNotes: 'Kids meal',
              mealSelections: ['m-kids', 'm-kids', 'm-kids'],
              customAnswers: {},
              plusOneNames: ['Sample Kid 1', 'Sample Kid 2'],
            },
          ],
        },
      ]);

      const summary = await service.getRsvpSummary();
      expect(summary.global.totalInvitations).toBe(2);
      expect(summary.global.attendingHouseholds).toBe(1);
      expect(summary.global.attendingHeadcount).toBe(3);
      expect(summary.global.dietary.kids).toBe(2);
      expect(summary.subEvents[0].kidsCount).toBe(2);

      // Verify getAccessMatrix includes eventRsvps per guest
      mockPrisma.invitationCode.count.mockResolvedValue(1);
      mockPrisma.invitationCode.findMany
        .mockResolvedValueOnce([
          {
            id: 'inv-real',
            code: 'REAL01',
            guestName: 'Parent Guest',
            householdName: 'Parent Family',
            partyGroup: 'Family',
            partyTags: [],
            dietaryNotes: 'No peanuts',
            plusOneFirstName: 'Child',
            plusOneLastName: 'One',
            extraFields: {},
            subEventAccesses: [],
            subEventRsvps: [
              {
                subEventId: 'se-rec',
                status: 'attending',
                plusOneCount: 2,
                dietaryNotes: 'No peanuts',
                mealSelections: ['m-adult', 'm-kids', 'm-kids'],
                customAnswers: { 'q-chair': 'Yes' },
                plusOneNames: ['Child One', 'Child Two'],
              },
            ],
          },
        ])
        .mockResolvedValue([]);

      const matrix = await service.getAccessMatrix({ page: 1, limit: 25 });
      expect(matrix.invitationCodes[0].eventRsvps?.['se-rec']).toEqual({
        status: 'attending',
        plusOneCount: 2,
        plusOneNames: ['Child One', 'Child Two'],
        dietaryNotes: 'No peanuts',
        meals: [
          { attendee: 'Parent Guest', optionId: 'm-adult', label: 'Filet', dietaryTags: [] },
          { attendee: 'Child One', optionId: 'm-kids', label: 'Kids Chicken Tenders', dietaryTags: ['kids'] },
          { attendee: 'Child Two', optionId: 'm-kids', label: 'Kids Chicken Tenders', dietaryTags: ['kids'] },
        ],
        answers: [{ questionId: 'q-chair', prompt: 'High chair?', answer: 'Yes' }],
      });
    });

    it('projects eventRsvps via $queryRaw rsvpsByInvitationCodeId without relation selects', async () => {
      const rawClient: any = {
        invitationCode: {
          count: jest.fn().mockResolvedValue(1),
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'inv-real',
              code: 'REAL01',
              guestName: 'Parent Guest',
              householdName: 'Parent Family',
              partyGroup: 'Family',
              partyTags: [],
              used: true,
              dietaryNotes: 'No peanuts',
              plusOneFirstName: 'Child',
              plusOneLastName: 'One',
              extraFields: {},
            },
          ]),
        },
        subEvent: {
          findMany: jest.fn(),
        },
        $queryRaw: jest.fn().mockResolvedValue([
          {
            subEvents: [
              {
                id: 'se-rec',
                title: 'Reception',
                description: '',
                startTime: null,
                endTime: null,
                locationName: '',
                location: '',
                category: 'Reception',
                isPrivate: false,
                mealOptions: [
                  { id: 'm-adult', label: 'Filet', dietaryTags: [] },
                  { id: 'm-kids', label: 'Kids Chicken Tenders', dietaryTags: ['kids'] },
                ],
                customQuestions: [{ id: 'q-chair', prompt: 'High chair?', type: 'text' }],
                allowedInvitationCodeIds: [],
              },
            ],
            partyGroups: ['Family'],
            householdNames: ['Parent Family'],
            partyTags: [],
            rsvpsByInvitationCodeId: {
              'inv-real': [
                {
                  subEventId: 'se-rec',
                  status: 'attending',
                  plusOneCount: 2,
                  dietaryNotes: 'No peanuts',
                  mealSelections: ['m-adult', 'm-kids', 'm-kids'],
                  customAnswers: { 'q-chair': 'Yes' },
                  plusOneNames: ['Child One', 'Child Two'],
                },
              ],
            },
          },
        ]),
      };

      const rawService = new SubEventService(rawClient);
      const rawMatrix = await rawService.getAccessMatrix({ page: 1, limit: 25 });

      const scalarSelect = rawClient.invitationCode.findMany.mock.calls[0][0].select;
      expect(scalarSelect).not.toHaveProperty('subEventAccesses');
      expect(scalarSelect).not.toHaveProperty('subEventRsvps');
      expect(rawMatrix.invitationCodes[0].eventRsvps?.['se-rec']).toEqual({
        status: 'attending',
        plusOneCount: 2,
        plusOneNames: ['Child One', 'Child Two'],
        dietaryNotes: 'No peanuts',
        meals: [
          { attendee: 'Parent Guest', optionId: 'm-adult', label: 'Filet', dietaryTags: [] },
          { attendee: 'Child One', optionId: 'm-kids', label: 'Kids Chicken Tenders', dietaryTags: ['kids'] },
          { attendee: 'Child Two', optionId: 'm-kids', label: 'Kids Chicken Tenders', dietaryTags: ['kids'] },
        ],
        answers: [{ questionId: 'q-chair', prompt: 'High chair?', answer: 'Yes' }],
      });
    });

    it('excludes unpromoted address-collection records from global and per-sub-event getRsvpSummary tallies', async () => {
      mockPrisma.invitationCode.findMany.mockResolvedValue([
        {
          id: 'inv-invited',
          guestName: 'Invited Household',
          used: true,
          isSample: false,
          plusOneAllocations: 1,
          plusOneFirstName: 'Alex',
          plusOneLastName: 'Invited',
          dietaryNotes: 'Gluten-free',
          partyTags: ['Family'],
          extraFields: { attendanceStatus: 'attending' },
        },
        {
          id: 'inv-address-only',
          guestName: 'Address Collector',
          used: false,
          isSample: false,
          plusOneAllocations: 0,
          plusOneFirstName: null,
          plusOneLastName: null,
          dietaryNotes: null,
          partyTags: ['address-collection'],
          extraFields: { householdNotes: 'Vegan household note in mailing form' },
        },
      ]);

      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-main',
          title: 'Ceremony & Dinner',
          isPrivate: false,
          startTime: null,
          mealOptions: [{ id: 'm-1', label: 'Herb Chicken', dietaryTags: ['gluten-free'] }],
          customQuestions: [],
          accesses: [],
          rsvps: [
            {
              invitationCodeId: 'inv-invited',
              status: 'attending',
              plusOneCount: 1,
              dietaryNotes: 'Gluten-free',
              mealSelections: ['m-1', 'm-1'],
              customAnswers: {},
              plusOneNames: ['Alex Invited'],
            },
            {
              invitationCodeId: 'inv-address-only',
              status: 'attending',
              plusOneCount: 0,
              dietaryNotes: 'Vegan',
              mealSelections: ['m-1'],
              customAnswers: {},
              plusOneNames: [],
            },
          ],
        },
      ]);

      const summary = await service.getRsvpSummary();
      expect(summary.global.totalInvitations).toBe(1);
      expect(summary.global.attendingHouseholds).toBe(1);
      expect(summary.global.pendingHouseholds).toBe(0);
      expect(summary.global.attendingHeadcount).toBe(2);
      expect(summary.global.dietary.vegan).toBe(0);
      expect(summary.subEvents[0].invitedCount).toBe(1);
      expect(summary.subEvents[0].attendingCount).toBe(1);
      expect(summary.subEvents[0].attendingHeadcount).toBe(2);
      expect(summary.subEvents[0].pendingCount).toBe(0);
    });

    it('isolates unpromoted address-collection records from schedule dietary pre-population, private events, and submitSubEventRsvps', async () => {
      mockPrisma.invitationCode.findUnique.mockResolvedValue({
        id: 'inv-address-only',
        guestName: 'Address Collector',
        plusOneAllocations: 1,
        dietaryNotes: 'No shellfish',
        partyTags: ['address-collection'],
        isSample: false,
      });
      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-public',
          title: 'Ceremony',
          isPrivate: false,
          startTime: new Date('2027-06-01T18:00:00Z'),
          endTime: new Date('2027-06-01T19:00:00Z'),
          mealOptions: [],
          customQuestions: [],
          accesses: [],
          rsvps: [],
        },
      ]);

      const schedule = await service.getScheduleForGuest('ADDRONLY1');
      expect(schedule).toHaveLength(1);
      expect(schedule[0].userRsvp).toBeNull();

      await expect(
        service.submitSubEventRsvps('ADDRONLY1', [
          { subEventId: 'se-public', status: 'attending', plusOneCount: 0, dietaryNotes: '' },
        ])
      ).rejects.toMatchObject({
        statusCode: 401,
        message: 'Invalid invitation session.',
      });
    });

    it('falls back cleanly to createMany, subEventRsvp.upsert, and invitationCode.update in adminBatchUpdateAttendance when $executeRaw is absent', async () => {
      mockPrisma.invitationCode.findMany.mockResolvedValue([
        {
          id: 'inv-1',
          code: 'G001',
          guestName: 'Guest One',
          used: false,
          usedAt: null,
          plusOneAllocations: 0,
          dietaryNotes: 'No nuts',
          extraFields: { seatNote: 'Front row' },
        },
        {
          id: 'inv-2',
          code: 'G002',
          guestName: 'Guest Two',
          used: false,
          usedAt: null,
          plusOneAllocations: 1,
          dietaryNotes: null,
          extraFields: {},
        },
      ]);
      mockPrisma.subEvent.findMany.mockResolvedValue([
        {
          id: 'se-priv',
          title: 'Private Dinner',
          isPrivate: true,
          accesses: [{ invitationCodeId: 'inv-1' }],
          mealOptions: [],
          customQuestions: [],
        },
      ]);
      mockPrisma.subEventAccess.createMany.mockResolvedValue({ count: 1 });
      mockPrisma.subEventRsvp.upsert.mockResolvedValue({});
      mockPrisma.subEventRsvp.findMany.mockResolvedValue([
        {
          id: 'r-1',
          subEventId: 'se-priv',
          invitationCodeId: 'inv-1',
          status: 'attending',
          plusOneCount: 0,
          plusOneNames: [],
          mealSelections: [],
          customAnswers: {},
          dietaryNotes: '',
        },
        {
          id: 'r-2',
          subEventId: 'se-priv',
          invitationCodeId: 'inv-2',
          status: 'attending',
          plusOneCount: 0,
          plusOneNames: [],
          mealSelections: [],
          customAnswers: {},
          dietaryNotes: '',
        },
      ]);
      mockPrisma.invitationCode.update.mockImplementation(({ where, data }: any) =>
        Promise.resolve({ id: where.id, ...data })
      );

      const result = await service.adminBatchUpdateAttendance({
        invitationCodeIds: ['inv-1', 'inv-2'],
        status: 'attending',
        subEventIds: ['se-priv'],
      });

      expect(mockPrisma.subEventAccess.createMany).toHaveBeenCalledWith({
        data: [{ subEventId: 'se-priv', invitationCodeId: 'inv-2' }],
        skipDuplicates: true,
      });
      expect(mockPrisma.subEventRsvp.upsert).toHaveBeenCalledTimes(2);
      expect(mockPrisma.invitationCode.update).toHaveBeenCalledTimes(2);
      expect(result.updatedCount).toBe(2);
    });
  });
});
