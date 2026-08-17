import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { env } from '@/env';

export const GUEST_COOKIE = 'guest_auth';

async function getSecret(): Promise<string> {
  return env.GUEST_PASSCODE;
}

interface GuestTokenPayload {
  guest: boolean;
  iat?: number;
  exp?: number;
}

function base64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return base64urlEncodeBytes(bytes);
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

export async function signGuestToken(payload: GuestTokenPayload): Promise<string> {
  const data = base64urlEncode(JSON.stringify(payload));
  const secret = await getSecret();
  if (!secret) {
    throw new Error('Guest auth secret is not configured');
  }
  const signature = await hmacSha256(secret, data);
  return `${data}.${signature}`;
}

export async function verifyGuestToken(token: string): Promise<GuestTokenPayload | null> {
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
    cookieValue = req.cookies?.get?.(GUEST_COOKIE)?.value ||
                  req.headers.get('cookie')?.split(';').find(c => c.trim().startsWith(`${GUEST_COOKIE}=`))?.split('=')[1];
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
