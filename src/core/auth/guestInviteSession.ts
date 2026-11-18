import { NextRequest } from 'next/server';
import { env } from '@/env';
import {
  readRequestCookie,
  signCompactToken,
  verifyCompactToken,
} from './tokenCookieHelpers';

export const GUEST_INVITE_COOKIE = 'guest_invite_session';

export interface GuestInviteSessionPayload {
  code: string;
  guestName: string;
  iat?: number;
  exp?: number;
}

async function getSecret(): Promise<string> {
  const isProduction = (env.NODE_ENV || process.env.NODE_ENV) === 'production';
  const fallback = isProduction ? '' : 'default-guest-session-secret';
  const secret = env.GUEST_SESSION_SECRET || process.env.GUEST_SESSION_SECRET || fallback;
  const passcode = env.GUEST_PASSCODE || process.env.GUEST_PASSCODE || 'wedding2026';

  if (isProduction) {
    if (!secret || secret === 'default-guest-session-secret') {
      throw new Error('GUEST_SESSION_SECRET must be configured with a distinct secret in production');
    }
    if (secret.length < 32) {
      throw new Error('GUEST_SESSION_SECRET must be at least 32 characters long in production');
    }
  }

  if (secret === passcode) {
    throw new Error('GUEST_SESSION_SECRET must not use the value of GUEST_PASSCODE');
  }
  return secret;
}

/**
 * Signs a guest invitation payload into a JWT-like compact token with 7-day expiration.
 */
export async function signGuestInviteSessionToken(payload: Omit<GuestInviteSessionPayload, 'iat' | 'exp'> & { iat?: number; exp?: number }): Promise<string> {
  const iat = payload.iat ?? Date.now();
  const exp = payload.exp ?? (iat + 7 * 24 * 60 * 60 * 1000); // 7 days
  const fullPayload: GuestInviteSessionPayload = {
    ...payload,
    iat,
    exp,
  };
  const secret = await getSecret();
  return signCompactToken(fullPayload, secret);
}

/**
 * Validates a guest invitation session token and returns the decoded payload if valid.
 */
export async function verifyGuestInviteSessionToken(token: string): Promise<GuestInviteSessionPayload | null> {
  if (!token || typeof token !== 'string') return null;

  try {
    const secret = await getSecret();
    const payload = await verifyCompactToken<GuestInviteSessionPayload>(token, secret);
    if (!payload || !payload.code || !payload.guestName) {
      return null;
    }

    const now = Date.now();
    if (payload.exp && payload.exp < now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Retrieve verified guest invitation session from NextRequest or cookieStore.
 */
export async function getGuestInviteSession(req?: NextRequest): Promise<GuestInviteSessionPayload | null> {
  const cookieValue = await readRequestCookie(GUEST_INVITE_COOKIE, req, { suppressErrors: true });
  if (!cookieValue) return null;

  return verifyGuestInviteSessionToken(cookieValue);
}
