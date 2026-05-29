import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/utils/adminAuth.server';

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
    const attraction = await prisma.attraction.create({
      data: {
        name: data.name,
        description: data.description,
        image: data.image,
        category: data.category,
        website: data.website,
        directions: data.directions,
        latitude: parseFloat(data.latitude || 0),
        longitude: parseFloat(data.longitude || 0),
        isVisible: data.isVisible !== false,
      }
    });
    return NextResponse.json(attraction);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
