import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { env } from '@/env';

export const GUEST_INVITE_COOKIE = 'guest_invite_session';

export interface GuestInviteSessionPayload {
  code: string;
  guestName: string;
  iat?: number;
  exp?: number;
}

async function getSecret(): Promise<string> {
  return env.GUEST_PASSCODE || process.env.GUEST_PASSCODE || 'wedding2026';
}

function base64urlEncodeBytes(bytes: Uint8Array): string {
  let binString = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binString += String.fromCharCode(bytes[i]);
  }
  return btoa(binString)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return base64urlEncodeBytes(bytes);
}

function base64urlDecode(str: string): string {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const binString = atob(base64 + padding);
  const bytes = new Uint8Array(binString.length);
  for (let i = 0; i < binString.length; i++) {
    bytes[i] = binString.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function base64urlDecodeToBytes(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const binString = atob(base64 + padding);
  const bytes = new Uint8Array(binString.length);
  for (let i = 0; i < binString.length; i++) {
    bytes[i] = binString.charCodeAt(i);
  }
  return bytes;
}

async function hmacSha256(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);
  
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    messageData
  );
  
  return base64urlEncodeBytes(new Uint8Array(signature));
}

function timingSafeEqualJS(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.byteLength; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
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
  const data = base64urlEncode(JSON.stringify(fullPayload));
  const secret = await getSecret();
  const signature = await hmacSha256(secret, data);
  return `${data}.${signature}`;
}

/**
 * Validates a guest invitation session token and returns the decoded payload if valid.
 */
export async function verifyGuestInviteSessionToken(token: string): Promise<GuestInviteSessionPayload | null> {
  try {
    if (!token || typeof token !== 'string') return null;
    const [data, signature] = token.split('.');
    if (!data || !signature) return null;

    const secret = await getSecret();
    const expectedSignature = await hmacSha256(secret, data);

    const signatureBuffer = base64urlDecodeToBytes(signature);
    const expectedSignatureBuffer = base64urlDecodeToBytes(expectedSignature);

    if (!timingSafeEqualJS(signatureBuffer, expectedSignatureBuffer)) {
      return null;
    }

    const payload = JSON.parse(base64urlDecode(data)) as GuestInviteSessionPayload;
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
  let cookieValue: string | undefined;

  if (req) {
    const rawCookie = req.cookies?.get?.(GUEST_INVITE_COOKIE)?.value;
    if (rawCookie) {
      cookieValue = rawCookie;
    } else {
      const match = req.headers.get('cookie')?.split(';').find(c => c.trim().startsWith(`${GUEST_INVITE_COOKIE}=`));
      cookieValue = match ? match.trim().slice(GUEST_INVITE_COOKIE.length + 1) : undefined;
    }
  } else {
    try {
      const cookieStore = await cookies();
      cookieValue = cookieStore.get(GUEST_INVITE_COOKIE)?.value;
    } catch {
      cookieValue = undefined;
    }
  }

  if (!cookieValue) return null;

  return verifyGuestInviteSessionToken(cookieValue);
}
