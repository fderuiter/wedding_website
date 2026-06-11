import { NextRequest, NextResponse } from 'next/server';
import { getAppConfig, toPublicAppConfig } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/utils/adminAuth.server';
import { revalidatePath } from 'next/cache';
import { coordinateSchema } from '@/utils/validation';

/**
 * Return the public application configuration for authorized admin requests.
 *
 * @returns A JSON HTTP response containing the public app configuration when the requester is an admin; otherwise a 401 JSON response `{ error: 'Unauthorized' }`.
 */
export async function GET(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = await getAppConfig();
  return NextResponse.json(toPublicAppConfig(config));
}

/**
 * Update the global application configuration from the request body and return its public representation.
 *
 * @param req - Incoming request whose JSON body contains app configuration fields to update (e.g., names, venue info, coordinates, theme colors, SEO and hero content).
 * @returns The updated application configuration in its public shape.
 */
export async function PUT(req: NextRequest) {
  if (!(await isAdminRequest(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await req.json();

    const parsedLat = coordinateSchema.safeParse(data.latitude);
    const parsedLon = coordinateSchema.safeParse(data.longitude);

    if (!parsedLat.success || !parsedLon.success) {
      return NextResponse.json({ 
        error: 'Invalid coordinate format. Must be a numeric value or a placeholder.' 
      }, { status: 400 });
    }

    // Data validation could go here
    const HEX = /^#([0-9a-fA-F]{6})$/;
    const safeColor = (v: unknown, fallback: string) =>
      typeof v === 'string' && HEX.test(v) ? v : fallback;
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
        latitude: parsedLat.data,
        longitude: parsedLon.data,
        storyText: data.storyText,
        venueDescription: data.venueDescription,
        travelAdvice: data.travelAdvice,
        heroTitle: data.heroTitle,
        heroSubtitle: data.heroSubtitle,
        seoTitle: data.seoTitle,
        seoDescription: data.seoDescription,
        faviconUrl: data.faviconUrl,
        ogImageUrl: data.ogImageUrl,
        seoKeywords: data.seoKeywords,
        themePrimary: safeColor(data.themePrimary, '#f43f5e'),
        themeSecondary: safeColor(data.themeSecondary, '#fbbf24'),
        themeAccent: safeColor(data.themeAccent, '#e11d48'),
      },
    });

    // Create a version snapshot
    await prisma.snapshotVersion.create({
      data: {
        entityType: 'AppConfig',
        entityId: 'global',
        data: updatedConfig as any,
        author: 'Admin', // In a real app we'd get the actual user from auth
      }
    });
    
    // Prune old versions (keep max 50)
    const versions = await prisma.snapshotVersion.findMany({
      where: { entityType: 'AppConfig', entityId: 'global' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (versions.length > 50) {
      const idsToDelete = versions.slice(50).map(v => v.id);
      await prisma.snapshotVersion.deleteMany({
        where: { id: { in: idsToDelete } }
      });
    }

    revalidatePath('/', 'layout');

    return NextResponse.json(toPublicAppConfig(updatedConfig));
  } catch (err) {
    console.error('Failed to update config:', err);
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 });
  }
}
