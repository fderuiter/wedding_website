import { NextResponse } from 'next/server';

const ADMIN_COOKIE = 'admin_auth';

/**
 * @api {post} /api/admin/logout
 * @description Handles admin logout.
 *
 * This function processes a POST request to log out an administrator. It clears the
 * `admin_auth` cookie by setting its `maxAge` to 0, effectively ending the admin session.
 *
 * @returns {Promise<NextResponse>} A promise that resolves to a `NextResponse` object
 * with a JSON body `success: true` and instructions to clear the authentication cookie.
 */
export async function POST() {
  // Clear the admin_auth cookie
  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
