import crypto from 'node:crypto';
import type { BrowserContext } from '@playwright/test';

const DEFAULT_E2E_GUEST_SESSION_SECRET = 'playwright-e2e-session-secret-32-chars-min';
const DEFAULT_E2E_GUEST_PASSCODE = 'playwright-e2e-guest-passcode';
const DEFAULT_E2E_ADMIN_PASSWORD =
  'scrypt:d2VkZGluZy1lMmUtc2FsdA==:q++ok9TyDBa8bSKUlVR+j/tjiVTGj95CWT5HK8KkpIHzWRnv2t2hAhDz2PkdPUDsMO+ulGpXGCFQAqDKwK7Lxw==';
const ADMIN_COOKIE_SIGNING_DOMAIN = 'wedding-website:admin-cookie-signing-key:v1';
const STRICT_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const DEFAULT_E2E_ORIGINS = ['http://127.0.0.1:3000', 'http://localhost:3000'];
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function decodeStandardBase64Buffer(b64: string): Buffer | null {
  if (!b64 || b64.length % 4 !== 0 || !STRICT_BASE64_PATTERN.test(b64)) {
    return null;
  }
  const buf = Buffer.from(b64, 'base64');
  return buf.toString('base64') === b64 ? buf : null;
}

function deriveAdminSigningKeySync(adminPassword: string): string {
  if (!adminPassword) {
    return '';
  }

  let keyMaterial: Buffer;
  if (adminPassword.startsWith('scrypt:')) {
    const parts = adminPassword.split(':');
    if (parts.length !== 3) {
      throw new Error('ADMIN_PASSWORD must be in the format scrypt:[16-byte saltBase64]:[64-byte keyBase64]');
    }
    const saltBuf = decodeStandardBase64Buffer(parts[1]);
    const keyBuf = decodeStandardBase64Buffer(parts[2]);
    if (!saltBuf || !keyBuf || saltBuf.byteLength !== 16 || keyBuf.byteLength !== 64) {
      throw new Error('ADMIN_PASSWORD must decode to a 16-byte salt and 64-byte scrypt key');
    }
    keyMaterial = Buffer.concat([saltBuf, Buffer.from(':', 'utf8'), keyBuf]);
  } else if (process.env.NODE_ENV === 'test') {
    keyMaterial = Buffer.from(adminPassword, 'utf8');
  } else {
    throw new Error('ADMIN_PASSWORD must use scrypt:[16-byte saltBase64]:[64-byte keyBase64] format');
  }

  return crypto
    .createHmac('sha256', keyMaterial)
    .update(ADMIN_COOKIE_SIGNING_DOMAIN, 'utf8')
    .digest('base64url');
}

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
  const rawAdminPassword = process.env.ADMIN_PASSWORD || DEFAULT_E2E_ADMIN_PASSWORD;
  if (!rawAdminPassword) {
    throw new Error('Admin auth secret is not configured');
  }
  const secret = deriveAdminSigningKeySync(rawAdminPassword);

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
