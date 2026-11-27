/** @jest-environment node */

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invitationCode: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
}));

jest.mock('@/features/sub-events', () => {
  const actual = jest.requireActual('@/features/sub-events');
  return {
    ...actual,
    subEventService: {
      getRsvpStatus: jest.fn(),
      submitSubEventRsvps: jest.fn(),
    },
  };
});

import { NextRequest } from 'next/server';
import { GET as recoverGet, POST as recoverPost } from '../route';
import { POST as validateCodePost } from '@/app/api/registry/validate-code/route';
import { POST as rsvpPost } from '@/app/api/rsvp/route';
import { middleware } from '@/middleware';
import { prisma } from '@/lib/prisma';
import { getAppConfig } from '@/lib/config';
import { MultiChannelMessagingProvider } from '@/features/broadcast';
import { subEventService } from '@/features/sub-events';
import { signGuestToken, GUEST_COOKIE } from '@/core/auth/guest.server';
import {
  signGuestInviteSessionToken,
  GUEST_INVITE_COOKIE,
} from '@/core/auth/guestInviteSession';
import {
  GUEST_PHOTO_COOKIE,
  signPhotoUploadSessionToken,
} from '@/core/auth/photoUploadToken';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';
import {
  HOUSEHOLD_RECOVERY_COOLDOWN_MS,
  RECOVERY_CONFIRMATION_MESSAGE,
  resetHouseholdRecoveryCooldownsForTests,
} from '@/utils/guestSignInRecovery';

const mockFindMany = prisma.invitationCode.findMany as jest.Mock;
const mockFindUnique = prisma.invitationCode.findUnique as jest.Mock;
const mockUpdate = prisma.invitationCode.update as jest.Mock;
const mockGetAppConfig = getAppConfig as jest.Mock;
const mockGetRsvpStatus = subEventService.getRsvpStatus as jest.Mock;
const mockSubmitSubEventRsvps = subEventService.submitSubEventRsvps as jest.Mock;

const ACTIVE_EMAIL_CONFIG = {
  partner1Name: 'Eleanor',
  partner2Name: 'Arthur',
  heroTitle: 'Eleanor & Arthur',
  baseUrl: 'https://wedding.example.org',
  emailProvider: 'resend',
  resendApiKey: 're_test_123',
  resendFrom: 'Eleanor & Arthur <rsvp@wedding.example.org>',
  smsProvider: 'none',
};

const ACTIVE_SMS_ONLY_CONFIG = {
  partner1Name: 'Eleanor',
  partner2Name: 'Arthur',
  heroTitle: 'Eleanor & Arthur',
  baseUrl: 'https://wedding.example.org',
  emailProvider: 'smtp',
  smtpHost: '',
  smsProvider: 'twilio',
  twilioAccountSid: 'AC1234567890abcdef',
  twilioAuthToken: 'twilio_secret_token',
  twilioFromNumber: '+15550001111',
};

const INACTIVE_MESSAGING_CONFIG = {
  partner1Name: 'Eleanor',
  partner2Name: 'Arthur',
  heroTitle: 'Eleanor & Arthur',
  baseUrl: 'https://wedding.example.org',
  emailProvider: 'smtp',
  smtpHost: '',
  smsProvider: 'none',
};

