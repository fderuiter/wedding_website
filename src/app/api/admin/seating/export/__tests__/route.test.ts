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
        json: () => Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body),
        text: () =>
          Promise.resolve(
            typeof body === 'string'
              ? body
              : body instanceof Uint8Array || Buffer.isBuffer(body)
                ? Buffer.from(body).toString('utf-8')
                : JSON.stringify(body)
          ),
        cookies: cookies,
      };
    });

    status: number;
    headers: Headers;
    bodyContent: any;

    constructor(body: any, init?: any) {
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
      return Promise.resolve(typeof this.bodyContent === 'string' ? JSON.parse(this.bodyContent) : this.bodyContent);
    }

    text() {
      return Promise.resolve(
        typeof this.bodyContent === 'string'
          ? this.bodyContent
          : this.bodyContent instanceof Uint8Array || Buffer.isBuffer(this.bodyContent)
            ? Buffer.from(this.bodyContent).toString('utf-8')
            : JSON.stringify(this.bodyContent)
      );
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

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    partner1Name: 'Alex',
    partner2Name: 'Taylor',
    brideName: 'Alex',
    groomName: 'Taylor',
    weddingDate: '2026-06-20',
  }),
}));

import { GET } from '../route';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/core/auth/auth.server';

const mockPrisma = prisma as unknown as {
  seatingTable: {
    findMany: jest.Mock;
  };
  invitationCode: {
    findMany: jest.Mock;
  };
};
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
    expect(lines[0]).toBe('Table Name,Table Shape,Capacity,Seat Number,Guest Name,Invitation Code,Dietary Notes,Plus-One Name,Attendance,Meal Selections,Custom Answers');
    expect(lines[1]).toBe('Table 1,ROUND,8,1,Alice Smith,CODE1,,,Attending,,');
    expect(lines[2]).toBe('Table 1,ROUND,8,2,"Bob Jones, Jr.",CODE2,,,Attending,,');
    expect(lines[3]).toBe('"Table 2 (""VIP"")",RECTANGLE,10,,(Unassigned Table),,,,,,');
    expect(lines[4]).toBe('Unassigned,,,,Charlie Brown,CODE3,,,Pending,,');

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
    expect(csvText).toBe('Table Name,Table Shape,Capacity,Seat Number,Guest Name,Invitation Code,Dietary Notes,Plus-One Name,Attendance,Meal Selections,Custom Answers\n');
  });

  it('executes seatingTable and invitationCode database queries concurrently', async () => {
    mockIsAdminRequest.mockResolvedValue(true);

    let resolveTables!: (value: any) => void;
    let resolveGuests!: (value: any) => void;

    const tablesPromise = new Promise((resolve) => {
      resolveTables = resolve;
    });
    const guestsPromise = new Promise((resolve) => {
      resolveGuests = resolve;
    });

    mockPrisma.seatingTable.findMany.mockReturnValue(tablesPromise as any);
    mockPrisma.invitationCode.findMany.mockReturnValue(guestsPromise as any);

    const req = new NextRequest('http://localhost:3000/api/admin/seating/export');
    const responsePromise = GET(req);

    // Yield execution to allow middleware async steps (rateLimit, isAdminRequest) to complete
    await new Promise((resolve) => setImmediate(resolve));

    // Both findMany calls should be triggered concurrently before either promise resolves
    expect(mockPrisma.seatingTable.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.invitationCode.findMany).toHaveBeenCalledTimes(1);

    resolveTables([]);
    resolveGuests([]);

    const res = await responsePromise;
    expect(res.status).toBe(200);
  });

  it('exports vector PDF document when format=pdf is specified', async () => {
    mockIsAdminRequest.mockResolvedValue(true);

    mockPrisma.seatingTable.findMany.mockResolvedValue([
      {
        id: 't1',
        name: 'Head Table',
        shape: 'round',
        capacity: 8,
        x: 100,
        y: 100,
        width: 120,
        height: 120,
        rotation: 0,
        invitationCodes: [
          {
            id: 'g1',
            guestName: 'Jordan Lee',
            code: 'JL100',
            seatNumber: 1,
            dietaryNotes: 'Vegan',
          },
        ],
      },
    ] as any);

    mockPrisma.invitationCode.findMany.mockResolvedValue([
      {
        id: 'g2',
        guestName: 'Sam Rivera',
        code: 'SR200',
        seatNumber: null,
        tableId: null,
        dietaryNotes: null,
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/admin/seating/export?format=pdf');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('attachment; filename="seating-chart.pdf"');

    const pdfText = await res.text();
    expect(pdfText.startsWith('%PDF-')).toBe(true);
  });

  it('neutralizes formula injection trigger characters in CSV export fields', async () => {
    mockIsAdminRequest.mockResolvedValue(true);

    mockPrisma.seatingTable.findMany.mockResolvedValue([
      {
        id: 't-malicious',
        name: '=SUM(1+1)',
        shape: '+SHAPE',
        capacity: 10,
        invitationCodes: [
          {
            id: 'g-malicious-1',
            guestName: '=cmd|"/C calc"!A0',
            code: '-CODE100',
            seatNumber: 1,
          },
        ],
      },
    ] as any);

    mockPrisma.invitationCode.findMany.mockResolvedValue([
      {
        id: 'g-malicious-2',
        guestName: '@AdminUser',
        code: '\tTABCODE',
        seatNumber: null,
        tableId: null,
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/admin/seating/export');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const csvText = await res.text();
    const lines = csvText.trim().split('\n');

    expect(lines[0]).toBe('Table Name,Table Shape,Capacity,Seat Number,Guest Name,Invitation Code,Dietary Notes,Plus-One Name,Attendance,Meal Selections,Custom Answers');
    expect(lines[1]).toBe('\'=SUM(1+1),\'\+SHAPE,10,1,"\'=cmd|""/C calc""!A0",\'-CODE100,,,Pending,,');
    expect(lines[2]).toBe("Unassigned,,,,SingleQuoteAdmin,'\tTABCODE,,,Pending,,".replace('SingleQuoteAdmin', "'@AdminUser"));
  });

  it('serializes populated dietary notes and escapes special characters in CSV export', async () => {
    mockIsAdminRequest.mockResolvedValue(true);

    mockPrisma.seatingTable.findMany.mockResolvedValue([
      {
        id: 't1',
        name: 'Garden Terrace',
        shape: 'RECTANGLE',
        capacity: 6,
        invitationCodes: [
          {
            id: 'g1',
            guestName: 'Taylor Morgan',
            code: 'TM01',
            seatNumber: 1,
            tableId: 't1',
            dietaryNotes: 'Gluten-Free, Peanut Allergy',
          },
          {
            id: 'g2',
            guestName: 'Jordan Casey',
            code: 'JC02',
            seatNumber: 2,
            tableId: 't1',
            dietaryNotes: 'Strict "Vegan" Only',
          },
          {
            id: 'g3',
            guestName: 'Morgan Smith',
            code: 'MS03',
            seatNumber: 3,
            tableId: 't1',
            dietaryNotes: '',
          },
        ],
      },
      {
        id: 't2',
        name: 'Empty Table',
        shape: 'ROUND',
        capacity: 8,
        invitationCodes: [],
      },
    ] as any);

    mockPrisma.invitationCode.findMany.mockResolvedValue([
      {
        id: 'g4',
        guestName: 'Riley Reed',
        code: 'RR04',
        seatNumber: null,
        tableId: null,
        dietaryNotes: 'Shellfish Allergy',
      },
      {
        id: 'g5',
        guestName: 'Sam Dakota',
        code: 'SD05',
        seatNumber: null,
        tableId: null,
        dietaryNotes: null,
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/admin/seating/export');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const csvText = await res.text();
    const lines = csvText.trim().split('\n');

    expect(lines[0]).toBe('Table Name,Table Shape,Capacity,Seat Number,Guest Name,Invitation Code,Dietary Notes,Plus-One Name,Attendance,Meal Selections,Custom Answers');
    // Populated dietary notes with comma escaped in quotes
    expect(lines[1]).toBe('Garden Terrace,RECTANGLE,6,1,Taylor Morgan,TM01,"Gluten-Free, Peanut Allergy",,Pending,,');
    // Populated dietary notes with internal quotes escaped as ""
    expect(lines[2]).toBe('Garden Terrace,RECTANGLE,6,2,Jordan Casey,JC02,"Strict ""Vegan"" Only",,Pending,,');
    // Empty string dietary notes
    expect(lines[3]).toBe('Garden Terrace,RECTANGLE,6,3,Morgan Smith,MS03,,,Pending,,');
    // Empty table record
    expect(lines[4]).toBe('Empty Table,ROUND,8,,(Unassigned Table),,,,,,');
    // Unassigned guest with dietary notes
    expect(lines[5]).toBe('Unassigned,,,,Riley Reed,RR04,Shellfish Allergy,,Pending,,');
    // Unassigned guest with null dietary notes
    expect(lines[6]).toBe('Unassigned,,,,Sam Dakota,SD05,,,Pending,,');
  });

  it('excludes declined RSVPs and address-collection rows from CSV and PDF exports', async () => {
    mockIsAdminRequest.mockResolvedValue(true);

    mockPrisma.seatingTable.findMany.mockResolvedValue([
      {
        id: 't1',
        name: 'Table 1',
        shape: 'head',
        capacity: 4,
        x: 50,
        y: 50,
        width: 200,
        height: 80,
        rotation: 0,
        isSample: false,
        invitationCodes: [
          {
            id: 'g-seated-ok',
            guestName: 'Confirmed Seated',
            code: 'OK01',
            seatNumber: 1,
            tableId: 't1',
            used: true,
            extraFields: JSON.stringify({ attending: 'yes' }),
            partyTags: [],
            dietaryNotes: 'Vegan',
          },
          {
            id: 'g-seated-declined',
            guestName: 'Declined Seated',
            code: 'DEC01',
            seatNumber: 2,
            tableId: 't1',
            used: true,
            extraFields: JSON.stringify({ attending: 'no' }),
            partyTags: [],
            dietaryNotes: null,
          },
        ],
      },
    ] as any);

    mockPrisma.invitationCode.findMany.mockResolvedValue([
      {
        id: 'g-unassigned-ok',
        guestName: 'Pending Eligible',
        code: 'PEN01',
        seatNumber: null,
        tableId: null,
        used: false,
        extraFields: null,
        partyTags: [],
        dietaryNotes: null,
      },
      {
        id: 'g-unassigned-declined',
        guestName: 'Declined Unassigned',
        code: 'DEC02',
        seatNumber: null,
        tableId: null,
        used: true,
        extraFields: { attending: false },
        partyTags: [],
        dietaryNotes: null,
      },
      {
        id: 'g-address-only',
        guestName: 'Address Collector',
        code: 'ADDR01',
        seatNumber: null,
        tableId: null,
        used: false,
        extraFields: null,
        partyTags: ['address-collection'],
        dietaryNotes: null,
      },
    ] as any);

    const csvReq = new NextRequest('http://localhost:3000/api/admin/seating/export');
    const csvRes = await GET(csvReq);
    expect(csvRes.status).toBe(200);
    const csvText = await csvRes.text();

    expect(csvText).toContain('Confirmed Seated');
    expect(csvText).toContain('Pending Eligible');
    expect(csvText).not.toContain('Declined Seated');
    expect(csvText).not.toContain('Declined Unassigned');
    expect(csvText).not.toContain('Address Collector');

    const pdfReq = new NextRequest('http://localhost:3000/api/admin/seating/export?format=pdf');
    const pdfRes = await GET(pdfReq);
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get('content-type')).toBe('application/pdf');
  });

  it('includes synced plus-one names, attendance statuses, entrée selections, and custom answers in seating CSV export', async () => {
    mockIsAdminRequest.mockResolvedValue(true);

    mockPrisma.seatingTable.findMany.mockResolvedValue([
      {
        id: 't-main',
        name: 'Table 1',
        shape: 'ROUND',
        capacity: 8,
        invitationCodes: [
          {
            id: 'g-1',
            guestName: 'Jane Doe',
            code: 'JANE26',
            seatNumber: 1,
            tableId: 't-main',
            dietaryNotes: 'No shellfish',
            used: true,
            extraFields: {
              attendanceStatus: 'attending',
              plusOneNames: ['John Doe'],
              mealSummary: 'Jane Doe: Herb Salmon (gluten-free); John Doe: Short Rib',
              customAnswersSummary: 'Shuttle?: Yes',
            },
          },
        ],
      },
    ] as any);
    mockPrisma.invitationCode.findMany.mockResolvedValue([]);

    const req = new NextRequest('http://localhost:3000/api/admin/seating/export');
    const res = await GET(req);
    const lines = (await res.text()).trim().split('\n');

    expect(lines[1]).toBe(
      'Table 1,ROUND,8,1,Jane Doe,JANE26,No shellfish,John Doe,Attending,Jane Doe: Herb Salmon (gluten-free); John Doe: Short Rib,Shuttle?: Yes'
    );
  });
});
