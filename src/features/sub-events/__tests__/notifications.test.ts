/** @jest-environment node */

import { dispatchRsvpNotifications } from '../notifications';
import { subEventService } from '../service';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';

const mockSendEmail = jest.fn();

jest.mock('@/features/broadcast', () => {
  const actual = jest.requireActual('@/features/broadcast');
  return {
    ...actual,
    MultiChannelMessagingProvider: jest.fn().mockImplementation(() => ({
      sendEmail: mockSendEmail,
    })),
  };
});

jest.mock('../service', () => ({
  subEventService: {
    getScheduleForGuest: jest.fn(),
    getSavedEmailForGuest: jest.fn(),
  },
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invitationCode: {
      findUnique: jest.fn(),
    },
  },
}));

describe('dispatchRsvpNotifications', () => {
  const mockGetSchedule = subEventService.getScheduleForGuest as jest.Mock;
  const mockInviteFindUnique = (prisma as any).invitationCode.findUnique as jest.Mock;
  const mockLoggerWarn = logger.warn as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendEmail.mockReset();
    mockGetSchedule.mockReset();
    mockInviteFindUnique.mockReset();
  });

  it('skips dispatch cleanly when no active email provider is configured or submissions are empty', async () => {
    await dispatchRsvpNotifications({
      code: 'GUEST1',
      submissions: [
        { subEventId: 'se-1', status: 'attending', plusOneCount: 0, dietaryNotes: '' },
      ],
      config: { emailProvider: 'none', contactEmail: 'couple@example.com' },
    });
    expect(mockSendEmail).not.toHaveBeenCalled();

    await dispatchRsvpNotifications({
      code: '',
      submissions: [],
      config: { emailProvider: 'resend', contactEmail: 'couple@example.com' },
    });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('escapes HTML entities, sanitizes CRLF subjects, includes .ics link when attending, and alerts couple', async () => {
    mockSendEmail.mockResolvedValue({ success: true, messageId: 'msg-1' });
    mockInviteFindUnique.mockResolvedValue({
      guestName: 'Alex <script>alert(1)</script>\r\nBcc:evil@example.com',
      householdName: 'Rivera & Co',
      email: 'alex@example.com',
    });
    mockGetSchedule.mockResolvedValue([
      {
        id: 'se-1',
        title: 'Ceremony & Vows <b>Main</b>',
        startTime: new Date('2026-06-20T20:00:00.000Z'),
        endTime: new Date('2026-06-20T21:00:00.000Z'),
        locationName: 'Garden <West>',
        isPrivate: false,
        isReadOnly: false,
        userRsvp: {
          status: 'attending',
          plusOneCount: 1,
          plusOneNames: ['Sam <Guest>'],
          dietaryNotes: 'No peanuts & dairy',
        },
      },
      {
        id: 'se-2',
        title: 'Afterparty',
        startTime: null,
        endTime: null,
        locationName: '',
        isPrivate: true,
        isReadOnly: false,
        userRsvp: {
          status: 'pending',
          plusOneCount: 0,
          dietaryNotes: '',
        },
      },
    ]);

    await dispatchRsvpNotifications({
      code: 'guest1',
      submissions: [
        {
          subEventId: 'se-1',
          status: 'attending',
          plusOneCount: 1,
          plusOneNames: ['Sam <Guest>'],
          dietaryNotes: 'No peanuts & dairy',
        },
      ],
      hasRsvpChanges: true,
      config: {
        emailProvider: 'sendgrid',
        contactEmail: 'couple@example.com',
        partner1Name: 'Taylor',
        partner2Name: 'Jordan',
        timezone: 'Invalid/Timezone',
        baseUrl: 'https://wedding.example.com/',
      },
    });

    expect(mockSendEmail).toHaveBeenCalledTimes(2);
    const [guestMail, coupleMail] = mockSendEmail.mock.calls.map((c) => c[0]);

    expect(guestMail.to).toBe('alex@example.com');
    expect(guestMail.subject).toBe('Your RSVP Confirmation — Taylor & Jordan');
    expect(guestMail.body).not.toContain('<script>');
    expect(guestMail.body).toContain('&lt;script&gt;');
    expect(guestMail.body).toContain('Ceremony &amp; Vows &lt;b&gt;Main&lt;/b&gt;');
    expect(guestMail.body).toContain('Sam &lt;Guest&gt;');
    expect(guestMail.body).toContain('No peanuts &amp; dairy');
    expect(guestMail.body).toContain('https://wedding.example.com/guest?code=GUEST1');
    expect(guestMail.body).toContain('https://wedding.example.com/api/schedule/ics?token=');
    expect(guestMail.body).toContain('Accepted Events (1)');
    expect(guestMail.body).toContain('Declined Events (0)');
    expect(guestMail.body).toContain('Pending Events (1)');

    expect(coupleMail.to).toBe('couple@example.com');
    expect(coupleMail.subject).not.toMatch(/[\r\n]/);
    expect(coupleMail.body).toContain('Rivera &amp; Co');
    expect(coupleMail.body).toContain('https://wedding.example.com/admin/dashboard/invitation-codes');
  });

  it('omits .ics itinerary link when guest declined all events and suppresses couple alert when hasRsvpChanges is false', async () => {
    mockSendEmail.mockResolvedValue({ success: true });
    mockInviteFindUnique.mockResolvedValue({
      guestName: 'Casey Guest',
      householdName: 'Casey Guest',
      email: null,
    });
    mockGetSchedule.mockResolvedValue([]);

    await dispatchRsvpNotifications({
      code: 'DECLINE1',
      submittedEmail: 'casey@example.com',
      submissions: [
        {
          subEventId: 'se-ceremony',
          status: 'declined',
          plusOneCount: 2,
          dietaryNotes: '',
        },
      ],
      hasRsvpChanges: false,
      config: {
        emailProvider: 'smtp',
        contactEmail: 'couple@example.com',
      },
      requestUrl: 'http://localhost:3000/api/rsvp',
    });

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const [guestMail] = mockSendEmail.mock.calls[0];
    expect(guestMail.to).toBe('casey@example.com');
    expect(guestMail.body).toContain('Declined Events (1)');
    expect(guestMail.body).not.toContain('/api/schedule/ics');
    expect(guestMail.body).toContain('http://localhost:3000/guest?code=DECLINE1');
  });

  it('catches thrown provider exceptions without rejecting and redacts all PII in logger.warn', async () => {
    mockSendEmail.mockRejectedValue(
      new Error(
        'Provider rejected guest@secret.org for Secret Family (CODE99) dietary Halal meal'
      )
    );
    mockInviteFindUnique.mockResolvedValue({
      guestName: 'Secret Family',
      householdName: 'Secret Household',
      email: 'guest@secret.org',
    });
    mockGetSchedule.mockResolvedValue([]);

    await expect(
      dispatchRsvpNotifications({
        code: 'CODE99',
        submissions: [
          {
            subEventId: 'se-1',
            status: 'attending',
            plusOneCount: 0,
            dietaryNotes: 'Halal meal',
          },
        ],
        hasRsvpChanges: true,
        config: {
          emailProvider: 'resend',
          contactEmail: 'couple@secret.org',
        },
      })
    ).resolves.toBeUndefined();

    expect(mockLoggerWarn).toHaveBeenCalledTimes(2);
    const serializedWarnings = JSON.stringify(mockLoggerWarn.mock.calls);
    expect(serializedWarnings).not.toContain('guest@secret.org');
    expect(serializedWarnings).not.toContain('couple@secret.org');
    expect(serializedWarnings).not.toContain('Secret Family');
    expect(serializedWarnings).not.toContain('CODE99');
    expect(serializedWarnings).not.toContain('Halal meal');
    expect(serializedWarnings).toContain('[REDACTED_EMAIL]');
  });
});
