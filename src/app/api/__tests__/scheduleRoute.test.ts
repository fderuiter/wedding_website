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

  beforeEach(() => {
    jest.clearAllMocks();
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
    expect(json.plusOneAllocations).toBeNull();
    expect(mockGetScheduleForGuest).toHaveBeenCalledWith(undefined);
    expect(mockGetPlusOneAllowance).not.toHaveBeenCalled();
  });

  it('returns public plus private sub-events and plusOneAllocations for authenticated guests', async () => {
    mockGetGuestInviteSession.mockResolvedValue({
      code: 'GUESTCODE1',
      guestName: 'Jane Smith',
    });
    mockGetScheduleForGuest.mockResolvedValue([
      { id: '1', title: 'Main Ceremony', isPrivate: false, isReadOnly: false, userRsvp: null },
      {
        id: '2',
        title: 'Rehearsal Dinner',
        isPrivate: true,
        isReadOnly: false,
        userRsvp: { status: 'attending', plusOneCount: 1, dietaryNotes: '' },
      },
    ]);
    mockGetPlusOneAllowance.mockResolvedValue(2);

    const req = new NextRequest('http://localhost:3000/api/schedule');
    const res = await GET(req, {});
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(2);
    expect(json.isGuest).toBe(true);
    expect(json.guestName).toBe('Jane Smith');
    expect(json.plusOneAllocations).toBe(2);
    expect(mockGetScheduleForGuest).toHaveBeenCalledWith('GUESTCODE1');
    expect(mockGetPlusOneAllowance).toHaveBeenCalledWith('GUESTCODE1');
  });
});
