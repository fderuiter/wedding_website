import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { base64urlEncode, hmacSha256 } from '@/utils/crypto';
import {
  readRequestCookie,
  signCompactToken,
  verifyCompactToken,
} from '../tokenCookieHelpers';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

describe('tokenCookieHelpers', () => {
  const testSecret = 'test-hmac-signing-secret-for-unit-tests';

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('signCompactToken and verifyCompactToken', () => {
    it('signs a JSON payload into base64url(payload).base64url(signature) and verifies it', async () => {
      const payload = { role: 'admin', iat: 1700000000, exp: 1700028800 };
      const token = await signCompactToken(payload, testSecret);

      const parts = token.split('.');
      expect(parts).toHaveLength(2);
      expect(parts[0]).not.toMatch(/[+/=]/);
      expect(parts[1]).not.toMatch(/[+/=]/);

      const verified = await verifyCompactToken<typeof payload>(token, testSecret);
      expect(verified).toEqual(payload);
    });

    it('throws when signing with an empty secret', async () => {
      await expect(signCompactToken({ ok: true }, '')).rejects.toThrow(
        'Token signing secret is not configured'
      );
    });

    it('returns null when verified with a different secret or empty secret', async () => {
      const token = await signCompactToken({ user: 'guest' }, testSecret);

      await expect(verifyCompactToken(token, 'wrong-secret')).resolves.toBeNull();
      await expect(verifyCompactToken(token, '')).resolves.toBeNull();
    });

    it('returns null when signature or payload is tampered', async () => {
      const token = await signCompactToken({ guest: true }, testSecret);
      const [data, signature] = token.split('.');

      const tamperedSigChar = signature[0] === 'a' ? 'b' : 'a';
      const tamperedSigToken = `${data}.${tamperedSigChar}${signature.slice(1)}`;
      await expect(verifyCompactToken(tamperedSigToken, testSecret)).resolves.toBeNull();

      await expect(verifyCompactToken(`${token}extra`, testSecret)).resolves.toBeNull();

      const forgedData = base64urlEncode(JSON.stringify({ guest: false, elevated: true }));
      await expect(verifyCompactToken(`${forgedData}.${signature}`, testSecret)).resolves.toBeNull();
    });

    it('returns null for malformed tokens', async () => {
      await expect(verifyCompactToken('', testSecret)).resolves.toBeNull();
      await expect(verifyCompactToken(null as unknown as string, testSecret)).resolves.toBeNull();
      await expect(verifyCompactToken('missing-dot-separator', testSecret)).resolves.toBeNull();
      await expect(verifyCompactToken('.missingData', testSecret)).resolves.toBeNull();
      await expect(verifyCompactToken('missingSig.', testSecret)).resolves.toBeNull();

      const validToken = await signCompactToken({ ok: true }, testSecret);
      await expect(verifyCompactToken(`${validToken}.trailingSegment`, testSecret)).resolves.toBeNull();
      await expect(verifyCompactToken('a.b.c', testSecret)).resolves.toBeNull();

      const data = base64urlEncode(JSON.stringify({ ok: true }));
      await expect(verifyCompactToken(`${data}.%%%invalid-base64%%%`, testSecret)).resolves.toBeNull();
    });

    it('returns null when signed data is non-JSON or not a plain object', async () => {
      const nonObjectPayloads = [
        'not-valid-json{{{',
        JSON.stringify(null),
        JSON.stringify('string-primitive'),
        JSON.stringify(42),
        JSON.stringify(['array', 'payload']),
      ];

      for (const rawJson of nonObjectPayloads) {
        const data = base64urlEncode(rawJson);
        const signature = await hmacSha256(testSecret, data);
        await expect(verifyCompactToken(`${data}.${signature}`, testSecret)).resolves.toBeNull();
      }
    });
  });

  describe('readRequestCookie', () => {
    it('prefers NextRequest.cookies over the cookie header when present', async () => {
      const req = {
        cookies: {
          get: (name: string) => (name === 'session_cookie' ? { value: 'from-cookies-api' } : undefined),
        },
        headers: new Headers({
          cookie: 'session_cookie=from-header; other=1',
        }),
      } as unknown as NextRequest;

      await expect(readRequestCookie('session_cookie', req)).resolves.toBe('from-cookies-api');
      expect(cookies).not.toHaveBeenCalled();
    });

    it('falls back to parsing the cookie header when NextRequest.cookies returns undefined or empty', async () => {
      const req = {
        cookies: {
          get: () => undefined,
        },
        headers: new Headers({
          cookie: 'theme=light; session_cookie_other=wrong; session_cookie=token.value=with=equals; flag=1',
        }),
      } as unknown as NextRequest;

      await expect(readRequestCookie('session_cookie', req)).resolves.toBe('token.value=with=equals');
      expect(cookies).not.toHaveBeenCalled();
    });

    it('returns undefined when cookie is absent from both NextRequest.cookies and cookie header', async () => {
      const req = {
        cookies: {
          get: () => undefined,
        },
        headers: new Headers(),
      } as unknown as NextRequest;

      await expect(readRequestCookie('session_cookie', req)).resolves.toBeUndefined();
    });

    it('reads from next/headers cookies() when req is omitted', async () => {
      (cookies as jest.Mock).mockResolvedValue({
        get: (name: string) => (name === 'server_cookie' ? { value: 'from-next-headers' } : undefined),
      });

      await expect(readRequestCookie('server_cookie')).resolves.toBe('from-next-headers');
      await expect(readRequestCookie('missing_cookie')).resolves.toBeUndefined();
    });

    it('propagates next/headers cookies() errors by default and suppresses them when suppressErrors is true', async () => {
      (cookies as jest.Mock).mockRejectedValue(new Error('cookies() called outside request scope'));

      await expect(readRequestCookie('server_cookie')).rejects.toThrow(
        'cookies() called outside request scope'
      );
      await expect(
        readRequestCookie('server_cookie', undefined, { suppressErrors: true })
      ).resolves.toBeUndefined();
    });
  });
});
