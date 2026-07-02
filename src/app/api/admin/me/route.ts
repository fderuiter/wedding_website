import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/core/auth/auth.server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';

export const GET = withApiMiddleware(async (req: NextRequest) => {
  const isAdmin = await isAdminRequest(req);
  return NextResponse.json({ success: true, isAdmin });
});
