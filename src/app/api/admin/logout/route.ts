import { NextResponse } from 'next/server';
import { setAdminAuthCookie } from '@/core/auth/auth.server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { AdminLogoutSchema } from '@/utils/validation';

export const POST = withApiMiddleware(async () => {
  AdminLogoutSchema.safeParse({});
  const response = NextResponse.json({ success: true });
  setAdminAuthCookie(response, '', 0);
  return response;
});
