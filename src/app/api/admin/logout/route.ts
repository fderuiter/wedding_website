import { NextResponse } from 'next/server';

const ADMIN_COOKIE = 'admin_auth';

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
