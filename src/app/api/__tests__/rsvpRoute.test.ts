import { POST } from '../rsvp/route';
import { NextRequest } from 'next/server';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { subEventService } from '@/features/sub-events/service';

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
});
