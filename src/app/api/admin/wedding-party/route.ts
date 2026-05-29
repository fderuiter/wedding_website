import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/utils/adminAuth.server';

export async function GET() {
  try {
    const members = await prisma.weddingPartyMember.findMany({
      orderBy: { order: 'asc' },
    });
    return NextResponse.json(members);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const data = await req.json();
    const member = await prisma.weddingPartyMember.create({
      data: {
        name: data.name,
        role: data.role,
        bio: data.bio,
        photo: data.photo,
        link: data.link,
        order: data.order,
      }
    });

    await prisma.snapshotVersion.create({
      data: {
        entityType: 'WeddingPartyMember',
        entityId: member.id,
        data: member as any,
        author: 'Admin',
      }
    });

    return NextResponse.json(member);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
