import { NextResponse } from 'next/server';
import { contentService } from '@/features/content/service';
import { cookies } from 'next/headers';
import bcrypt from 'bcrypt';
import { prisma } from '@/lib/prisma';

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
    const cookieStore = await cookies();
    const adminToken = cookieStore.get('admin_token')?.value;

    if (!adminToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const config = await prisma.appConfig.findUnique({ where: { id: 'global' } });
    if (!config) {
      return NextResponse.json({ error: 'Config not found' }, { status: 500 });
    }

    const isMatch = await bcrypt.compare(config.adminPassword, adminToken);
    if (!isMatch) {
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
