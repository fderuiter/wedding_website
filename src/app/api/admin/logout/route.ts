import { NextResponse } from 'next/server';
import { env } from '@/env';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { DynamicSchema } from '@/utils/validation';

const ADMIN_COOKIE = 'admin_auth';

export const POST = withApiMiddleware(async () => {
  DynamicSchema.safeParse({});
  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_COOKIE, '', {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
});
