/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('next/server', () => {
  class MockNextResponse {
    static json = jest.fn((body, init) => {
      const responseCookies = new Map();
      const headers = new Headers();
      if (init?.headers) {
        Object.entries(init.headers).forEach(([k, v]) => headers.set(k, v as string));
      }
      const cookies = {
        set: jest.fn((key, value, options) => {
          responseCookies.set(key, { name: key, value });
          let cookieString = `${key}=${value}; Path=/`;
          if (options?.expires) cookieString += `; Expires=${options.expires.toUTCString()}`;
          if (options?.maxAge === 0) cookieString += '; Max-Age=0';
          headers.set('set-cookie', cookieString);
        }),
        get: jest.fn((key) => responseCookies.get(key)),
        delete: jest.fn((key) => responseCookies.delete(key)),
      };
      return {
        status: init?.status || 200,
        headers: headers,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
        cookies: cookies,
      };
    });

    status: number;
    headers: Headers;
    bodyContent: string;

    constructor(body: string, init?: any) {
      this.bodyContent = body;
      this.status = init?.status || 200;
      this.headers = new Headers();
      if (init?.headers) {
        Object.entries(init.headers).forEach(([k, v]) => {
          this.headers.set(k, v as string);
        });
      }
    }

    json() {
      return Promise.resolve(JSON.parse(this.bodyContent));
    }

    text() {
      return Promise.resolve(this.bodyContent);
    }
  }

  const MockNextRequest = jest.fn((input, init) => {
    const requestCookies = new Map();
    if (init?.headers?.cookie) {
      init.headers.cookie.split(';').forEach((c: string) => {
        const [key, value] = c.trim().split('=');
        requestCookies.set(key, { name: key, value });
      });
    }
    const urlObj = new URL(input);
    return {
      ...init,
      url: input,
      nextUrl: urlObj,
      headers: {
        get: (key: string) => {
          if (!init?.headers) {
            if (key.toLowerCase() === 'host') return urlObj.host;
            return null;
          }
          const lKey = key.toLowerCase();
          const foundKey = Object.keys(init.headers).find((k) => k.toLowerCase() === lKey);
          if (foundKey) return init.headers[foundKey];
          if (lKey === 'host') return urlObj.host;
          return null;
        },
      },
      cookies: {
        get: jest.fn((key) => requestCookies.get(key)),
        set: jest.fn(),
      },
      json: () => Promise.resolve(init && init.body ? JSON.parse(init.body) : {}),
    };
  });

  return {
    NextResponse: MockNextResponse,
    NextRequest: MockNextRequest,
  };
});

jest.mock('@/lib/prisma', () => ({
  prisma: {
    seatingTable: {
      findMany: jest.fn(),
    },
    invitationCode: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

import { GET } from '../route';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/core/auth/auth.server';

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;

describe('Seating Export API Route (GET /api/admin/seating/export)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects unauthenticated requests with 401', async () => {
    mockIsAdminRequest.mockResolvedValue(false);

    const req = new NextRequest('http://localhost:3000/api/admin/seating/export');
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it('exports seating roster CSV with standard headers, ordering, and RFC 4180 escaping when authorized', async () => {
    mockIsAdminRequest.mockResolvedValue(true);

    mockPrisma.seatingTable.findMany.mockResolvedValue([
      {
        id: 't1',
        name: 'Table 1',
        shape: 'ROUND',
        capacity: 8,
        createdAt: new Date(),
        updatedAt: new Date(),
        invitationCodes: [
          {
            id: 'g1',
            guestName: 'Alice Smith',
            code: 'CODE1',
            seatNumber: 1,
            tableId: 't1',
            email: 'alice@example.com',
            dietaryNotes: null,
            plusOneAllocations: 0,
            plusOneCount: 0,
            isAttending: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'g2',
            guestName: 'Bob Jones, Jr.',
            code: 'CODE2',
            seatNumber: 2,
            tableId: 't1',
            email: 'bob@example.com',
            dietaryNotes: null,
            plusOneAllocations: 0,
            plusOneCount: 0,
            isAttending: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
      {
        id: 't2',
        name: 'Table 2 ("VIP")',
        shape: 'RECTANGLE',
        capacity: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
        invitationCodes: [],
      },
    ] as any);

    mockPrisma.invitationCode.findMany.mockResolvedValue([
      {
        id: 'g3',
        guestName: 'Charlie Brown',
        code: 'CODE3',
        seatNumber: null,
        tableId: null,
        email: 'charlie@example.com',
        dietaryNotes: null,
        plusOneAllocations: 0,
        plusOneCount: 0,
        isAttending: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/admin/seating/export');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment; filename="seating-roster-');

    const csvText = await res.text();
    const lines = csvText.trim().split('\n');

    expect(lines.length).toBe(5);
    expect(lines[0]).toBe('Table Name,Table Shape,Capacity,Seat Number,Guest Name,Invitation Code');
    expect(lines[1]).toBe('Table 1,ROUND,8,1,Alice Smith,CODE1');
    expect(lines[2]).toBe('Table 1,ROUND,8,2,"Bob Jones, Jr.",CODE2');
    expect(lines[3]).toBe('"Table 2 (""VIP"")",RECTANGLE,10,,(Unassigned Table),');
    expect(lines[4]).toBe('Unassigned,,,,Charlie Brown,CODE3');

    expect(mockPrisma.seatingTable.findMany).toHaveBeenCalledWith({
      include: {
        invitationCodes: {
          orderBy: { seatNumber: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    expect(mockPrisma.invitationCode.findMany).toHaveBeenCalledWith({
      where: { tableId: null },
      orderBy: { guestName: 'asc' },
    });
  });

  it('exports header-only CSV when database has no seating tables or unassigned guests', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    mockPrisma.seatingTable.findMany.mockResolvedValue([]);
    mockPrisma.invitationCode.findMany.mockResolvedValue([]);

    const req = new NextRequest('http://localhost:3000/api/admin/seating/export');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const csvText = await res.text();
    expect(csvText).toBe('Table Name,Table Shape,Capacity,Seat Number,Guest Name,Invitation Code\n');
  });
});
