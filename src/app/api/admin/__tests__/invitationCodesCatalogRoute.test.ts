/** @jest-environment node */

jest.unmock('@prisma/client');
jest.unmock('@prisma/adapter-pg');
jest.unmock('pg');
jest.unmock('@/lib/prisma');

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { GET } from '../invitation-codes/catalog/route';
import { isAdminRequest } from '@/core/auth/auth.server';

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;

describe('GET /api/admin/invitation-codes/catalog', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(true);
    await prisma.$transaction([
      prisma.subEventRsvp.deleteMany(),
      prisma.subEventAccess.deleteMany(),
      prisma.subEvent.deleteMany(),
      prisma.invitationCode.deleteMany(),
    ]);
  });

  afterAll(async () => {
    await prisma.$transaction([
      prisma.subEventRsvp.deleteMany(),
      prisma.subEventAccess.deleteMany(),
      prisma.subEvent.deleteMany(),
      prisma.invitationCode.deleteMany(),
    ]);
    await prisma.$disconnect();
  });

  it('returns 401 when request is unauthorized', async () => {
    mockIsAdminRequest.mockResolvedValue(false);
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/catalog?limit=1000');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 when limit exceeds INVITATION_MAX_CATALOG_LIMIT (1000)', async () => {
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/catalog?limit=1001');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns all 250 imported invitations with subEventRsvps and pagination headers without 50-row truncation', async () => {
    const ceremony = await prisma.subEvent.create({
      data: {
        title: 'Main Ceremony',
        isPrivate: false,
      },
    });

    await prisma.invitationCode.createMany({
      data: Array.from({ length: 250 }, (_, idx) => {
        const num = String(idx + 1).padStart(3, '0');
        return {
          id: `inv-cat-${num}`,
          code: `CAT${num}`,
          guestName: idx === 249 ? 'Zelda Zorro' : `Guest ${num}`,
          email: `guest${num}@example.com`,
          householdName: `Household ${num}`,
          used: idx % 2 === 0,
        };
      }),
    });

    await prisma.subEventRsvp.create({
      data: {
        subEventId: ceremony.id,
        invitationCodeId: 'inv-cat-250',
        status: 'attending',
        plusOneCount: 2,
        dietaryNotes: 'Nut allergy',
      },
    });

    const req = new NextRequest('http://localhost/api/admin/invitation-codes/catalog?limit=1000');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('X-Total-Count')).toBe('250');
    expect(res.headers.get('X-Limit')).toBe('1000');
    expect(res.headers.get('X-Page')).toBe('1');
    expect(res.headers.get('X-Total-Pages')).toBe('1');

    const payload = await res.json();
    expect(payload.success).toBe(true);
    const body = payload.data;
    expect(body.total).toBe(250);
    expect(body.items).toHaveLength(250);

    const zelda = body.items.find((item: { id: string }) => item.id === 'inv-cat-250');
    expect(zelda).toBeDefined();
    expect(zelda.guestName).toBe('Zelda Zorro');
    expect(zelda.subEventRsvps).toEqual([
      expect.objectContaining({
        subEventId: ceremony.id,
        status: 'attending',
        plusOneCount: 2,
        dietaryNotes: 'Nut allergy',
      }),
    ]);

    // Search filter across catalog
    const searchReq = new NextRequest(
      'http://localhost/api/admin/invitation-codes/catalog?limit=1000&search=Zelda'
    );
    const searchRes = await GET(searchReq);
    const searchPayload = await searchRes.json();
    expect(searchPayload.success).toBe(true);
    const searchBody = searchPayload.data;
    expect(searchBody.total).toBe(1);
    expect(searchBody.items).toHaveLength(1);
    expect(searchBody.items[0].guestName).toBe('Zelda Zorro');
  });
});
