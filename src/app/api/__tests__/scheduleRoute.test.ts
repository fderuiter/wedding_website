import { GET } from '../schedule/route';
import { NextRequest } from 'next/server';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { subEventService } from '@/features/sub-events';

jest.mock('@/core/auth/guestInviteSession');
jest.mock('@/features/sub-events/service');

describe('GET /api/schedule Route', () => {
  const mockGetGuestInviteSession = getGuestInviteSession as jest.MockedFunction<typeof getGuestInviteSession>;
  const mockGetScheduleForGuest = subEventService.getScheduleForGuest as jest.MockedFunction<typeof subEventService.getScheduleForGuest>;
  const mockGetPlusOneAllowance = subEventService.getPlusOneAllowanceForGuest as jest.MockedFunction<
    typeof subEventService.getPlusOneAllowanceForGuest
  >;
  const mockGetSavedPlusOneNames = subEventService.getSavedPlusOneNamesForGuest as jest.MockedFunction<
    typeof subEventService.getSavedPlusOneNamesForGuest
  >;
  const mockGetSavedEmail = subEventService.getSavedEmailForGuest as jest.MockedFunction<
    typeof subEventService.getSavedEmailForGuest
  >;
  const mockGetRsvpStatus = subEventService.getRsvpStatus as jest.MockedFunction<
    typeof subEventService.getRsvpStatus
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSavedPlusOneNames.mockResolvedValue([]);
    mockGetSavedEmail.mockResolvedValue(null);
  });

  it('returns public sub-events and null plusOneAllocations for unauthenticated visitors', async () => {
    mockGetGuestInviteSession.mockResolvedValue(null);
    mockGetScheduleForGuest.mockResolvedValue([
      { id: '1', title: 'Main Ceremony', isPrivate: false, isReadOnly: false, userRsvp: null },
    ]);

    const req = new NextRequest('http://localhost:3000/api/schedule');
    const res = await GET(req, {});
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].title).toBe('Main Ceremony');
    expect(json.isGuest).toBe(false);
    expect(json.guestEmail).toBeNull();
    expect(json.plusOneAllocations).toBeNull();
    expect(json.savedPlusOneNames).toEqual([]);
    expect(mockGetScheduleForGuest).toHaveBeenCalledWith(undefined);
    expect(mockGetPlusOneAllowance).not.toHaveBeenCalled();
    expect(mockGetSavedPlusOneNames).not.toHaveBeenCalled();
    expect(mockGetSavedEmail).not.toHaveBeenCalled();
  });

  it('returns public plus private sub-events and plusOneAllocations for authenticated guests', async () => {
    mockGetGuestInviteSession.mockResolvedValue({
      code: 'GUESTCODE1',
      guestName: 'Jane Smith',
    });
    mockGetScheduleForGuest.mockResolvedValue([
      {
        id: '1',
        title: 'Main Ceremony',
        isPrivate: false,
        isReadOnly: false,
        mealOptions: [{ id: 'm1', label: 'Salmon', dietaryTags: ['gluten-free'] }],
        customQuestions: [{ id: 'q1', prompt: 'Shuttle?', type: 'text', required: false, options: [] }],
        userRsvp: null,
      },
      {
        id: '2',
        title: 'Rehearsal Dinner',
        isPrivate: true,
        isReadOnly: false,
        userRsvp: { status: 'attending', plusOneCount: 1, dietaryNotes: '' },
      },
    ]);
    mockGetPlusOneAllowance.mockResolvedValue(2);
    mockGetSavedPlusOneNames.mockResolvedValue(['John Smith']);
    mockGetSavedEmail.mockResolvedValue('jane.smith@example.com');

    const req = new NextRequest('http://localhost:3000/api/schedule');
    const res = await GET(req, {});
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(2);
    expect(json.data[0].mealOptions).toHaveLength(1);
    expect(json.data[0].customQuestions).toHaveLength(1);
    expect(json.isGuest).toBe(true);
    expect(json.guestName).toBe('Jane Smith');
    expect(json.guestEmail).toBe('jane.smith@example.com');
    expect(json.plusOneAllocations).toBe(2);
    expect(json.savedPlusOneNames).toEqual(['John Smith']);
    expect(mockGetScheduleForGuest).toHaveBeenCalledWith('GUESTCODE1');
    expect(mockGetPlusOneAllowance).toHaveBeenCalledWith('GUESTCODE1');
    expect(mockGetSavedPlusOneNames).toHaveBeenCalledWith('GUESTCODE1');
    expect(mockGetSavedEmail).toHaveBeenCalledWith('GUESTCODE1');
  });

  it('returns RSVP open status, formatted deadline date, venue timezone, and closing message without exposing grace-period hours', async () => {
    mockGetGuestInviteSession.mockResolvedValue({
      code: 'GUESTCODE1',
      guestName: 'Jane Smith',
    });
    mockGetScheduleForGuest.mockResolvedValue([
      { id: '1', title: 'Main Ceremony', isPrivate: false, isReadOnly: false, userRsvp: null },
    ]);
    mockGetPlusOneAllowance.mockResolvedValue(1);
    mockGetRsvpStatus.mockResolvedValue({
      isOpen: true,
      isManuallyLocked: false,
      isPastDeadline: true,
      isInGraceWindow: true,
      deadlineDate: '2026-08-15',
      formattedDeadline: 'August 15, 2026',
      timezone: 'America/Chicago',
      closedMessage: 'Online RSVPs are closed — email hosts@example.com.',
    });

    const req = new NextRequest('http://localhost:3000/api/schedule');
    const res = await GET(req, {});
    const json = await res.json();

    expect(json.rsvpOpen).toBe(true);
    expect(json.rsvpDeadlineDate).toBe('2026-08-15');
    expect(json.rsvpFormattedDeadline).toBe('August 15, 2026');
    expect(json.timezone).toBe('America/Chicago');
    expect(json.rsvpClosedMessage).toBe('Online RSVPs are closed — email hosts@example.com.');
    expect(json.rsvpGracePeriodHours).toBeUndefined();
    expect(json.isInGraceWindow).toBeUndefined();
  });
});
