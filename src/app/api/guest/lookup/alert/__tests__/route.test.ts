/** @jest-environment node */

const mockGetAppConfig = jest.fn();
const mockSendEmail = jest.fn();

jest.mock('@/lib/config', () => ({
  getAppConfig: (...args: unknown[]) => mockGetAppConfig(...args),
}));

jest.mock('@/features/broadcast/providers', () => ({
  MultiChannelMessagingProvider: jest.fn().mockImplementation(() => ({
    sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  })),
}));

import { NextRequest } from 'next/server';
import { POST as lookupAlertRoute } from '../route';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';
import { signGuestToken, GUEST_COOKIE } from '@/core/auth/guest.server';

describe('POST /api/guest/lookup/alert', () => {
  let guestCookieHeader: string;

  beforeEach(async () => {
    jest.clearAllMocks();
    resetRateLimitsForTesting();
    const token = await signGuestToken({ guest: true, exp: Date.now() + 3600_000 });
    guestCookieHeader = `${GUEST_COOKIE}=${token}`;
    mockGetAppConfig.mockResolvedValue({
      contactEmail: 'couple@wedding-domain.org',
    });
    mockSendEmail.mockResolvedValue({ success: true });
  });

  it('rejects unauthenticated requests with 401', async () => {
    const req = new NextRequest('http://localhost/api/guest/lookup/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guestName: 'Claire Bennett',
        guestEmail: 'claire@example.com',
      }),
    });
    const res = await lookupAlertRoute(req);
    expect(res.status).toBe(401);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('validates guestName and guestEmail format', async () => {
    const badJsonReq = new NextRequest('http://localhost/api/guest/lookup/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: guestCookieHeader },
      body: '{invalid',
    });
    expect((await lookupAlertRoute(badJsonReq)).status).toBe(400);

    const invalidEmailReq = new NextRequest('http://localhost/api/guest/lookup/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: guestCookieHeader },
      body: JSON.stringify({ guestName: 'Claire Bennett', guestEmail: 'not-email' }),
    });
    expect((await lookupAlertRoute(invalidEmailReq)).status).toBe(400);
  });

  it('rejects HTML brackets at validation and HTML-escapes ampersands/quotes in host alert email', async () => {
    const xssReq = new NextRequest('http://localhost/api/guest/lookup/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: guestCookieHeader },
      body: JSON.stringify({
        guestName: 'Claire <script>alert(1)</script> Bennett',
        guestEmail: 'claire@example.com',
      }),
    });
    expect((await lookupAlertRoute(xssReq)).status).toBe(400);
    expect(mockSendEmail).not.toHaveBeenCalled();

    const req = new NextRequest('http://localhost/api/guest/lookup/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: guestCookieHeader },
      body: JSON.stringify({
        guestName: "Claire O'Connor & Oliver Bennett",
        guestEmail: 'claire@example.com',
        message: 'Tried "Bennett" & maiden surname',
      }),
    });

    const res = await lookupAlertRoute(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const emailArg = mockSendEmail.mock.calls[0][0];
    expect(emailArg.to).toBe('couple@wedding-domain.org');
    expect(emailArg.subject).toContain('[RSVP Name Lookup Help]');
    expect(emailArg.body).toContain('Claire O&#39;Connor &amp; Oliver Bennett');
    expect(emailArg.body).toContain('claire@example.com');
    expect(emailArg.body).toContain('Tried &quot;Bennett&quot; &amp; maiden surname');
  });

  it('returns 503 when AppConfig.contactEmail is missing or placeholder', async () => {
    mockGetAppConfig.mockResolvedValueOnce({
      contactEmail: 'hosts@wedding.example',
    });

    const req = new NextRequest('http://localhost/api/guest/lookup/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: guestCookieHeader },
      body: JSON.stringify({
        guestName: 'Claire Bennett',
        guestEmail: 'claire@example.com',
      }),
    });
    const res = await lookupAlertRoute(req);
    expect(res.status).toBe(503);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('returns 502 when email provider fails to deliver', async () => {
    mockSendEmail.mockResolvedValueOnce({ success: false, error: 'SMTP refused' });

    const req = new NextRequest('http://localhost/api/guest/lookup/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: guestCookieHeader },
      body: JSON.stringify({
        guestName: 'Claire Bennett',
        guestEmail: 'claire@example.com',
      }),
    });
    const res = await lookupAlertRoute(req);
    expect(res.status).toBe(502);
  });

  it('enforces 5 requests per 15 minutes rate limit', async () => {
    const makeReq = () =>
      lookupAlertRoute(
        new NextRequest('http://localhost/api/guest/lookup/alert', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '198.51.100.77',
            cookie: guestCookieHeader,
          },
          body: JSON.stringify({
            guestName: 'Claire Bennett',
            guestEmail: 'claire@example.com',
          }),
        })
      );

    for (let i = 0; i < 5; i++) {
      expect((await makeReq()).status).toBe(200);
    }
    expect((await makeReq()).status).toBe(429);
  });
});
