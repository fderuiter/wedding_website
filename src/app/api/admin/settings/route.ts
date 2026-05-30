import { NextRequest, NextResponse } from 'next/server';
import { getAppConfig } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { verifyAdminToken } from '@/utils/adminAuth.server';

export async function GET(req: NextRequest) {
  const token = req.cookies.get('admin_auth')?.value;
  if (!token || !verifyAdminToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = await getAppConfig();
  return NextResponse.json(config);
}

export async function PUT(req: NextRequest) {
  const token = req.cookies.get('admin_auth')?.value;
  if (!token || !verifyAdminToken(token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await req.json();

    // Data validation could go here
    const updatedConfig = await prisma.appConfig.update({
      where: { id: 'global' },
      data: {
        brideName: data.brideName,
        groomName: data.groomName,
        weddingDate: new Date(data.weddingDate),
        baseUrl: data.baseUrl,
        venueName: data.venueName,
        venueAddress: data.venueAddress,
        venueCity: data.venueCity,
        venueState: data.venueState,
        venueZip: data.venueZip,
        latitude: parseFloat(data.latitude),
        longitude: parseFloat(data.longitude),
        storyText: data.storyText,
        venueDescription: data.venueDescription,
        travelAdvice: data.travelAdvice,
        heroTitle: data.heroTitle,
        heroSubtitle: data.heroSubtitle,
        seoTitle: data.seoTitle,
        seoDescription: data.seoDescription,
        features: data.features,
      },
    });

    return NextResponse.json(updatedConfig);
  } catch (err) {
    console.error('Failed to update config:', err);
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
  }
}
