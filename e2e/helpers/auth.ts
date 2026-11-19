import crypto from 'node:crypto';
import type { BrowserContext } from '@playwright/test';

const DEFAULT_E2E_GUEST_SESSION_SECRET = 'playwright-e2e-session-secret-32-chars-min';
const DEFAULT_E2E_GUEST_PASSCODE = 'wedding2026';
const DEFAULT_E2E_ADMIN_PASSWORD = 'scrypt:c2FsdA==:aGFzaA==';
const DEFAULT_E2E_ORIGINS = ['http://127.0.0.1:3000', 'http://localhost:3000'];
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function signCompactE2EToken(payload: Record<string, unknown>, secret: string): string {
  if (!secret) {
    throw new Error('Token signing secret is not configured');
  }
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64url');
  return `${data}.${signature}`;
}

function resolveCookieOrigins(extraOrigins?: string[]): string[] {
  if (!extraOrigins || extraOrigins.length === 0) {
    return DEFAULT_E2E_ORIGINS;
  }
  return Array.from(new Set([...DEFAULT_E2E_ORIGINS, ...extraOrigins]));
}

export function generateGuestCookieValue(): string {
  const secret = process.env.GUEST_SESSION_SECRET || DEFAULT_E2E_GUEST_SESSION_SECRET;
  const passcode = process.env.GUEST_PASSCODE || DEFAULT_E2E_GUEST_PASSCODE;
  if (secret === passcode) {
    throw new Error('GUEST_SESSION_SECRET must not use the value of GUEST_PASSCODE');
  }

  const now = Date.now();
  return signCompactE2EToken(
    {
      guest: true,
      iat: now,
      exp: now + SESSION_TTL_MS,
    },
    secret
  );
}

export function generateGuestInviteSessionCookieValue(code: string, guestName: string): string {
  const secret = process.env.GUEST_SESSION_SECRET || DEFAULT_E2E_GUEST_SESSION_SECRET;
  const passcode = process.env.GUEST_PASSCODE || DEFAULT_E2E_GUEST_PASSCODE;
  if (secret === passcode) {
    throw new Error('GUEST_SESSION_SECRET must not use the value of GUEST_PASSCODE');
  }

  const now = Date.now();
  return signCompactE2EToken(
    {
      code,
      guestName,
      iat: now,
      exp: now + SESSION_TTL_MS,
    },
    secret
  );
}

export function generateAdminCookieValue(): string {
  const secret = process.env.ADMIN_PASSWORD || DEFAULT_E2E_ADMIN_PASSWORD;
  if (!secret) {
    throw new Error('Admin auth secret is not configured');
  }

  const now = Date.now();
  return signCompactE2EToken(
    {
      isAdmin: true,
      iat: now,
      exp: now + SESSION_TTL_MS,
    },
    secret
  );
}

export async function seedGuestAuthCookies(
  context: BrowserContext,
  options?: { cookieValue?: string; extraOrigins?: string[] }
): Promise<string> {
  const guestCookieValue = options?.cookieValue ?? generateGuestCookieValue();
  const origins = resolveCookieOrigins(options?.extraOrigins);
  await context.addCookies(
    origins.map((url) => ({
      name: 'guest_auth',
      value: guestCookieValue,
      url,
    }))
  );
  return guestCookieValue;
}

export async function seedAdminAndGuestAuthCookies(
  context: BrowserContext,
  options?: {
    adminCookieValue?: string;
    guestCookieValue?: string;
    extraOrigins?: string[];
  }
): Promise<{ adminCookieValue: string; guestCookieValue: string }> {
  const adminCookieValue = options?.adminCookieValue ?? generateAdminCookieValue();
  const guestCookieValue = options?.guestCookieValue ?? generateGuestCookieValue();
  const origins = resolveCookieOrigins(options?.extraOrigins);
  await context.addCookies(
    origins.flatMap((url) => [
      {
        name: 'admin_auth',
        value: adminCookieValue,
        url,
      },
      {
        name: 'guest_auth',
        value: guestCookieValue,
        url,
      },
    ])
  );
  return { adminCookieValue, guestCookieValue };
}
