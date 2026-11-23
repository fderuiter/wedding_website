import { NextRequest } from 'next/server';
import { env } from '@/env';
import {
  readRequestCookie,
  signCompactToken,
  verifyCompactToken,
} from './tokenCookieHelpers';

export const GUEST_COOKIE = 'guest_auth';

async function getSecret(): Promise<string> {
  const isProduction = (process.env.NODE_ENV || env.NODE_ENV) === 'production';
  const fallback = isProduction ? '' : 'default-guest-session-secret';
  const secret = isProduction
    ? (process.env.GUEST_SESSION_SECRET || fallback)
    : (env.GUEST_SESSION_SECRET || process.env.GUEST_SESSION_SECRET || fallback);
  const passcode = isProduction
    ? (process.env.GUEST_PASSCODE || 'wedding2026')
    : (env.GUEST_PASSCODE || process.env.GUEST_PASSCODE || 'wedding2026');

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

interface GuestTokenPayload {
  guest: boolean;
  jti?: string;
  iat?: number;
  exp?: number;
}

function createPerLoginTokenId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function signGuestToken(payload: GuestTokenPayload): Promise<string> {
  const secret = await getSecret();
  if (!secret) {
    throw new Error('Guest auth secret is not configured');
  }
  const normalizedPayload: GuestTokenPayload = {
    ...payload,
    jti: payload.jti ?? createPerLoginTokenId(),
  };
  return signCompactToken(normalizedPayload, secret);
}

export async function verifyGuestToken(token: string): Promise<GuestTokenPayload | null> {
  if (!token || typeof token !== 'string') return null;

  try {
    const secret = await getSecret();
    if (!secret) return null;
    const payload = await verifyCompactToken<GuestTokenPayload>(token, secret);
    if (!payload || payload.guest !== true) {
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

export async function isGuestRequest(req?: NextRequest): Promise<boolean> {
  const cookieValue = await readRequestCookie(GUEST_COOKIE, req);
  if (!cookieValue) return false;

  const payload = await verifyGuestToken(cookieValue);
  return Boolean(payload && payload.guest === true);
}
