import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/features/admin/auth.server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';

export const GET = withApiMiddleware(async (_req: NextRequest) => {
  const isAdmin = await isAdminRequest(req);
  return NextResponse.json({ success: true, isAdmin });
});
