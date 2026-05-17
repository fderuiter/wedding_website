import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { signAdminToken } from '@/utils/adminAuth.server';
import { checkRateLimit } from '@/utils/rateLimit';

const ADMIN_COOKIE = 'admin_auth';
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

/**
 * @api {post} /api/admin/login
 * @description Handles admin login.
 *
 * This function processes a POST request to log in an administrator. It validates the
 * provided password against the `ADMIN_PASSWORD` environment variable, which must now
 * contain a bcrypt hash of the password.
 *
 * @param {NextRequest} req - The incoming Next.js request object, containing the password in the JSON body.
 * @returns {Promise<NextResponse>} A promise that resolves to a `NextResponse` object.
 * On success, it returns a JSON object with `success: true` and sets the auth cookie.
 * On failure (e.g., wrong password, server misconfiguration), it returns an appropriate
 * error message and status code.
 */
export async function POST(req: NextRequest) {
  // Rate limiting to prevent brute-force attacks
  // Prefer req.ip which is set securely by Next.js if the server is properly configured behind a proxy.
  // Fallback to x-forwarded-for ONLY if we must, though it is spoofable.
  const ip = req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
  const isAllowed = checkRateLimit(ip, MAX_LOGIN_ATTEMPTS, LOGIN_RATE_LIMIT_WINDOW_MS);

  if (!isAllowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Please try again later.' },
      { status: 429 }
    );
  }

  const { password } = await req.json();
  const adminPassword = process.env.ADMIN_PASSWORD;

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
  const token = signAdminToken({ isAdmin: true, iat, exp });

  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8, // 8 hours
  });
  return response;
}
