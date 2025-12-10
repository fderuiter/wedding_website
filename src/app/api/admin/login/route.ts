import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';

const ADMIN_COOKIE = 'admin_auth';

/**
 * @api {post} /api/admin/login
 * @description Handles admin login.
 *
 * This function processes a POST request to log in an administrator. It validates the
 * provided password against the `ADMIN_PASSWORD` environment variable. If the password
 * is correct, it sets a secure, HTTP-only cookie to authenticate subsequent admin requests.
 *
 * @param {NextRequest} req - The incoming Next.js request object, containing the password in the JSON body.
 * @returns {Promise<NextResponse>} A promise that resolves to a `NextResponse` object.
 * On success, it returns a JSON object with `success: true` and sets the auth cookie.
 * On failure (e.g., wrong password, server misconfiguration), it returns an appropriate
 * error message and status code.
 */
export async function POST(req: NextRequest) {
  const { password } = await req.json();
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return NextResponse.json({ error: 'Admin password not set.' }, { status: 500 });
  }

  // Input validation: ensure password is a string
  if (typeof password !== 'string') {
    return NextResponse.json({ error: 'Invalid password format.' }, { status: 400 });
  }

  // Prevent timing attacks by using constant-time comparison
  const inputHash = createHash('sha256').update(password).digest();
  const targetHash = createHash('sha256').update(adminPassword).digest();

  if (!timingSafeEqual(inputHash, targetHash)) {
    return NextResponse.json({ error: 'Invalid password.' }, { status: 401 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_COOKIE, 'true', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8, // 8 hours
  });
  return response;
}
