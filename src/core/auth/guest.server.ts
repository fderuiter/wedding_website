import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { env } from '@/env';
import {
  base64urlEncode,
  base64urlDecode,
  base64urlDecodeToBytes,
  hmacSha256,
  timingSafeEqualJS,
} from '@/utils/crypto';

export const GUEST_COOKIE = 'guest_auth';

async function getSecret(): Promise<string> {
  return env.GUEST_PASSCODE;
}

interface GuestTokenPayload {
  guest: boolean;
  iat?: number;
  exp?: number;
}

export async function signGuestToken(payload: GuestTokenPayload): Promise<string> {
  const data = base64urlEncode(JSON.stringify(payload));
  const secret = await getSecret();
  if (!secret) {
    throw new Error('Guest auth secret is not configured');
  }
  const signature = await hmacSha256(secret, data);
  return `${data}.${signature}`;
}

async function verifyGuestToken(token: string): Promise<GuestTokenPayload | null> {
  try {
    if (!token || typeof token !== 'string') return null;
    const [data, signature] = token.split('.');
    if (!data || !signature) return null;

    const secret = await getSecret();
    if (!secret) return null;
    const expectedSignature = await hmacSha256(secret, data);

    const signatureBuffer = base64urlDecodeToBytes(signature);
    const expectedSignatureBuffer = base64urlDecodeToBytes(expectedSignature);

    if (!timingSafeEqualJS(signatureBuffer, expectedSignatureBuffer)) {
      return null;
    }

    return JSON.parse(base64urlDecode(data)) as GuestTokenPayload;
  } catch {
    return null;
  }
}

export async function isGuestRequest(req?: NextRequest): Promise<boolean> {
  let cookieValue: string | undefined;

  if (req) {
    const rawCookie = req.cookies?.get?.(GUEST_COOKIE)?.value;
    if (rawCookie) {
      cookieValue = rawCookie;
    } else {
      const match = req.headers.get('cookie')?.split(';').find(c => c.trim().startsWith(`${GUEST_COOKIE}=`));
      cookieValue = match ? match.trim().slice(GUEST_COOKIE.length + 1) : undefined;
    }
  } else {
    const cookieStore = await cookies();
    cookieValue = cookieStore.get(GUEST_COOKIE)?.value;
  }

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
