/** @jest-environment node */

import { NextRequest } from 'next/server';
import {
  GUEST_PHOTO_COOKIE,
  GUEST_PHOTO_SESSION_MAX_AGE_SECONDS,
  PHOTO_QR_LINK_TTL_MS,
  PHOTO_QR_QUERY_PARAM,
  buildSignedPhotoUploadUrl,
  getSignedPhotoUploadSession,
  isPhotoScopedApiRoute,
  isPhotoScopedPagePath,
  isPhotoScopedRoute,
  signPhotoQrLinkToken,
  signPhotoUploadSessionToken,
  verifyPhotoQrLinkToken,
  verifyPhotoUploadSessionToken,
} from '../photoUploadToken';
import {
  signGuestInviteSessionToken,
  verifyGuestInviteSessionToken,
} from '../guestInviteToken';
import { GUEST_COOKIE, isGuestRequest, signGuestToken } from '../guest.server';

describe('Photo Upload Scoped Tokens & Cross-Cookie Non-Replayability', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      GUEST_SESSION_SECRET: 'unit-test-photo-session-secret-at-least-32-chars',
      GUEST_PASSCODE: 'distinct-guest-passcode',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('signs and verifies QR link tokens with version and TTL', async () => {
    const now = Date.now();
    const token = await signPhotoQrLinkToken({ v: 4, iat: now });
    const payload = await verifyPhotoQrLinkToken(token);

    expect(payload).toEqual({
      purpose: 'photo_qr_link',
      v: 4,
      iat: now,
      exp: now + PHOTO_QR_LINK_TTL_MS,
    });
  });

  it('builds a signed deep-linked photo upload URL and strips trailing slashes from baseUrl', async () => {
    const { token, uploadUrl } = await buildSignedPhotoUploadUrl('https://wedding.example.com///', 2);
    expect(uploadUrl).toBe(
      `https://wedding.example.com/photos?${PHOTO_QR_QUERY_PARAM}=${encodeURIComponent(token)}`
    );

    const payload = await verifyPhotoQrLinkToken(token);
    expect(payload?.v).toBe(2);
    expect(payload?.purpose).toBe('photo_qr_link');
  });

  it('signs and verifies photo upload session cookie tokens and reads them from NextRequest', async () => {
    const now = Date.now();
    const sessionToken = await signPhotoUploadSessionToken({ v: 2, iat: now });
    const secondSessionTokenSameInstant = await signPhotoUploadSessionToken({ v: 2, iat: now });
    expect(sessionToken).not.toBe(secondSessionTokenSameInstant);
    const verified = await verifyPhotoUploadSessionToken(sessionToken);

    expect(verified).toEqual({
      purpose: 'photo_upload_session',
      v: 2,
      iat: now,
      exp: now + GUEST_PHOTO_SESSION_MAX_AGE_SECONDS * 1000,
    });

    const req = new NextRequest('http://localhost:3000/photos', {
      headers: {
        cookie: `${GUEST_PHOTO_COOKIE}=${sessionToken}`,
      },
    });
    const fromRequest = await getSignedPhotoUploadSession(req);
    expect(fromRequest).toEqual(verified);
  });

  it('rejects expired, malformed, or tampered tokens', async () => {
    const expiredQr = await signPhotoQrLinkToken({ v: 1, iat: 1000, exp: 2000 });
    expect(await verifyPhotoQrLinkToken(expiredQr)).toBeNull();

    const expiredSession = await signPhotoUploadSessionToken({ v: 1, iat: 1000, exp: 2000 });
    expect(await verifyPhotoUploadSessionToken(expiredSession)).toBeNull();

    const validQr = await signPhotoQrLinkToken({ v: 1 });
    const [payloadPart, sigPart] = validQr.split('.');
    const tamperedSig = `${payloadPart}.${sigPart.slice(0, -2)}aa`;
    expect(await verifyPhotoQrLinkToken(tamperedSig)).toBeNull();
    expect(await verifyPhotoQrLinkToken('')).toBeNull();
    expect(await verifyPhotoQrLinkToken(null)).toBeNull();
    expect(await verifyPhotoUploadSessionToken('not-a-valid-token')).toBeNull();
  });

  it('enforces strict domain separation so QR links, photo cookies, guest_auth, and guest_invite_session cannot be replayed across cookies', async () => {
    const qrToken = await signPhotoQrLinkToken({ v: 1 });
    const photoSessionToken = await signPhotoUploadSessionToken({ v: 1 });
    const guestToken = await signGuestToken({ guest: true, iat: Date.now() });
    const inviteToken = await signGuestInviteSessionToken({
      code: 'INVITE1',
      guestName: 'Alex Smith',
    });

    // QR link token cannot be stuffed directly into guest_photo_session cookie
    expect(await verifyPhotoUploadSessionToken(qrToken)).toBeNull();
    // Photo session token cannot be replayed as a ?qr= query link
    expect(await verifyPhotoQrLinkToken(photoSessionToken)).toBeNull();

    // Photo tokens cannot be replayed as guest_invite_session or guest_auth cookies
    expect(await verifyGuestInviteSessionToken(qrToken)).toBeNull();
    expect(await verifyGuestInviteSessionToken(photoSessionToken)).toBeNull();

    const forgedGuestReq = new NextRequest('http://localhost:3000/registry', {
      headers: {
        cookie: `${GUEST_COOKIE}=${photoSessionToken}`,
      },
    });
    expect(await isGuestRequest(forgedGuestReq)).toBe(false);

    // Guest tokens cannot be verified as photo tokens
    expect(await verifyPhotoUploadSessionToken(guestToken)).toBeNull();
    expect(await verifyPhotoUploadSessionToken(inviteToken)).toBeNull();
  });

  it('enforces GUEST_SESSION_SECRET production length and distinctness rules', async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      GUEST_SESSION_SECRET: 'short-secret',
      GUEST_PASSCODE: 'distinct-passcode',
    };

    await expect(signPhotoQrLinkToken({ v: 1 })).rejects.toThrow(
      /GUEST_SESSION_SECRET must be at least 32 characters/i
    );
  });

  it('classifies photo-scoped UI and API routes strictly', () => {
    expect(isPhotoScopedPagePath('/photos')).toBe(true);
    expect(isPhotoScopedPagePath('/photos/slideshow')).toBe(true);
    expect(isPhotoScopedPagePath('/')).toBe(false);
    expect(isPhotoScopedPagePath('/guest')).toBe(false);
    expect(isPhotoScopedPagePath('/registry')).toBe(false);

    expect(isPhotoScopedApiRoute('/api/photos', 'GET')).toBe(true);
    expect(isPhotoScopedApiRoute('/api/photos', 'HEAD')).toBe(true);
    expect(isPhotoScopedApiRoute('/api/photos', 'POST')).toBe(false);
    expect(isPhotoScopedApiRoute('/api/guest/photos/upload', 'POST')).toBe(true);
    expect(isPhotoScopedApiRoute('/api/guest/photos/upload', 'GET')).toBe(false);
    expect(isPhotoScopedApiRoute('/api/photos/upload', 'POST')).toBe(true);
    expect(isPhotoScopedApiRoute('/api/rsvp', 'POST')).toBe(false);
    expect(isPhotoScopedApiRoute('/api/media', 'GET')).toBe(false);

    expect(isPhotoScopedRoute('/photos', 'GET')).toBe(true);
    expect(isPhotoScopedRoute('/api/guest/photos/upload', 'POST')).toBe(true);
    expect(isPhotoScopedRoute('/api/rsvp', 'POST')).toBe(false);
  });
});
