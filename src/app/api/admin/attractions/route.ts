import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/utils/adminAuth.server';
import { coordinateSchema } from '@/utils/validation';

export async function GET() {
  try {
    const attractions = await prisma.attraction.findMany();
    return NextResponse.json(attractions);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const data = await req.json();

    const parsedLat = coordinateSchema.safeParse(data.latitude || 0);
    const parsedLon = coordinateSchema.safeParse(data.longitude || 0);

    if (!parsedLat.success || !parsedLon.success) {
      return NextResponse.json({ 
        error: 'Invalid coordinate format. Must be a numeric value or a placeholder.' 
      }, { status: 400 });
    }

    const attraction = await prisma.attraction.create({
      data: {
        name: data.name,
        description: data.description,
        image: data.image,
        category: data.category,
        website: data.website,
        directions: data.directions,
        latitude: parsedLat.data,
        longitude: parsedLon.data,
        isVisible: data.isVisible !== false,
      }
    });

    await prisma.snapshotVersion.create({
      data: {
        entityType: 'Attraction',
        entityId: attraction.id,
        data: attraction as any,
        author: 'Admin',
      }
    });

    return NextResponse.json(attraction);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
