import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/utils/adminAuth';

export async function GET(req: NextRequest) {
  const isAdmin = await isAdminRequest(req);
  return NextResponse.json({ isAdmin });
}