describe('/api/guest/recover — Self-Service One-Click Sign-In Link Recovery', () => {
  let sendEmailSpy: jest.SpyInstance;
  let sendSmsSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitsForTesting();
    resetHouseholdRecoveryCooldownsForTests();
    mockGetAppConfig.mockResolvedValue(ACTIVE_EMAIL_CONFIG);
    mockFindMany.mockResolvedValue([]);

    sendEmailSpy = jest
      .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
      .mockResolvedValue({ success: true });
    sendSmsSpy = jest
      .spyOn(MultiChannelMessagingProvider.prototype, 'sendSms')
      .mockResolvedValue({ success: true });
  });

  afterEach(() => {
    sendEmailSpy.mockRestore();
    sendSmsSpy.mockRestore();
  });

  describe('Middleware & Session Boundary Exemptions', () => {
    it('allows unauthenticated, shared-passcode, photo-QR, and stale/revoked invite cookies without 401 or Set-Cookie', async () => {
      const guestToken = await signGuestToken({
        guest: true,
        exp: Date.now() + 60_000,
      });
      const photoToken = await signPhotoUploadSessionToken({
        v: 1,
        exp: Date.now() + 60_000,
      });
      const staleInviteToken = await signGuestInviteSessionToken({
        code: 'REVOKED99',
        guestName: 'Former Guest',
        exp: Date.now() + 60_000,
      });
      mockFindUnique.mockResolvedValue(null);

      const cookieCases = [
        '',
        `${GUEST_COOKIE}=${guestToken}`,
        `${GUEST_PHOTO_COOKIE}=${photoToken}`,
        `${GUEST_INVITE_COOKIE}=${staleInviteToken}`,
      ];

      for (const [idx, cookieHeader] of cookieCases.entries()) {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
          'x-forwarded-for': `198.51.100.${10 + idx}`,
        };
        if (cookieHeader) {
          headers.cookie = cookieHeader;
        }

        const getReq = new NextRequest('http://localhost:3000/api/guest/recover', {
          method: 'GET',
          headers,
        });
        const mwGetRes = await middleware(getReq);
        expect(mwGetRes.status).not.toBe(401);
        expect(mwGetRes.status).not.toBe(307);

        const routeGetRes = await recoverGet(getReq);
        expect(routeGetRes.status).toBe(200);
        expect(routeGetRes.headers.get('set-cookie')).toBeNull();

        const postReq = new NextRequest('http://localhost:3000/api/guest/recover', {
          method: 'POST',
          headers,
          body: JSON.stringify({ identifier: 'Unmatched Person' }),
        });
        const mwPostRes = await middleware(postReq);
        expect(mwPostRes.status).not.toBe(401);
        expect(mwPostRes.status).not.toBe(307);

        const routePostRes = await recoverPost(postReq);
        expect(routePostRes.status).toBe(200);
        expect(routePostRes.headers.get('set-cookie')).toBeNull();
      }
    });
  });

  describe('GET /api/guest/recover Capability Reporting', () => {
    it('reports active email/SMS state without leaking provider credentials', async () => {
      mockGetAppConfig.mockResolvedValueOnce(ACTIVE_EMAIL_CONFIG);
      const emailRes = await recoverGet(
        new NextRequest('http://localhost:3000/api/guest/recover')
      );
      expect(emailRes.status).toBe(200);
      const emailJson = await emailRes.json();
      expect(emailJson.data).toEqual({
        messagingActive: true,
        emailActive: true,
        smsActive: false,
      });
      expect(JSON.stringify(emailJson)).not.toContain('re_test_123');

      mockGetAppConfig.mockResolvedValueOnce(INACTIVE_MESSAGING_CONFIG);
      const inactiveRes = await recoverGet(
        new NextRequest('http://localhost:3000/api/guest/recover')
      );
      const inactiveJson = await inactiveRes.json();
      expect(inactiveJson.data).toEqual({
        messagingActive: false,
        emailActive: false,
        smsActive: false,
      });
    });
  });

  describe('Validation & Provider Guardrails', () => {
    it('returns 400 on invalid JSON, empty input, invalid email, or single-word surname', async () => {
      const badJsonReq = new NextRequest('http://localhost:3000/api/guest/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{broken',
      });
      expect((await recoverPost(badJsonReq)).status).toBe(400);

      const emptyReq = new NextRequest('http://localhost:3000/api/guest/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: '   ' }),
      });
      expect((await recoverPost(emptyReq)).status).toBe(400);

      const badEmailReq = new NextRequest('http://localhost:3000/api/guest/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'not-an-email@' }),
      });
      expect((await recoverPost(badEmailReq)).status).toBe(400);

      const surnameOnlyReq = new NextRequest('http://localhost:3000/api/guest/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'Mr. Smith' }),
      });
      const surnameRes = await recoverPost(surnameOnlyReq);
      expect(surnameRes.status).toBe(400);
      const surnameJson = await surnameRes.json();
      expect(surnameJson.error).toMatch(/first and last name/i);
      expect(sendEmailSpy).not.toHaveBeenCalled();
    });

    it('returns 503 when neither email nor SMS provider is active', async () => {
      mockGetAppConfig.mockResolvedValueOnce(INACTIVE_MESSAGING_CONFIG);
      const req = new NextRequest('http://localhost:3000/api/guest/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'eleanor.vance@example.org' }),
      });
      const res = await recoverPost(req);
      expect(res.status).toBe(503);
      expect(sendEmailSpy).not.toHaveBeenCalled();
      expect(sendSmsSpy).not.toHaveBeenCalled();
    });
  });

  describe('Email & SMS One-Click Link Delivery + Anti-Enumeration', () => {
    const invitedHousehold = {
      id: 'inv-vance-1',
      code: 'VANCE2026',
      guestName: 'John & Eleanor Vance',
      householdName: 'The Vance Household',
      email: 'eleanor.vance@example.org',
      plusOneFirstName: 'Clara',
      plusOneLastName: 'Oswald',
      partyTags: ['VIP'],
      extraFields: { phone: '+15552345678' },
      isSample: false,
      members: [
        {
          fullName: 'Eleanor Vance',
          firstName: 'Eleanor',
          lastName: 'Vance',
          role: 'PRIMARY',
          email: 'eleanor.vance@example.org',
          phone: '+15552345678',
          displayOrder: 0,
        },
        {
          fullName: 'Clara Oswald',
          firstName: 'Clara',
          lastName: 'Oswald',
          role: 'PARTNER',
          email: 'clara.oswald@example.org',
          phone: null,
          displayOrder: 1,
        },
        {
          fullName: 'Toby Vance',
          firstName: 'Toby',
          lastName: 'Vance',
          role: 'CHILD',
          email: null,
          phone: null,
          displayOrder: 2,
        },
      ],
    };

    it('sends a personalized /guest?code=<CODE> email link for matched email or adult household name', async () => {
      mockFindMany.mockResolvedValue([invitedHousehold]);

      // 1. Match by adult partner email -> sends directly to partner's email
      const emailReq = new NextRequest('http://localhost:3000/api/guest/recover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.10',
        },
        body: JSON.stringify({ identifier: 'CLARA.OSWALD@example.org' }),
      });
      const emailRes = await recoverPost(emailReq);
      expect(emailRes.status).toBe(200);
      expect(emailRes.headers.get('set-cookie')).toBeNull();
      const emailJson = await emailRes.json();
      expect(emailJson).toEqual({
        success: true,
        message: RECOVERY_CONFIRMATION_MESSAGE,
      });
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      expect(sendEmailSpy).toHaveBeenCalledWith({
        to: 'clara.oswald@example.org',
        subject: expect.stringContaining('Eleanor & Arthur'),
        body: expect.stringContaining('https://wedding.example.org/guest?code=VANCE2026'),
      });

      // Reset cooldown to test couple split first+shared-last name ("John Vance" from "John & Eleanor Vance")
      resetHouseholdRecoveryCooldownsForTests();
      sendEmailSpy.mockClear();

      const nameReq = new NextRequest('http://localhost:3000/api/guest/recover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.11',
        },
        body: JSON.stringify({ identifier: 'John Vance' }),
      });
      const nameRes = await recoverPost(nameReq);
      expect(nameRes.status).toBe(200);
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      expect(sendEmailSpy).toHaveBeenCalledWith({
        to: 'eleanor.vance@example.org',
        subject: expect.any(String),
        body: expect.stringContaining('https://wedding.example.org/guest?code=VANCE2026'),
      });
    });

    it('dispatches via Twilio SMS when email is unavailable/inactive and SMS is active', async () => {
      mockGetAppConfig.mockResolvedValue(ACTIVE_SMS_ONLY_CONFIG);
      mockFindMany.mockResolvedValue([
        {
          ...invitedHousehold,
          id: 'inv-sms-only',
          code: 'SMSONLY26',
          email: null,
          extraFields: null,
          members: [
            {
              fullName: 'Marcus Sterling',
              firstName: 'Marcus',
              lastName: 'Sterling',
              role: 'PRIMARY',
              email: null,
              phone: '+15559876543',
              displayOrder: 0,
            },
          ],
          guestName: 'Marcus Sterling',
        },
      ]);

      const req = new NextRequest('http://localhost:3000/api/guest/recover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.12',
        },
        body: JSON.stringify({ identifier: 'Marcus Sterling' }),
      });
      const res = await recoverPost(req);
      expect(res.status).toBe(200);
      expect(sendEmailSpy).not.toHaveBeenCalled();
      expect(sendSmsSpy).toHaveBeenCalledTimes(1);
      expect(sendSmsSpy).toHaveBeenCalledWith({
        to: '+15559876543',
        body: expect.stringContaining('https://wedding.example.org/guest?code=SMSONLY26'),
      });
    });

    it('returns byte-for-byte identical HTTP 200 JSON with zero cookies/leaks across matched, unmatched, honeypot, cooldown, sample, address-collection, child, and ambiguous inputs', async () => {
      const records = [
        invitedHousehold,
        {
          id: 'inv-collect-lead',
          code: 'COLLECT88',
          guestName: 'Prospect Lead',
          email: 'prospect@example.org',
          partyTags: ['address-collection'],
          isSample: false,
          members: [],
        },
        {
          id: 'inv-sample-row',
          code: 'SAMPLE88',
          guestName: 'Sample Household',
          email: 'sample@example.org',
          partyTags: [],
          isSample: true,
          members: [],
        },
        {
          id: 'inv-dup-1',
          code: 'DUPONE26',
          guestName: 'Alex Morgan',
          email: 'alex1@example.org',
          partyTags: [],
          isSample: false,
          members: [],
        },
        {
          id: 'inv-dup-2',
          code: 'DUPTWO26',
          guestName: 'Alex Morgan',
          email: 'alex2@example.org',
          partyTags: [],
          isSample: false,
          members: [],
        },
      ];
      mockFindMany.mockResolvedValue(records);

      const scenarios: Array<{ label: string; body: Record<string, unknown>; expectsSend: boolean }> = [
        {
          label: 'matched household',
          body: { identifier: 'eleanor.vance@example.org' },
          expectsSend: true,
        },
        {
          label: 'cooldown-suppressed repeat household',
          body: { identifier: 'Eleanor Vance' },
          expectsSend: false,
        },
        {
          label: 'unmatched guest',
          body: { identifier: 'nobody.here@example.org' },
          expectsSend: false,
        },
        {
          label: 'honeypot website tripped',
          body: { identifier: 'eleanor.vance@example.org', website: 'https://spam.bot' },
          expectsSend: false,
        },
        {
          label: 'address-collection lead',
          body: { identifier: 'prospect@example.org' },
          expectsSend: false,
        },
        {
          label: 'isSample record',
          body: { identifier: 'sample@example.org' },
          expectsSend: false,
        },
        {
          label: 'child household member name',
          body: { identifier: 'Toby Vance' },
          expectsSend: false,
        },
        {
          label: 'ambiguous duplicate full name',
          body: { identifier: 'Alex Morgan' },
          expectsSend: false,
        },
      ];

      let baselineBodyText: string | null = null;

      for (const [idx, scenario] of scenarios.entries()) {
        resetRateLimitsForTesting();
        sendEmailSpy.mockClear();
        const req = new NextRequest('http://localhost:3000/api/guest/recover', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': `192.0.2.${20 + idx}`,
          },
          body: JSON.stringify(scenario.body),
        });
        const res = await recoverPost(req);
        expect(res.status).toBe(200);
        expect(res.headers.get('set-cookie')).toBeNull();

        const parsed = await res.json();
        const rawText = JSON.stringify(parsed);
        if (baselineBodyText === null) {
          baselineBodyText = rawText;
        } else {
          expect(rawText).toBe(baselineBodyText);
        }

        expect(parsed).toEqual({
          success: true,
          message: RECOVERY_CONFIRMATION_MESSAGE,
        });
        expect(rawText).not.toContain('VANCE2026');
        expect(rawText).not.toContain('Eleanor Vance');
        expect(sendEmailSpy).toHaveBeenCalledTimes(scenario.expectsSend ? 1 : 0);
      }
    });

    it('allows resending after the per-household cooldown window expires', async () => {
      mockFindMany.mockResolvedValue([invitedHousehold]);
      const baseNow = 1_750_000_000_000;
      const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(baseNow);

      try {
        const makeReq = (ip: string) =>
          new NextRequest('http://localhost:3000/api/guest/recover', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-forwarded-for': ip,
            },
            body: JSON.stringify({ identifier: 'eleanor.vance@example.org' }),
          });

        await recoverPost(makeReq('198.51.100.50'));
        expect(sendEmailSpy).toHaveBeenCalledTimes(1);

        // Within 10-minute cooldown window -> suppressed
        dateSpy.mockReturnValue(baseNow + HOUSEHOLD_RECOVERY_COOLDOWN_MS - 1_000);
        await recoverPost(makeReq('198.51.100.51'));
        expect(sendEmailSpy).toHaveBeenCalledTimes(1);

        // After 10-minute cooldown window -> dispatches again
        dateSpy.mockReturnValue(baseNow + HOUSEHOLD_RECOVERY_COOLDOWN_MS + 1_000);
        await recoverPost(makeReq('198.51.100.52'));
        expect(sendEmailSpy).toHaveBeenCalledTimes(2);
      } finally {
        dateSpy.mockRestore();
      }
    });

    it('enforces IP AuthLockout (429) on the 6th POST /api/guest/recover attempt even across HTTP 200 responses', async () => {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const req = new NextRequest('http://localhost:3000/api/guest/recover', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '203.0.113.99',
          },
          body: JSON.stringify({ identifier: `Guest Attempt${attempt}` }),
        });
        const res = await recoverPost(req);
        expect(res.status).toBe(200);
      }

      const sixthReq = new NextRequest('http://localhost:3000/api/guest/recover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.99',
        },
        body: JSON.stringify({ identifier: 'Guest AttemptSix' }),
      });
      const sixthRes = await recoverPost(sixthReq);
      expect(sixthRes.status).toBe(429);
    });

    it('completes the one-click /guest?code=<CODE> session exchange and succeeds on POST /api/rsvp', async () => {
      mockFindMany.mockResolvedValue([invitedHousehold]);
      mockFindUnique.mockResolvedValue(invitedHousehold);
      mockUpdate.mockResolvedValue({ ...invitedHousehold, used: true });
      mockGetRsvpStatus.mockResolvedValue({ isOpen: true, closedMessage: '' });
      mockSubmitSubEventRsvps.mockResolvedValue([
        {
          id: 'rsvp-1',
          subEventId: 'sub-ceremony',
          invitationCodeId: invitedHousehold.id,
          status: 'attending',
        },
      ]);

      // Step 1: Request sign-in link via POST /api/guest/recover
      const recoverRes = await recoverPost(
        new NextRequest('http://localhost:3000/api/guest/recover', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '203.0.113.77',
          },
          body: JSON.stringify({ identifier: 'eleanor.vance@example.org' }),
        })
      );
      expect(recoverRes.status).toBe(200);
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);

      // Extract the one-click /guest?code=<CODE> URL from the sent email body
      const sentPayload = sendEmailSpy.mock.calls[0][0] as { body: string };
      const sentBody = String(sentPayload.body);
      const urlMatch = sentBody.match(/https?:\/\/[^\s]+\/guest\?code=([A-Za-z0-9_-]+)/);
      expect(urlMatch).not.toBeNull();
      const extractedCode = decodeURIComponent(urlMatch![1]);
      expect(extractedCode).toBe('VANCE2026');

      // Step 2: Follow /guest?code=<CODE> -> POST /api/registry/validate-code sets guest_invite_session
      const validateRes = await validateCodePost(
        new NextRequest('http://localhost:3000/api/registry/validate-code', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '203.0.113.77',
          },
          body: JSON.stringify({ code: extractedCode }),
        })
      );
      expect(validateRes.status).toBe(200);
      const setCookie = validateRes.headers.get('set-cookie') || '';
      expect(setCookie).toContain(`${GUEST_INVITE_COOKIE}=`);
      const cookiePair = setCookie.split(';')[0];

      // Step 3: Submit POST /api/rsvp using the issued guest_invite_session cookie
      const rsvpRes = await rsvpPost(
        new NextRequest('http://localhost:3000/api/rsvp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: cookiePair,
            'x-forwarded-for': '203.0.113.77',
          },
          body: JSON.stringify({
            rsvps: [
              {
                subEventId: '11111111-1111-4111-8111-111111111111',
                status: 'attending',
                plusOneCount: 1,
              },
            ],
          }),
        })
      );
      expect(rsvpRes.status).toBe(200);
      const rsvpJson = await rsvpRes.json();
      expect(rsvpJson.success).toBe(true);
      expect(mockSubmitSubEventRsvps).toHaveBeenCalledWith(
        'VANCE2026',
        expect.arrayContaining([
          expect.objectContaining({
            subEventId: '11111111-1111-4111-8111-111111111111',
            status: 'attending',
          }),
        ])
      );
    });
  });
});
