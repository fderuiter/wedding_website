import { NextRequest, NextResponse } from 'next/server';
import { incrementAdminTokenVersion } from '@/core/auth/adminTokenVersion.node';
import { isAdminRequest, setAdminAuthCookie } from '@/core/auth/auth.server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { AdminLogoutSchema } from '@/utils/validation';

export const POST = withApiMiddleware(async (req?: NextRequest) => {
  AdminLogoutSchema.safeParse({});
  const wasAuthenticated = req ? await isAdminRequest(req) : false;

  if (wasAuthenticated) {
    await incrementAdminTokenVersion(req);
  }

  const response = NextResponse.json({ success: true });
  setAdminAuthCookie(response, '', 0, req);
  return response;
});
