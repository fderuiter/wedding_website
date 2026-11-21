import { POST } from '../rsvp/route';
import { NextRequest } from 'next/server';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { subEventService } from '@/features/sub-events';
import { getAppConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { MultiChannelMessagingProvider } from '@/features/broadcast';

jest.mock('@/core/auth/guestInviteSession', () => {
  const actual = jest.requireActual('@/core/auth/guestInviteSession');
  return {
    ...actual,
    getGuestInviteSession: jest.fn(),
  };
});
jest.mock('@/features/sub-events/service');
jest.mock('@/lib/config');
jest.mock('@/lib/prisma', () => ({
  prisma: {
    invitationCode: {
      findUnique: jest.fn(),
    },
  },
}));

describe('POST /api/rsvp Route', () => {
  const mockGetGuestInviteSession = getGuestInviteSession as jest.MockedFunction<typeof getGuestInviteSession>;
  const mockSubmitSubEventRsvps = subEventService.submitSubEventRsvps as jest.MockedFunction<typeof subEventService.submitSubEventRsvps>;
  const mockGetScheduleForGuest = subEventService.getScheduleForGuest as jest.MockedFunction<typeof subEventService.getScheduleForGuest>;
  const mockDidSubmissionChangeRsvps = subEventService.didSubmissionChangeRsvps as jest.MockedFunction<typeof subEventService.didSubmissionChangeRsvps>;
  const mockGetAppConfig = getAppConfig as jest.MockedFunction<typeof getAppConfig>;
  const mockInviteFindUnique = (prisma as any).invitationCode.findUnique as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAppConfig.mockResolvedValue({
      emailProvider: 'none',
      contactEmail: '',
      timezone: 'America/Chicago',
      baseUrl: 'https://wedding.example.com',
    } as any);
    mockInviteFindUnique.mockResolvedValue(null);
    mockDidSubmissionChangeRsvps.mockReturnValue(true);
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

  describe('Guest email validation, persistence, and inline notification dispatch', () => {
    beforeEach(() => {
      (subEventService.getRsvpStatus as jest.Mock).mockResolvedValue(undefined);
    });

    it('rejects malformed email addresses on single and batch RSVP submissions with HTTP 400', async () => {
      mockGetGuestInviteSession.mockResolvedValue({
        code: 'VALIDCODE',
        guestName: 'Jane Smith',
      });

      const badSingleReq = new NextRequest('http://localhost:3000/api/rsvp', {
        method: 'POST',
        body: JSON.stringify({
          subEventId: 'se-1',
          status: 'attending',
          email: 'not-a-valid-email',
        }),
      });
      const badSingleRes = await POST(badSingleReq, {});
      const badSingleJson = await badSingleRes.json();

      expect(badSingleRes.status).toBe(400);
      expect(badSingleJson.success).toBe(false);
      expect(badSingleJson.error).toContain('Please provide a valid email address.');

      const badBatchReq = new NextRequest('http://localhost:3000/api/rsvp', {
        method: 'POST',
        body: JSON.stringify({
          email: 'missing-domain@',
          rsvps: [{ subEventId: 'se-1', status: 'attending', plusOneCount: 0 }],
        }),
      });
      const badBatchRes = await POST(badBatchReq, {});
      const badBatchJson = await badBatchRes.json();

      expect(badBatchRes.status).toBe(400);
      expect(badBatchJson.success).toBe(false);
      expect(badBatchJson.error).toContain('Please provide a valid email address.');
      expect(mockSubmitSubEventRsvps).not.toHaveBeenCalled();
    });

    it('persists valid guest email and dispatches HTML guest confirmation (with /guest?code= and signed .ics link) plus couple alert', async () => {
      const sendEmailSpy = jest
        .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
        .mockResolvedValue({ success: true });

      mockGetGuestInviteSession.mockResolvedValue({
        code: 'HOUSEHOLD99',
        guestName: 'Jane <script> Smith',
      });
      mockGetAppConfig.mockResolvedValue({
        emailProvider: 'smtp',
        smtpHost: 'smtp.example.com',
        contactEmail: 'couple@wedding.example.com',
        partner1Name: 'Alex',
        partner2Name: 'Jordan',
        baseUrl: 'https://wedding.example.com',
        timezone: 'America/Chicago',
      } as any);
      mockInviteFindUnique.mockResolvedValue({
        guestName: 'Jane <script> Smith',
        householdName: 'Smith Family',
        email: 'jane@example.com',
      });
      mockSubmitSubEventRsvps.mockResolvedValue([
        {
          id: 'rsvp-1',
          subEventId: 'se-ceremony',
          invitationCodeId: 'inv-99',
          status: 'attending',
          plusOneCount: 1,
          dietaryNotes: 'No <peanuts>',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any);
      mockGetScheduleForGuest.mockResolvedValue([
        {
          id: 'se-ceremony',
          title: 'Wedding Ceremony',
          startTime: '2026-06-20T20:30:00.000Z',
          endTime: '2026-06-20T21:30:00.000Z',
          locationName: 'Grand Oak Lawn',
          isPrivate: false,
          isReadOnly: false,
          userRsvp: {
            status: 'attending',
            plusOneCount: 1,
            dietaryNotes: 'No <peanuts>',
            plusOneNames: ['John Smith'],
          },
        },
        {
          id: 'se-brunch',
          title: 'Farewell Brunch',
          startTime: '2026-06-21T15:00:00.000Z',
          endTime: '2026-06-21T17:00:00.000Z',
          locationName: 'Garden Pavilion',
          isPrivate: false,
          isReadOnly: false,
          userRsvp: {
            status: 'declined',
            plusOneCount: 0,
            dietaryNotes: '',
          },
        },
        {
          id: 'se-welcome',
          title: 'Welcome Drinks',
          startTime: '2026-06-19T23:00:00.000Z',
          endTime: '2026-06-20T01:00:00.000Z',
          locationName: 'Rooftop Terrace',
          isPrivate: true,
          isReadOnly: false,
          userRsvp: null,
        },
      ]);

      const req = new NextRequest('http://localhost:3000/api/rsvp', {
        method: 'POST',
        body: JSON.stringify({
          email: '  jane@example.com  ',
          rsvps: [
            {
              subEventId: 'se-ceremony',
              status: 'attending',
              plusOneCount: 1,
              dietaryNotes: 'No <peanuts>',
            },
          ],
        }),
      });

      const res = await POST(req, {});
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(mockSubmitSubEventRsvps).toHaveBeenCalledWith(
        'HOUSEHOLD99',
        [
          {
            subEventId: 'se-ceremony',
            status: 'attending',
            plusOneCount: 1,
            dietaryNotes: 'No <peanuts>',
          },
        ],
        undefined,
        { email: 'jane@example.com' }
      );

      expect(sendEmailSpy).toHaveBeenCalledTimes(2);

      const guestCall = sendEmailSpy.mock.calls.find(([arg]) => arg.to === 'jane@example.com')![0];
      expect(guestCall.subject).toBe('Your RSVP Confirmation — Alex & Jordan');
      expect(guestCall.body).toContain('Accepted Events (1)');
      expect(guestCall.body).toContain('Declined Events (1)');
      expect(guestCall.body).toContain('Pending Events (1)');
      expect(guestCall.body).toContain('Wedding Ceremony');
      expect(guestCall.body).toContain('Grand Oak Lawn');
      expect(guestCall.body).toContain('Farewell Brunch');
      expect(guestCall.body).toContain('Welcome Drinks');
      expect(guestCall.body).toContain('No &lt;peanuts&gt;');
      expect(guestCall.body).not.toContain('<script>');
      expect(guestCall.body).toContain('https://wedding.example.com/guest?code=HOUSEHOLD99');
      expect(guestCall.body).toContain('https://wedding.example.com/api/schedule/ics?token=');

      const coupleCall = sendEmailSpy.mock.calls.find(
        ([arg]) => arg.to === 'couple@wedding.example.com'
      )![0];
      expect(coupleCall.subject).toContain('RSVP Update:');
      expect(coupleCall.body).toContain('Smith Family');
      expect(coupleCall.body).toContain('Wedding Ceremony');
      expect(coupleCall.body).toContain('Attending');
      expect(coupleCall.body).toContain('No &lt;peanuts&gt;');
      expect(coupleCall.body).toContain('https://wedding.example.com/admin/dashboard/invitation-codes');

      sendEmailSpy.mockRestore();
    });

    it('skips guest confirmation email when guest provides no email while still sending couple alert', async () => {
      const sendEmailSpy = jest
        .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
        .mockResolvedValue({ success: true });

      mockGetGuestInviteSession.mockResolvedValue({
        code: 'NOEMAILCODE',
        guestName: 'Taylor Guest',
      });
      mockGetAppConfig.mockResolvedValue({
        emailProvider: 'smtp',
        smtpHost: 'smtp.example.com',
        contactEmail: 'couple@wedding.example.com',
        baseUrl: 'https://wedding.example.com',
        timezone: 'UTC',
      } as any);
      mockInviteFindUnique.mockResolvedValue({
        guestName: 'Taylor Guest',
        householdName: null,
        email: null,
      });
      mockSubmitSubEventRsvps.mockResolvedValue([
        {
          id: 'rsvp-2',
          subEventId: 'se-1',
          invitationCodeId: 'inv-2',
          status: 'declined',
          plusOneCount: 0,
          dietaryNotes: '',
        },
      ] as any);
      mockGetScheduleForGuest.mockResolvedValue([
        {
          id: 'se-1',
          title: 'Main Ceremony',
          isPrivate: false,
          isReadOnly: false,
          userRsvp: { status: 'declined', plusOneCount: 0, dietaryNotes: '' },
        },
      ]);

      const req = new NextRequest('http://localhost:3000/api/rsvp', {
        method: 'POST',
        body: JSON.stringify({
          subEventId: 'se-1',
          status: 'declined',
          email: '',
        }),
      });

      const res = await POST(req, {});
      expect(res.status).toBe(200);
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      expect(sendEmailSpy.mock.calls[0][0].to).toBe('couple@wedding.example.com');

      sendEmailSpy.mockRestore();
    });

    it('returns HTTP 200 and logs PII-redacted warnings when email provider delivery fails or throws', async () => {
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      const sendEmailSpy = jest
        .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
        .mockResolvedValueOnce({
          success: false,
          error:
            'Resend 403 for Jane Secret <jane.secret@example.com> code SECRET99 note Severe Almond Allergy',
        })
        .mockRejectedValueOnce(
          new Error('Socket reset delivering to couple.secret@example.com for Smith Secret Family')
        );

      mockGetGuestInviteSession.mockResolvedValue({
        code: 'SECRET99',
        guestName: 'Jane Secret',
      });
      mockGetAppConfig.mockResolvedValue({
        emailProvider: 'resend',
        resendApiKey: 're_bad_key',
        contactEmail: 'couple.secret@example.com',
        baseUrl: 'https://wedding.example.com',
        timezone: 'UTC',
      } as any);
      mockInviteFindUnique.mockResolvedValue({
        guestName: 'Jane Secret',
        householdName: 'Smith Secret Family',
        email: 'jane.secret@example.com',
      });
      mockSubmitSubEventRsvps.mockResolvedValue([
        {
          id: 'rsvp-sec',
          subEventId: 'se-1',
          invitationCodeId: 'inv-sec',
          status: 'attending',
          plusOneCount: 0,
          dietaryNotes: 'Severe Almond Allergy',
        },
      ] as any);
      mockGetScheduleForGuest.mockResolvedValue([
        {
          id: 'se-1',
          title: 'Ceremony',
          isPrivate: false,
          isReadOnly: false,
          userRsvp: {
            status: 'attending',
            plusOneCount: 0,
            dietaryNotes: 'Severe Almond Allergy',
          },
        },
      ]);

      const req = new NextRequest('http://localhost:3000/api/rsvp', {
        method: 'POST',
        body: JSON.stringify({
          subEventId: 'se-1',
          status: 'attending',
          dietaryNotes: 'Severe Almond Allergy',
          email: 'jane.secret@example.com',
        }),
      });

      const res = await POST(req, {});
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalledTimes(2);

      const serializedWarnings = JSON.stringify(warnSpy.mock.calls);
      expect(serializedWarnings).not.toContain('jane.secret@example.com');
      expect(serializedWarnings).not.toContain('couple.secret@example.com');
      expect(serializedWarnings).not.toContain('Jane Secret');
      expect(serializedWarnings).not.toContain('Smith Secret Family');
      expect(serializedWarnings).not.toContain('SECRET99');
      expect(serializedWarnings).not.toContain('Severe Almond Allergy');
      expect(serializedWarnings).toContain('[REDACTED_EMAIL]');
      expect(serializedWarnings).toContain('[REDACTED]');

      sendEmailSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });
});
