import { NextRequest } from 'next/server';
import { env } from '@/env';
import {
  readRequestCookie,
  signCompactToken,
  verifyCompactToken,
} from './tokenCookieHelpers';

export const GUEST_COOKIE = 'guest_auth';

async function getSecret(): Promise<string> {
  const secret = env.GUEST_SESSION_SECRET || process.env.GUEST_SESSION_SECRET || 'default-guest-session-secret';
  const passcode = env.GUEST_PASSCODE || process.env.GUEST_PASSCODE || 'wedding2026';
  if (secret === passcode) {
    throw new Error('GUEST_SESSION_SECRET must not use the value of GUEST_PASSCODE');
  }
  return secret;
}

interface GuestTokenPayload {
  guest: boolean;
  iat?: number;
  exp?: number;
}

export async function signGuestToken(payload: GuestTokenPayload): Promise<string> {
  const secret = await getSecret();
  if (!secret) {
    throw new Error('Guest auth secret is not configured');
  }
  return signCompactToken(payload, secret);
}

async function verifyGuestToken(token: string): Promise<GuestTokenPayload | null> {
  if (!token || typeof token !== 'string') return null;

  try {
    const secret = await getSecret();
    if (!secret) return null;
    return verifyCompactToken<GuestTokenPayload>(token, secret);
  } catch {
    return null;
  }
}

export async function isGuestRequest(req?: NextRequest): Promise<boolean> {
  const cookieValue = await readRequestCookie(GUEST_COOKIE, req);
  if (!cookieValue) return false;

  const payload = await verifyGuestToken(cookieValue);

  if (!payload || payload.guest !== true) {
    return false;
  }

  const now = Date.now();
  if (payload.exp && payload.exp < now) {
    return false;
  }

  return true;
}
