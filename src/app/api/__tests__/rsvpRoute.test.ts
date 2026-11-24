import { POST } from '../rsvp/route';
import { NextRequest } from 'next/server';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { subEventService } from '@/features/sub-events';

jest.mock('@/core/auth/guestInviteSession');
jest.mock('@/features/sub-events/service');

describe('POST /api/rsvp Route', () => {
  const mockGetGuestInviteSession = getGuestInviteSession as jest.MockedFunction<typeof getGuestInviteSession>;
  const mockSubmitSubEventRsvps = subEventService.submitSubEventRsvps as jest.MockedFunction<typeof subEventService.submitSubEventRsvps>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 Unauthorized if guest session cookie is missing', async () => {
    mockGetGuestInviteSession.mockResolvedValue(null);

    const req = new NextRequest('http://localhost:3000/api/rsvp', {
      method: 'POST',
      body: JSON.stringify({ subEventId: 'se-1', status: 'attending' }),
    });

    const res = await POST(req, {});
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/Unauthorized/i);
  });

  it('returns 400 Bad Request for invalid RSVP payload format', async () => {
    mockGetGuestInviteSession.mockResolvedValue({
      code: 'VALIDCODE',
      guestName: 'Jane Smith',
    });

    const req = new NextRequest('http://localhost:3000/api/rsvp', {
      method: 'POST',
      body: JSON.stringify({ invalidField: 123 }),
    });

    const res = await POST(req, {});
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it('successfully records sub-event RSVP for authenticated guest', async () => {
    mockGetGuestInviteSession.mockResolvedValue({
      code: 'VALIDCODE',
      guestName: 'Jane Smith',
    });

    mockSubmitSubEventRsvps.mockResolvedValue([
      {
        id: 'rsvp-1',
        subEventId: 'se-1',
        invitationCodeId: 'inv-123',
        status: 'attending',
        plusOneCount: 1,
        dietaryNotes: 'Gluten-free',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const req = new NextRequest('http://localhost:3000/api/rsvp', {
      method: 'POST',
      body: JSON.stringify({
        subEventId: 'se-1',
        status: 'attending',
        plusOneCount: 1,
        dietaryNotes: 'Gluten-free',
      }),
    });

    const res = await POST(req, {});
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].status).toBe('attending');
    expect(mockSubmitSubEventRsvps).toHaveBeenCalledWith('VALIDCODE', [
      {
        subEventId: 'se-1',
        status: 'attending',
        plusOneCount: 1,
        dietaryNotes: 'Gluten-free',
      },
    ]);
  });

  it('returns 400 when plusOneCount exceeds guest allocation or targets read-only fallback', async () => {
    const { ApiError } = await import('@/utils/ApiError');
    mockGetGuestInviteSession.mockResolvedValue({
      code: 'VALIDCODE',
      guestName: 'Jane Smith',
    });
    mockSubmitSubEventRsvps.mockRejectedValue(
      new ApiError(400, 'Plus-one count (3) exceeds your allocated limit of 1.')
    );

    const req = new NextRequest('http://localhost:3000/api/rsvp', {
      method: 'POST',
      body: JSON.stringify({
        subEventId: 'se-1',
        status: 'attending',
        plusOneCount: 3,
      }),
    });

    const res = await POST(req, {});
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Plus-one count (3) exceeds your allocated limit of 1.');
  });

  it('returns 400 when single or batch plusOneCount exceeds schema maximum of 20', async () => {
    mockGetGuestInviteSession.mockResolvedValue({
      code: 'SOLO-GUEST',
      guestName: 'Solo Guest',
    });

    const singleReq = new NextRequest('http://localhost:3000/api/rsvp', {
      method: 'POST',
      body: JSON.stringify({
        subEventId: 'sub-ceremony-1',
        status: 'attending',
        plusOneCount: 25,
        dietaryNotes: 'None',
      }),
    });

    const singleRes = await POST(singleReq, {});
    const singleJson = await singleRes.json();

    expect(singleRes.status).toBe(400);
    expect(singleJson.success).toBe(false);
    expect(singleJson.error).toContain('Plus-one count cannot exceed 20.');

    const batchReq = new NextRequest('http://localhost:3000/api/rsvp', {
      method: 'POST',
      body: JSON.stringify({
        rsvps: [
          { subEventId: 'sub-ceremony-1', status: 'attending', plusOneCount: 0 },
          { subEventId: 'sub-reception-1', status: 'attending', plusOneCount: 21 },
        ],
      }),
    });

    const batchRes = await POST(batchReq, {});
    const batchJson = await batchRes.json();

    expect(batchRes.status).toBe(400);
    expect(batchJson.success).toBe(false);
    expect(batchJson.error).toContain('Plus-one count cannot exceed 20.');
    expect(mockSubmitSubEventRsvps).not.toHaveBeenCalled();
  });

  it('returns 403 with closing message when RSVPs are manually closed or past grace window', async () => {
    const mockGetRsvpStatus = subEventService.getRsvpStatus as jest.MockedFunction<
      typeof subEventService.getRsvpStatus
    >;
    mockGetGuestInviteSession.mockResolvedValue({
      code: 'VALIDCODE',
      guestName: 'Jane Smith',
    });
    mockGetRsvpStatus.mockResolvedValue({
      isOpen: false,
      isManuallyLocked: true,
      isPastDeadline: false,
      isInGraceWindow: false,
      deadlineDate: '2026-08-15',
      formattedDeadline: 'August 15, 2026',
      timezone: 'America/Chicago',
      closedMessage: 'Online RSVPs are locked. Please email hosts@example.com.',
    });

    const req = new NextRequest('http://localhost:3000/api/rsvp', {
      method: 'POST',
      body: JSON.stringify({
        subEventId: 'se-1',
        status: 'attending',
        plusOneCount: 0,
        dietaryNotes: 'No dairy',
      }),
    });

    const res = await POST(req, {});
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Online RSVPs are locked. Please email hosts@example.com.');
    expect(mockSubmitSubEventRsvps).not.toHaveBeenCalled();
  });

  it('returns 400 when single or batch RSVP attempts to submit pending status', async () => {
    const mockGetRsvpStatus = subEventService.getRsvpStatus as jest.MockedFunction<
      typeof subEventService.getRsvpStatus
    >;
    mockGetGuestInviteSession.mockResolvedValue({
      code: 'VALIDCODE',
      guestName: 'Jane Smith',
    });
    mockGetRsvpStatus.mockResolvedValue({
      isOpen: true,
      isManuallyLocked: false,
      isPastDeadline: false,
      isInGraceWindow: false,
      deadlineDate: '2026-08-15',
      formattedDeadline: 'August 15, 2026',
      timezone: 'America/Chicago',
      closedMessage: 'Closed',
    });

    const singleRes = await POST(
      new NextRequest('http://localhost:3000/api/rsvp', {
        method: 'POST',
        body: JSON.stringify({
          subEventId: 'se-1',
          status: 'pending',
          plusOneCount: 0,
        }),
      }),
      {}
    );
    const singleJson = await singleRes.json();
    expect(singleRes.status).toBe(400);
    expect(singleJson.success).toBe(false);
    expect(singleJson.error).toContain('Please select Attending or Declined before saving.');

    const batchRes = await POST(
      new NextRequest('http://localhost:3000/api/rsvp', {
        method: 'POST',
        body: JSON.stringify({
          rsvps: [
            { subEventId: 'se-1', status: 'attending', plusOneCount: 0 },
            { subEventId: 'se-2', status: 'pending', plusOneCount: 0 },
          ],
        }),
      }),
      {}
    );
    const batchJson = await batchRes.json();
    expect(batchRes.status).toBe(400);
    expect(batchJson.success).toBe(false);
    expect(batchJson.error).toContain('Please select Attending or Declined before saving.');
    expect(mockSubmitSubEventRsvps).not.toHaveBeenCalled();
  });
});
