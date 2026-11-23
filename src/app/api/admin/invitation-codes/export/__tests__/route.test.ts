/** @jest-environment node */

import { NextRequest } from 'next/server';

jest.mock('next/server', () => {
  class MockNextResponse {
    static json = jest.fn((body, init) => {
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
import { parseCsvContent, validateSingleCsvRow } from '@/utils/csv';
import { formatGuestPlusOneNames, isAddressComplete } from '@/features/registry';
import { getGuestPhone } from '@/features/broadcast';

const mockPrisma = prisma as unknown as {
  invitationCode: {
    findMany: jest.Mock;
  };
};
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

    expect(lines[0]).toBe('Guest Name,Invitation Code,RSVP Link,Email,Phone Number,Plus-One Name,Household Name,Party Group,Party Tags,Address Line 1,Address Line 2,City,State,ZIP Code,Country,Dietary Notes,Plus Ones,Status,Attendance,Meal Selections,Custom Answers');
    expect(lines[1]).toBe('Jane Doe,JANE2026,http://localhost:3000/guest?code=JANE2026,jane@example.com,\'+15551234567,John Doe,Doe Family,Bride,"VIP, Rehearsal",123 Main St,Apt 4B,San Francisco,CA,94102,USA,Vegetarian,1,Unused,Pending,,');
    expect(lines[2]).toBe('"Bob ""The Builder"" Smith",BOB2026,http://localhost:3000/guest?code=BOB2026,bob@example.com,,,Smiths,Groom,Local,456 Oak Rd,,Austin,TX,78701,USA,"Gluten-Free, Dairy-Free",0,Redeemed,Attending,,');
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

    expect(lines[0]).toBe('Guest Name,Invitation Code,RSVP Link,Email,Phone Number,Plus-One Name,Household Name,Party Group,Party Tags,Address Line 1,Address Line 2,City,State,ZIP Code,Country,Dietary Notes,Plus Ones,Status,Attendance,Meal Selections,Custom Answers');
    expect(lines[1]).toContain('"\'=HYPERLINK(""http://attacker.com"")"');
    expect(lines[1]).toContain('\'+INVITE1');
    expect(lines[1]).toContain('\'-admin@example.com');
    expect(lines[1]).toContain('\'@Malicious Companion');
    expect(lines[1]).toContain('\'\tHousehold');
    expect(lines[1]).toContain('"\'\rGroup"');
    expect(lines[1]).toContain('"\'=Tag1, Tag2"');
    expect(lines[1]).toContain('\'=ALERT(1)');
  });

  it('filters by structured meal dietary tags and exports synced attendance, plus-one names, meal selections, and custom answers', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    mockPrisma.invitationCode.findMany.mockResolvedValue([
      {
        id: 'ic-vegan',
        guestName: 'Clara Oswald',
        code: 'CLARA26',
        email: 'clara@example.com',
        dietaryNotes: null,
        plusOneAllocations: 1,
        used: true,
        extraFields: {
          attendanceStatus: 'attending',
          plusOneNames: ['Danny Pink'],
          dietaryTags: ['vegan'],
          mealSummary: 'Clara Oswald: Truffle Gnocchi (vegan); Danny Pink: Herb Salmon (gluten-free)',
          customAnswersSummary: 'Hotel shuttle?: Yes, round-trip',
        },
      },
      {
        id: 'ic-declined',
        guestName: 'Rory Williams',
        code: 'RORY26',
        email: 'rory@example.com',
        dietaryNotes: null,
        plusOneAllocations: 0,
        used: true,
        extraFields: {
          attendanceStatus: 'declined',
          dietaryTags: [],
        },
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/admin/invitation-codes/export?dietary=vegan');
    const res = await GET(req);
    const csvText = await res.text();
    const lines = csvText.trim().split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Clara Oswald');
    expect(lines[1]).toContain('Danny Pink');
    expect(lines[1]).toContain('Attending');
    expect(lines[1]).toContain(
      'Clara Oswald: Truffle Gnocchi (vegan); Danny Pink: Herb Salmon (gluten-free)'
    );
    expect(lines[1]).toContain('"Hotel shuttle?: Yes, round-trip"');
  });

  it('round-trips exported CSV through parseCsvContent and validateSingleCsvRow preserving getGuestPhone, isAddressComplete, Plus-One Name, and dietaryNotes without matching Meal Selections', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    mockPrisma.invitationCode.findMany.mockResolvedValue([
      {
        id: 'ic-roundtrip',
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
        dietaryNotes: 'No peanuts',
        plusOneAllocations: 2,
        used: true,
        extraFields: {
          phone: '+15551234567',
          attendanceStatus: 'attending',
          plusOneNames: ['John Doe', 'Tommy Doe'],
          mealSummary: 'Jane Doe: Salmon; John Doe: Steak',
          customAnswersSummary: 'Shuttle?: Yes',
        },
      },
    ] as any);

    const req = new NextRequest('http://localhost:3000/api/admin/invitation-codes/export');
    const res = await GET(req);
    const csvText = await res.text();

    const parsed = parseCsvContent(csvText);
    expect(parsed.suggestedPhoneCol).toBe('Phone Number');
    expect(parsed.suggestedPlusOneNameCol).toBe('Plus-One Name');
    expect(parsed.suggestedDietaryNotesCol).toBe('Dietary Notes');
    expect(parsed.suggestedAddressLine1Col).toBe('Address Line 1');
    expect(parsed.suggestedAddressLine2Col).toBe('Address Line 2');
    expect(parsed.suggestedCityCol).toBe('City');
    expect(parsed.suggestedStateCol).toBe('State');
    expect(parsed.suggestedZipCodeCol).toBe('ZIP Code');
    expect(parsed.suggestedCountryCol).toBe('Country');

    const revalidated = validateSingleCsvRow(
      parsed.rows[0],
      0,
      {
        guestNameCol: parsed.suggestedGuestNameCol,
        codeCol: parsed.suggestedCodeCol,
        emailCol: parsed.suggestedEmailCol,
        phoneCol: parsed.suggestedPhoneCol,
        plusOneNameCol: parsed.suggestedPlusOneNameCol,
        plusOneCol: parsed.suggestedPlusOneCol,
        householdNameCol: parsed.suggestedHouseholdNameCol,
        partyGroupCol: parsed.suggestedPartyGroupCol,
        partyTagsCol: parsed.suggestedPartyTagsCol,
        addressLine1Col: parsed.suggestedAddressLine1Col,
        addressLine2Col: parsed.suggestedAddressLine2Col,
        cityCol: parsed.suggestedCityCol,
        stateCol: parsed.suggestedStateCol,
        zipCodeCol: parsed.suggestedZipCodeCol,
        countryCol: parsed.suggestedCountryCol,
        dietaryNotesCol: parsed.suggestedDietaryNotesCol,
        extraCols: [],
      },
      new Map([['JANE2026', 1]]),
      new Set(['JANE2026'])
    );

    expect(revalidated.isValid).toBe(true);
    expect(getGuestPhone(revalidated)).toBe('+15551234567');
    expect(isAddressComplete(revalidated)).toBe(true);
    expect(revalidated.addressLine1).toBe('123 Main St');
    expect(revalidated.addressLine2).toBe('Apt 4B');
    expect(revalidated.city).toBe('San Francisco');
    expect(revalidated.state).toBe('CA');
    expect(revalidated.zipCode).toBe('94102');
    expect(revalidated.country).toBe('USA');
    expect(revalidated.dietaryNotes).toBe('No peanuts');
    expect(formatGuestPlusOneNames(revalidated)).toBe('John Doe, Tommy Doe');
    expect(revalidated.extraFields).toEqual({
      phone: '+15551234567',
      plusOneNames: ['John Doe', 'Tommy Doe'],
    });
  });

  it('ignores spoofed forwarded headers when TRUST_PROXY=false and emits validated single-host RSVP links when TRUST_PROXY is active', async () => {
    const prevTrustProxy = process.env.TRUST_PROXY;
    const prevAllowedHosts = process.env.ALLOWED_HOSTS;
    process.env.ALLOWED_HOSTS = 'localhost,wedding.example';

    (prisma.invitationCode.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'inv-safe-1',
        code: 'SAFE2026',
        guestName: 'Alex Rivera',
        email: 'alex@example.com',
        extraFields: null,
        plusOneFirstName: null,
        plusOneLastName: null,
        householdName: null,
        partyGroup: null,
        partyTags: [],
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        zipCode: null,
        country: null,
        dietaryNotes: null,
        plusOneAllocations: 0,
        used: false,
        rsvp: null,
      },
    ]);

    try {
      process.env.TRUST_PROXY = 'false';
      const spoofedReq = new NextRequest(
        'http://localhost:3000/api/admin/invitation-codes/export',
        {
          headers: {
            host: 'localhost:3000',
            'x-forwarded-host': 'phishing.evil.org, injected,col',
            'x-forwarded-proto': 'https',
          },
        }
      );
      const spoofedRes = await GET(spoofedReq);
      const spoofedCsv = (await spoofedRes.text()).replace(/^\uFEFF/, '');
      expect(spoofedCsv).toContain('http://localhost:3000/guest?code=SAFE2026');
      expect(spoofedCsv).not.toContain('phishing.evil.org');

      process.env.TRUST_PROXY = '1';
      const proxiedReq = new NextRequest(
        'http://localhost:3000/api/admin/invitation-codes/export',
        {
          headers: {
            host: 'localhost:3000',
            'x-forwarded-host': 'attacker.evil.org, wedding.example',
            'x-forwarded-proto': 'http, https',
          },
        }
      );
      const proxiedRes = await GET(proxiedReq);
      const proxiedCsv = (await proxiedRes.text()).replace(/^\uFEFF/, '');
      expect(proxiedCsv).toContain('https://wedding.example/guest?code=SAFE2026');
      expect(proxiedCsv).not.toContain('attacker.evil.org');
    } finally {
      if (prevTrustProxy === undefined) {
        delete process.env.TRUST_PROXY;
      } else {
        process.env.TRUST_PROXY = prevTrustProxy;
      }
      if (prevAllowedHosts === undefined) {
        delete process.env.ALLOWED_HOSTS;
      } else {
        process.env.ALLOWED_HOSTS = prevAllowedHosts;
      }
    }
  });
});
