import { AdminLoginSchema } from "@/utils/validation";
import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword } from '@/utils/password';
import { signAdminToken } from '@/utils/adminAuth.server';
import { env } from '@/env';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';

const ADMIN_COOKIE = 'admin_auth';

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const body = await req.json();
  const parseResult = AdminLoginSchema.safeParse(body);
  
  if (!parseResult.success) {
    throw new ApiError(400, parseResult.error.issues[0].message);
  }

  const { password } = parseResult.data;
  
  const adminPassword = env.ADMIN_PASSWORD;

  if (!adminPassword) {
    throw new ApiError(500, 'Admin password not set.');
  }

  const isMatch = await verifyPassword(password, adminPassword);

  if (!isMatch) {
    throw new ApiError(401, 'Invalid password.');
  }

  const iat = Date.now();
  const exp = iat + 60 * 60 * 8 * 1000;
  const token = await signAdminToken({ isAdmin: true, iat, exp });

  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8,
  });
  return response;
});
