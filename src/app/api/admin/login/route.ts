import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { signAdminToken } from '@/utils/adminAuth.server';
import { rateLimit } from '@/utils/rateLimit';
import { env } from '@/env';

const ADMIN_COOKIE = 'admin_auth';

/**
 * Authenticate an administrator and set an HTTP-only admin auth cookie.
 *
 * @param req - Incoming Next.js request whose JSON body must include a `password` string.
 * @returns A NextResponse: on success contains `{ success: true }` and sets the `admin_auth` cookie; on failure contains an `{ error: string }` with an appropriate 4xx/5xx status.
 */
export async function POST(req: NextRequest) {
  // Apply rate limiting: max 5 requests per 15 minutes per IP
  const rateLimitResponse = await rateLimit(req, 5, 15 * 60 * 1000);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const { password } = await req.json();
  const adminPassword = env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return NextResponse.json({ error: 'Admin password not set.' }, { status: 500 });
  }

  // Input validation: ensure password is a string
  if (typeof password !== 'string') {
    return NextResponse.json({ error: 'Invalid password format.' }, { status: 400 });
  }

  // Compare password using secure password hashing (bcrypt)
  const isMatch = await bcrypt.compare(password, adminPassword);

  if (!isMatch) {
    return NextResponse.json({ error: 'Invalid password.' }, { status: 401 });
  }

  // Generate signed token with expiration
  const iat = Date.now();
  const exp = iat + 60 * 60 * 8 * 1000; // 8 hours
  const token = await signAdminToken({ isAdmin: true, iat, exp });

  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8, // 8 hours
  });
  return response;
}
