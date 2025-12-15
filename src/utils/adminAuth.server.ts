import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

const ADMIN_COOKIE = 'admin_auth';

// Use the admin password hash as the secret for signing tokens.
// In a real app, use a dedicated SESSION_SECRET environment variable.
const SECRET = process.env.ADMIN_PASSWORD || 'fallback-secret-for-dev';

interface AdminTokenPayload {
  isAdmin: boolean;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

/**
 * Creates a signed token string.
 * Format: payloadBase64.signatureBase64
 */
export function signAdminToken(payload: AdminTokenPayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(data)
    .digest('base64url');
  return `${data}.${signature}`;
}

/**
 * Verifies a signed token string.
 * Returns the payload if valid, or null if invalid.
 */
export function verifyAdminToken(token: string): AdminTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const [data, signature] = token.split('.');
  if (!data || !signature) return null;

  const expectedSignature = crypto
    .createHmac('sha256', SECRET)
    .update(data)
    .digest('base64url');

  const signatureBuffer = Buffer.from(signature, 'base64url');
  const expectedSignatureBuffer = Buffer.from(expectedSignature, 'base64url');

  // Prevent timing attacks using timingSafeEqual
  if (signatureBuffer.length !== expectedSignatureBuffer.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf-8')) as AdminTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Checks for the admin authentication cookie on the server-side.
 * This function is designed to work in different Next.js contexts:
 * - In API Routes (Edge or Node), it checks the `req.cookies`.
 * - In Server Components (App Router), it uses the `cookies()` function from `next/headers`.
 *
 * @param {NextRequest} [req] - The optional Next.js request object. If provided, the function assumes it's running in an API route context.
 * @returns {Promise<boolean>} A promise that resolves to true if the user is an admin, false otherwise.
 */
export async function isAdminRequest(req?: NextRequest): Promise<boolean> {
  let cookieValue: string | undefined;

  if (req) {
    // API Route (Edge or Node)
    cookieValue = req.cookies?.get?.(ADMIN_COOKIE)?.value ||
                  req.headers.get('cookie')?.split(';').find(c => c.trim().startsWith(`${ADMIN_COOKIE}=`))?.split('=')[1];
  } else {
    // Server Component (App Router)
    const cookieStore = await cookies();
    cookieValue = cookieStore.get(ADMIN_COOKIE)?.value;
  }

  if (!cookieValue) return false;

  const payload = verifyAdminToken(cookieValue);
  // Check if payload is valid and has isAdmin: true
  // We can also add expiration check here if we added 'exp' to payload
  return payload !== null && payload.isAdmin === true;
}
