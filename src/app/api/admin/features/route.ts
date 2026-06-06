import { NextResponse } from 'next/server';
import { contentService } from '@/features/content/service';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/utils/adminAuth.server';

export async function GET() {
  try {
    const features = await contentService.getFeatures();
    return NextResponse.json(features);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch features' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const isAdmin = await isAdminRequest();
    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    if (!body.features) {
      return NextResponse.json({ error: 'Features required' }, { status: 400 });
    }

    await contentService.updateFeatures(body.features);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update features' }, { status: 500 });
  }
}
