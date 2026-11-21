import { NextRequest, NextResponse } from 'next/server';
import { isActiveAdminSession } from '@/core/auth/nodeSessionGuards';
import { withApiMiddleware } from '@/utils/withApiMiddleware';

export const GET = withApiMiddleware(async (req: NextRequest) => {
  const isAdmin = await isActiveAdminSession(req);
  return NextResponse.json({ success: true, isAdmin });
});
