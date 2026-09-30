import { NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';

export const GET = withApiMiddleware(async () => {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});
