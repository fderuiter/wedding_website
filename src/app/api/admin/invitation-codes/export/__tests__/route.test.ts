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
      return {
        status: init?.status || 200,
        headers: headers,
        json: () => Promise.resolve(typeof body === 'string' ? JSON.parse(body) : body),
        text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
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

describe('Invitation Codes Export API Route (GET /api/admin/invitation-codes/export)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects unauthenticated requests with HTTP 401 Unauthorized', async () => {
    mockIsAdminRequest.mockResolvedValue(false);

    const req = new NextRequest('http://localhost:3000/api/admin/invitation-codes/export');
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it('returns 200 OK with complete CSV payload and headers when authorized', async () => {
    mockIsAdminRequest.mockResolvedValue(true);

    mockPrisma.invitationCode.findMany.mockResolvedValue([
      {
        id: 'ic-1',
        guestName: 'Jane Doe',
        code: 'JANE2026',
        email: 'jane@example.com',
        plusOneFirstName: 'John',
        plusOneLastName: 'Doe',
        householdName: 'Doe Family',
        partyGroup: 'Bride',
        partyTags: ['VIP', 'Rehearsal'],
        addressLine1: '123 Main St',
        addressLine2: 'Apt 4B',
        city: 'San Francisco',
        state: 'CA',
        zipCode: '94102',
        country: 'USA',
        dietaryNotes: 'Vegetarian',
        plusOneAllocations: 1,
        used: false,
        extraFields: { phone: '+15551234567', mobile: '+15551234567' },
      },
      {
        id: 'ic-2',
        guestName: 'Bob "The Builder" Smith',
        code: 'BOB2026',
        email: 'bob@example.com',
        plusOneFirstName: null,
        plusOneLastName: null,
        householdName: 'Smiths',
        partyGroup: 'Groom',
        partyTags: ['Local'],
        addressLine1: '456 Oak Rd',
        addressLine2: null,
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
        country: 'USA',
        dietaryNotes: 'Gluten-Free, Dairy-Free',
        plusOneAllocations: 0,
        used: true,
        extraFields: null,
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/admin/invitation-codes/export');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment; filename="invitation-codes-');

    const csvText = await res.text();
    const lines = csvText.trim().split('\n');

    expect(lines[0]).toBe('Guest Name,Invitation Code,RSVP Link,Email,Phone Number,Plus-One Name,Household Name,Party Group,Party Tags,Address,Dietary Notes,Plus Ones,Status');
    expect(lines[1]).toBe('Jane Doe,JANE2026,http://localhost:3000/guest?code=JANE2026,jane@example.com,\'+15551234567,John Doe,Doe Family,Bride,"VIP, Rehearsal","123 Main St, Apt 4B, San Francisco, CA, 94102, USA",Vegetarian,1,Unused');
    expect(lines[2]).toBe('"Bob ""The Builder"" Smith",BOB2026,http://localhost:3000/guest?code=BOB2026,bob@example.com,,,Smiths,Groom,Local,"456 Oak Rd, Austin, TX, 78701, USA","Gluten-Free, Dairy-Free",0,Redeemed');
  });

  it('correctly parses phone numbers from stringified JSON, mobile/phoneNumber aliases, and handles malformed extraFields', async () => {
    mockIsAdminRequest.mockResolvedValue(true);

    mockPrisma.invitationCode.findMany.mockResolvedValue([
      {
        id: 'ic-serialized',
        guestName: 'Serialized Phone Guest',
        code: 'SER2026',
        email: 'ser@example.com',
        extraFields: JSON.stringify({ phone: '+1 (555) 987-6543' }),
      },
      {
        id: 'ic-mobile',
        guestName: 'Mobile Only Guest',
        code: 'MOB2026',
        email: 'mob@example.com',
        extraFields: { mobile: '+15553334444' },
      },
      {
        id: 'ic-phone-number',
        guestName: 'PhoneNumber Key Guest',
        code: 'PN2026',
        email: 'pn@example.com',
        extraFields: { phoneNumber: '+15554445555' },
      },
      {
        id: 'ic-malformed',
        guestName: 'Malformed JSON Guest',
        code: 'MAL2026',
        email: 'mal@example.com',
        extraFields: '{invalid-json',
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/admin/invitation-codes/export');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const csvText = await res.text();
    const lines = csvText.trim().split('\n');

    expect(lines[1]).toContain('Serialized Phone Guest,SER2026,http://localhost:3000/guest?code=SER2026,ser@example.com,\'+1 (555) 987-6543');
    expect(lines[2]).toContain('Mobile Only Guest,MOB2026,http://localhost:3000/guest?code=MOB2026,mob@example.com,\'+15553334444');
    expect(lines[3]).toContain('PhoneNumber Key Guest,PN2026,http://localhost:3000/guest?code=PN2026,pn@example.com,\'+15554445555');
    expect(lines[4]).toContain('Malformed JSON Guest,MAL2026,http://localhost:3000/guest?code=MAL2026,mal@example.com,,');
  });

  it('passes search, status, partyGroup, partyTags, and household filters to Prisma', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    mockPrisma.invitationCode.findMany.mockResolvedValue([]);

    const req = new NextRequest(
      'http://localhost:3000/api/admin/invitation-codes/export?search=Smith&status=unused&partyGroup=Groom&partyTags=VIP&household=Smiths'
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockPrisma.invitationCode.findMany).toHaveBeenCalledWith({
      where: {
        used: false,
        householdName: { contains: 'Smiths', mode: 'insensitive' },
        partyGroup: { equals: 'Groom', mode: 'insensitive' },
        partyTags: { hasSome: ['VIP'] },
        OR: [
          { guestName: { contains: 'Smith', mode: 'insensitive' } },
          { code: { contains: 'Smith', mode: 'insensitive' } },
          { email: { contains: 'Smith', mode: 'insensitive' } },
          { householdName: { contains: 'Smith', mode: 'insensitive' } },
          { partyGroup: { contains: 'Smith', mode: 'insensitive' } },
          { plusOneFirstName: { contains: 'Smith', mode: 'insensitive' } },
          { plusOneLastName: { contains: 'Smith', mode: 'insensitive' } },
          { partyTags: { has: 'Smith' } },
        ],
      },
      orderBy: { guestName: 'asc' },
    });
  });

  it('filters by comma-separated list of IDs when ids query parameter is passed', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    mockPrisma.invitationCode.findMany.mockResolvedValue([]);

    const req = new NextRequest('http://localhost:3000/api/admin/invitation-codes/export?ids=id1,id2,id3');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockPrisma.invitationCode.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['id1', 'id2', 'id3'] },
      },
      orderBy: { guestName: 'asc' },
    });
  });

  it('neutralizes formula injection characters in invitation codes CSV export fields', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    mockPrisma.invitationCode.findMany.mockResolvedValue([
      {
        id: 'code-1',
        guestName: '=HYPERLINK("http://attacker.com")',
        code: '+INVITE1',
        email: '-admin@example.com',
        plusOneFirstName: '@Malicious',
        plusOneLastName: 'Companion',
        householdName: '\tHousehold',
        partyGroup: '\rGroup',
        partyTags: ['=Tag1', 'Tag2'],
        addressLine1: '-10 Downing St',
        addressLine2: null,
        city: 'London',
        state: null,
        zipCode: '+12345',
        country: 'UK',
        dietaryNotes: '=ALERT(1)',
        plusOneAllocations: 1,
        used: false,
        extraFields: null,
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/admin/invitation-codes/export');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const csvText = await res.text();
    const lines = csvText.trim().split('\n');

    expect(lines[0]).toBe('Guest Name,Invitation Code,RSVP Link,Email,Phone Number,Plus-One Name,Household Name,Party Group,Party Tags,Address,Dietary Notes,Plus Ones,Status');
    expect(lines[1]).toContain('"\'=HYPERLINK(""http://attacker.com"")"');
    expect(lines[1]).toContain('\'+INVITE1');
    expect(lines[1]).toContain('\'-admin@example.com');
    expect(lines[1]).toContain('\'@Malicious Companion');
    expect(lines[1]).toContain('\'\tHousehold');
    expect(lines[1]).toContain('"\'\rGroup"');
    expect(lines[1]).toContain('"\'=Tag1, Tag2"');
    expect(lines[1]).toContain('\'=ALERT(1)');
  });
});
