/**
 * @jest-environment node
 */

jest.unmock('@prisma/client');
jest.unmock('@prisma/adapter-pg');
jest.unmock('pg');
jest.unmock('@/lib/prisma');

const mockCookieMap = new Map<string, string>();
const mockHeaderMap = new Map<string, string>();

jest.mock('next/headers', () => ({
  cookies: jest.fn(async () => ({
    get: (name: string) => {
      const value = mockCookieMap.get(name);
      return value !== undefined ? { name, value } : undefined;
    },
  })),
  headers: jest.fn(async () => ({
    get: (name: string) => mockHeaderMap.get(name.toLowerCase()) ?? null,
  })),
}));

jest.mock('@/utils/crypto', () => {
  const actual = jest.requireActual('@/utils/crypto');
  return {
    ...actual,
    hmacSha256: jest.fn((...args: unknown[]) =>
      (actual.hmacSha256 as (..._args: unknown[]) => unknown)(...args)
    ),
  };
});

import { Client, type Pool } from 'pg';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  GUEST_INVITE_COOKIE,
  getGuestInviteSession,
  signGuestInviteSessionToken,
} from '@/core/auth/guestInviteSession';
import { runWithRequestContext } from '@/lib/requestContext';
import { AppConfigSchema, ContentNodeSchema } from '@/features/content';
import { subEventService } from '@/features/sub-events';
import { base64urlDecode, hmacSha256 } from '@/utils/crypto';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';
import { GET as getSchedule } from '@/app/api/schedule/route';
import { POST as postRsvp } from '@/app/api/rsvp/route';
import { GET as getScheduleIcs } from '@/app/api/schedule/[id]/ics/route';
import { GET as getGuestAddress, PUT as putGuestAddress } from '@/app/api/guest/address/route';
import { GET as getWeather } from '@/app/api/weather/route';
import RootLayout from '@/app/layout';
import HomePage from '@/app/page';

interface SqlCounters {
  invitationCodeSelects: number;
  appConfigSelects: number;
  contentNodeSelects: number;
  subEventSelects: number;
  attractionSelects: number;
  allQueries: string[];
}

function clearReactTestCache(): void {
  const store = (globalThis as unknown as { globalFallbackStore?: Map<unknown, unknown> })
    .globalFallbackStore;
  store?.clear();
}

function extractSqlText(queryArg: unknown): string {
  if (typeof queryArg === 'string') {
    return queryArg;
  }
  if (queryArg && typeof queryArg === 'object' && 'text' in queryArg) {
    const text = (queryArg as { text?: unknown }).text;
    return typeof text === 'string' ? text : '';
  }
  return '';
}

describe('Per-request context propagation, guest session hydration, and AppConfig deduplication', () => {
  const counters: SqlCounters = {
    invitationCodeSelects: 0,
    appConfigSelects: 0,
    contentNodeSelects: 0,
    subEventSelects: 0,
    attractionSelects: 0,
    allQueries: [],
  };

  let originalClientQuery: typeof Client.prototype.query | null = null;
  let originalFetch: typeof global.fetch;

  function resetCounters(): void {
    counters.invitationCodeSelects = 0;
    counters.appConfigSelects = 0;
    counters.contentNodeSelects = 0;
    counters.subEventSelects = 0;
    counters.attractionSelects = 0;
    counters.allQueries = [];
  }

  function recordSql(queryArg: unknown): void {
    const sql = extractSqlText(queryArg);
    if (!sql) return;
    counters.allQueries.push(sql);
    if (/^\s*SELECT\b[\s\S]*?"InvitationCode"/i.test(sql)) {
      counters.invitationCodeSelects += 1;
    }
    if (/^\s*SELECT\b[\s\S]*?"AppConfig"/i.test(sql)) {
      counters.appConfigSelects += 1;
    }
    if (/^\s*SELECT\b[\s\S]*?"ContentNode"/i.test(sql)) {
      counters.contentNodeSelects += 1;
    }
    if (/^\s*SELECT\b[\s\S]*?\bFROM\s+(?:"[^"]+"\.)?"SubEvent"/i.test(sql)) {
      counters.subEventSelects += 1;
    }
    if (/^\s*SELECT\b[\s\S]*?"Attraction"/i.test(sql)) {
      counters.attractionSelects += 1;
    }
  }

  beforeAll(() => {
    originalFetch = global.fetch;
    originalClientQuery = Client.prototype.query;
    Client.prototype.query = function patchedClientQuery(
      this: Client,
      ...args: Parameters<typeof Client.prototype.query>
    ) {
      recordSql(args[0]);
      return (originalClientQuery as (..._args: unknown[]) => unknown).apply(this, args);
    } as typeof Client.prototype.query;
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    if (originalClientQuery) {
      Client.prototype.query = originalClientQuery;
    }
    const globalRef = globalThis as unknown as {
      prisma?: unknown;
      pgPool?: Pool;
    };
    const pool = globalRef.pgPool;
    await prisma.subEventRsvp.deleteMany({});
    await prisma.subEventAccess.deleteMany({});
    await prisma.subEvent.deleteMany({});
    await prisma.invitationCode.deleteMany({});
    await prisma.contentNode.deleteMany({});
    await prisma.attraction.deleteMany({});
    await prisma.$disconnect();
    if (pool && typeof pool.end === 'function') {
      await pool.end();
    }
    delete globalRef.prisma;
    delete globalRef.pgPool;
  });

  beforeEach(async () => {
    resetRateLimitsForTesting();
    clearReactTestCache();
    mockCookieMap.clear();
    mockHeaderMap.clear();
    jest.restoreAllMocks();
    global.fetch = originalFetch;

    await prisma.subEventRsvp.deleteMany({});
    await prisma.subEventAccess.deleteMany({});
    await prisma.subEvent.deleteMany({});
    await prisma.invitationCode.deleteMany({});
    await prisma.contentNode.deleteMany({});
    await prisma.attraction.deleteMany({});

    await prisma.appConfig.upsert({
      where: { id: 'global' },
      update: {
        partner1Name: 'Riley',
        partner2Name: 'Jordan',
        brideName: 'Riley',
        groomName: 'Jordan',
        weddingDate: new Date('2027-06-20T20:00:00.000Z'),
        baseUrl: 'http://localhost:3000',
        venueName: 'Grand Conservatory',
        venueAddress: '100 Garden Way',
        venueCity: 'Chicago',
        venueState: 'IL',
        venueZip: '60601',
        latitude: 41.8781,
        longitude: -87.6298,
        storyText: 'Welcome',
        venueDescription: 'Conservatory',
        travelAdvice: 'CTA',
        heroTitle: 'Riley & Jordan',
        heroSubtitle: 'June 20, 2027',
        seoTitle: 'Riley & Jordan',
        seoDescription: 'Wedding celebration',
        faviconUrl: '/assets/favicon.png',
        ogImageUrl: '/images/placeholder.png',
        seoKeywords: 'wedding',
        colorPrimary: '#B91C1C',
        colorSecondary: '#B45309',
        themePreset: 'classic',
        themeTokens: {},
        timezone: 'America/Chicago',
        showCountdown: true,
        showAddToCalendar: true,
        rsvpOpen: true,
        rsvpDeadlineDate: '2099-12-31',
        rsvpGracePeriodHours: 0,
        rsvpClosedMessage: 'Online RSVPs are now closed.',
        modules: {
          rsvp: true,
          schedule: true,
          weather: true,
          registry: true,
          photos: true,
          thingsToDo: true,
          weddingParty: true,
          heart: true,
          countdown: true,
          addToCalendar: true,
        },
        features: [],
      },
      create: {
        id: 'global',
        partner1Name: 'Riley',
        partner2Name: 'Jordan',
        brideName: 'Riley',
        groomName: 'Jordan',
        weddingDate: new Date('2027-06-20T20:00:00.000Z'),
        baseUrl: 'http://localhost:3000',
        venueName: 'Grand Conservatory',
        venueAddress: '100 Garden Way',
        venueCity: 'Chicago',
        venueState: 'IL',
        venueZip: '60601',
        latitude: 41.8781,
        longitude: -87.6298,
        storyText: 'Welcome',
        venueDescription: 'Conservatory',
        travelAdvice: 'CTA',
        heroTitle: 'Riley & Jordan',
        heroSubtitle: 'June 20, 2027',
        seoTitle: 'Riley & Jordan',
        seoDescription: 'Wedding celebration',
        faviconUrl: '/assets/favicon.png',
        ogImageUrl: '/images/placeholder.png',
        seoKeywords: 'wedding',
        colorPrimary: '#B91C1C',
        colorSecondary: '#B45309',
        themePreset: 'classic',
        themeTokens: {},
        timezone: 'America/Chicago',
        showCountdown: true,
        showAddToCalendar: true,
        rsvpOpen: true,
        rsvpDeadlineDate: '2099-12-31',
        rsvpGracePeriodHours: 0,
        rsvpClosedMessage: 'Online RSVPs are now closed.',
        modules: {
          rsvp: true,
          schedule: true,
          weather: true,
          registry: true,
          photos: true,
          thingsToDo: true,
          weddingParty: true,
          heart: true,
          countdown: true,
          addToCalendar: true,
        },
        features: [],
      },
    });

    resetCounters();
  });

  it('keeps signed client cookie payload strictly limited to code, guestName, iat, and exp', async () => {
    const token = await signGuestInviteSessionToken({
      code: 'MINIMAL26',
      guestName: 'Morgan Household',
      // Runtime extra properties should never be serialized into client cookies
      ...({
        addressLine1: '999 Secret St',
        email: 'secret@example.com',
        dietaryNotes: 'No peanuts',
      } as Record<string, unknown>),
    } as Parameters<typeof signGuestInviteSessionToken>[0]);

    const [encodedPayload] = token.split('.');
    const decoded = JSON.parse(base64urlDecode(encodedPayload)) as Record<string, unknown>;
    expect(Object.keys(decoded).sort()).toEqual(['code', 'exp', 'guestName', 'iat']);
  });

  it('GET /api/schedule verifies cookie once and runs 1 InvitationCode select and 1 AppConfig select/parse', async () => {
    const invite = await prisma.invitationCode.create({
      data: {
        code: 'SCHED2026',
        guestName: 'Casey Household',
        plusOneAllocations: 2,
        plusOneFirstName: 'Alex',
        plusOneLastName: 'Rivera',
        extraFields: { plusOneNames: ['Alex Rivera', 'Sam Lee'] },
        isSample: false,
      },
    });

    const publicEvent = await prisma.subEvent.create({
      data: {
        title: 'Ceremony',
        startTime: new Date('2027-06-20T20:00:00.000Z'),
        isPrivate: false,
      },
    });
    const privateEvent = await prisma.subEvent.create({
      data: {
        title: 'Rehearsal Dinner',
        startTime: new Date('2027-06-19T23:00:00.000Z'),
        isPrivate: true,
      },
    });
    await prisma.subEventAccess.create({
      data: {
        invitationCodeId: invite.id,
        subEventId: privateEvent.id,
      },
    });

    const token = await signGuestInviteSessionToken({
      code: 'SCHED2026',
      guestName: 'Casey Household',
    });

    const hmacMock = hmacSha256 as jest.Mock;
    hmacMock.mockClear();
    const parseSpy = jest.spyOn(AppConfigSchema, 'parse');
    resetCounters();

    const req = new NextRequest('http://localhost/api/schedule', {
      method: 'GET',
      headers: {
        cookie: `${GUEST_INVITE_COOKIE}=${token}`,
      },
    });

    const res = await getSchedule(req);
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.isGuest).toBe(true);
    expect(json.guestName).toBe('Casey Household');
    expect(json.plusOneAllocations).toBe(2);
    expect(json.savedPlusOneNames).toEqual(['Alex Rivera', 'Sam Lee']);
    expect(json.data.map((e: { id: string }) => e.id).sort()).toEqual(
      [publicEvent.id, privateEvent.id].sort()
    );

    expect(hmacMock).toHaveBeenCalledTimes(1);
    expect(counters.invitationCodeSelects).toBe(1);
    expect(counters.appConfigSelects).toBe(1);
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  it('POST /api/rsvp runs 1 InvitationCode select and 1 AppConfig select/parse per request', async () => {
    const invite = await prisma.invitationCode.create({
      data: {
        code: 'RSVP2026',
        guestName: 'Taylor Household',
        plusOneAllocations: 1,
        used: false,
        extraFields: { customNote: 'keep-me' },
        isSample: false,
      },
    });

    const event = await prisma.subEvent.create({
      data: {
        title: 'Reception Dinner',
        startTime: new Date('2027-06-20T22:00:00.000Z'),
        isPrivate: true,
      },
    });
    await prisma.subEventAccess.create({
      data: {
        invitationCodeId: invite.id,
        subEventId: event.id,
      },
    });

    const token = await signGuestInviteSessionToken({
      code: 'RSVP2026',
      guestName: 'Taylor Household',
    });

    const hmacMock = hmacSha256 as jest.Mock;
    hmacMock.mockClear();
    const parseSpy = jest.spyOn(AppConfigSchema, 'parse');
    resetCounters();

    const req = new NextRequest('http://localhost/api/rsvp', {
      method: 'POST',
      headers: {
        cookie: `${GUEST_INVITE_COOKIE}=${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        rsvps: [
          {
            subEventId: event.id,
            status: 'attending',
            plusOneCount: 1,
            plusOneNames: ['Jamie Taylor'],
            dietaryNotes: 'Gluten-free',
          },
        ],
      }),
    });

    const res = await postRsvp(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);

    expect(hmacMock).toHaveBeenCalledTimes(1);
    expect(counters.invitationCodeSelects).toBe(1);
    expect(counters.appConfigSelects).toBe(1);
    expect(parseSpy).toHaveBeenCalledTimes(1);

    const updatedInvite = await prisma.invitationCode.findUnique({ where: { id: invite.id } });
    expect(updatedInvite?.used).toBe(true);
    expect(updatedInvite?.plusOneFirstName).toBe('Jamie');
    expect(updatedInvite?.plusOneLastName).toBe('Taylor');
    expect(updatedInvite?.dietaryNotes).toBe('Gluten-free');
    expect((updatedInvite?.extraFields as Record<string, unknown>)?.customNote).toBe('keep-me');
    expect((updatedInvite?.extraFields as Record<string, unknown>)?.eventRsvps).toEqual([
      {
        subEventId: event.id,
        subEventTitle: 'Reception Dinner',
        status: 'attending',
        plusOneCount: 1,
      },
    ]);
  });

  it('GET /api/schedule/[id]/ics, HomePage, and GET/PUT /api/guest/address each run 1 InvitationCode select per request', async () => {
    const invite = await prisma.invitationCode.create({
      data: {
        code: 'MULTI2026',
        guestName: 'Quinn Household',
        addressLine1: '10 Lake Shore Dr',
        city: 'Chicago',
        state: 'IL',
        zipCode: '60611',
        country: 'United States',
        isSample: false,
      },
    });

    const privateEvent = await prisma.subEvent.create({
      data: {
        title: 'Welcome Cocktails',
        description: 'Rooftop drinks',
        locationName: 'Sky Terrace',
        location: '100 Garden Way',
        startTime: new Date('2027-06-19T23:00:00.000Z'),
        endTime: new Date('2027-06-20T01:00:00.000Z'),
        isPrivate: true,
      },
    });
    await prisma.subEventAccess.create({
      data: {
        invitationCodeId: invite.id,
        subEventId: privateEvent.id,
      },
    });

    const token = await signGuestInviteSessionToken({
      code: 'MULTI2026',
      guestName: 'Quinn Household',
    });

    // 1. GET /api/schedule/[id]/ics
    resetCounters();
    const icsReq = new NextRequest(`http://localhost/api/schedule/${privateEvent.id}/ics`, {
      method: 'GET',
      headers: { cookie: `${GUEST_INVITE_COOKIE}=${token}` },
    });
    const icsRes = await getScheduleIcs(icsReq, { params: Promise.resolve({ id: privateEvent.id }) });
    expect(icsRes.status).toBe(200);
    expect(icsRes.headers.get('content-type')).toContain('text/calendar');
    expect(counters.invitationCodeSelects).toBe(1);
    expect(counters.appConfigSelects).toBe(1);

    // 2. Concurrent RootLayout + HomePage Server Component render
    await prisma.contentNode.createMany({
      data: [
        {
          type: 'FAQ',
          tags: ['Homepage', 'FAQ'],
          data: {
            question: 'Is shuttle service provided?',
            answer: 'Yes, from Grand Hotel.',
            displayOrder: 1,
            isVisible: true,
          },
        },
        {
          type: 'FAQ',
          tags: ['FAQ'],
          data: {
            question: 'What is the dress code?',
            answer: 'Formal attire.',
            displayOrder: 2,
            isVisible: true,
          },
        },
        {
          type: 'Logistics',
          tags: ['Homepage', 'Logistics'],
          data: {
            title: 'Valet Parking',
            description: 'Complimentary at north gate.',
          },
        },
      ],
    });
    await prisma.subEvent.create({
      data: {
        title: 'Garden Ceremony',
        description: 'Main lawn ceremony',
        locationName: 'Conservatory Lawn',
        location: '100 Garden Way',
        startTime: new Date('2027-06-20T20:00:00.000Z'),
        endTime: new Date('2027-06-20T21:00:00.000Z'),
        isPrivate: false,
      },
    });
    await prisma.attraction.create({
      data: {
        name: 'Grand Conservatory Hotel',
        description: 'Reserved room block',
        category: 'hotel',
        website: 'https://example.com/hotel',
        directions: 'https://maps.google.com/?q=Grand+Conservatory',
        latitude: 41.8781,
        longitude: -87.6298,
        isVisible: true,
      },
    });

    clearReactTestCache();
    mockCookieMap.set(GUEST_INVITE_COOKIE, token);
    mockHeaderMap.set('x-guest-gated-page', '1');
    mockHeaderMap.set('x-guest-callback-url', '/');
    const hmacMock = hmacSha256 as jest.Mock;
    hmacMock.mockClear();
    const contentNodeParseSpy = jest.spyOn(ContentNodeSchema, 'parse');
    resetCounters();

    const [layoutElement, homeElement] = await Promise.all([
      RootLayout({ children: null }),
      HomePage(),
    ]);
    expect(layoutElement).toBeTruthy();
    expect(homeElement).toBeTruthy();
    expect(hmacMock).toHaveBeenCalledTimes(1);
    expect(counters.invitationCodeSelects).toBe(1);
    expect(counters.appConfigSelects).toBe(1);
    expect(counters.contentNodeSelects).toBe(1);
    expect(counters.subEventSelects).toBe(1);
    expect(counters.attractionSelects).toBe(1);
    // 3 ContentNode rows parsed once + 2 authorized guest SubEvents mapped to Schedule nodes in HomePage
    expect(contentNodeParseSpy).toHaveBeenCalledTimes(5);
    contentNodeParseSpy.mockRestore();

    // 3. GET /api/guest/address
    resetCounters();
    const getAddrReq = new NextRequest('http://localhost/api/guest/address', {
      method: 'GET',
      headers: { cookie: `${GUEST_INVITE_COOKIE}=${token}` },
    });
    const getAddrRes = await getGuestAddress(getAddrReq);
    expect(getAddrRes.status).toBe(200);
    const getAddrBody = await getAddrRes.json();
    expect(getAddrBody.data.addressLine1).toBe('10 Lake Shore Dr');
    expect(counters.invitationCodeSelects).toBe(1);

    // 4. PUT /api/guest/address
    resetCounters();
    const putAddrReq = new NextRequest('http://localhost/api/guest/address', {
      method: 'PUT',
      headers: {
        cookie: `${GUEST_INVITE_COOKIE}=${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        addressLine1: '500 Michigan Ave',
        addressLine2: 'Suite 12',
        city: 'Chicago',
        state: 'IL',
        zipCode: '60611',
        country: 'United States',
      }),
    });
    const putAddrRes = await putGuestAddress(putAddrReq);
    expect(putAddrRes.status).toBe(200);
    const putAddrBody = await putAddrRes.json();
    expect(putAddrBody.data.addressLine1).toBe('500 Michigan Ave');
    expect(counters.invitationCodeSelects).toBe(1);
  });

  it('GET /api/weather executes 1 AppConfig query and 1 AppConfigSchema.parse call per request', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        daily: {
          time: ['2027-06-20'],
          temperature_2m_max: [78],
          temperature_2m_min: [62],
          apparent_temperature_max: [79],
          precipitation_sum: [0],
          wind_speed_10m_max: [7],
          weathercode: [1],
        },
      }),
    }) as unknown as typeof global.fetch;

    const parseSpy = jest.spyOn(AppConfigSchema, 'parse');
    resetCounters();

    const req = new NextRequest('http://localhost/api/weather', { method: 'GET' });
    const res = await getWeather(req);
    expect(res.status).toBe(200);

    expect(counters.appConfigSelects).toBe(1);
    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  it('executes 50 InvitationCode selects and 50 AppConfig selects across a 25-guest concurrent RSVP burst', async () => {
    const ceremony = await prisma.subEvent.create({
      data: {
        title: 'Main Ceremony',
        startTime: new Date('2027-06-20T20:00:00.000Z'),
        isPrivate: false,
      },
    });

    const guests = await Promise.all(
      Array.from({ length: 25 }, async (_, index) => {
        const code = `BURST${String(index + 1).padStart(3, '0')}`;
        const guestName = `Burst Guest ${index + 1}`;
        await prisma.invitationCode.create({
          data: {
            code,
            guestName,
            plusOneAllocations: 1,
            isSample: false,
          },
        });
        const token = await signGuestInviteSessionToken({ code, guestName });
        return { code, guestName, token, ip: `10.10.0.${index + 1}` };
      })
    );

    const parseSpy = jest.spyOn(AppConfigSchema, 'parse');
    resetCounters();

    await Promise.all(
      guests.map(async (guest) => {
        const scheduleReq = new NextRequest('http://localhost/api/schedule', {
          method: 'GET',
          headers: {
            cookie: `${GUEST_INVITE_COOKIE}=${guest.token}`,
            'x-forwarded-for': guest.ip,
          },
        });
        const scheduleRes = await getSchedule(scheduleReq);
        expect(scheduleRes.status).toBe(200);

        const rsvpReq = new NextRequest('http://localhost/api/rsvp', {
          method: 'POST',
          headers: {
            cookie: `${GUEST_INVITE_COOKIE}=${guest.token}`,
            'content-type': 'application/json',
            'x-forwarded-for': guest.ip,
          },
          body: JSON.stringify({
            rsvps: [
              {
                subEventId: ceremony.id,
                status: 'attending',
                plusOneCount: 1,
                plusOneNames: [`Plus One ${guest.code}`],
              },
            ],
          }),
        });
        const rsvpRes = await postRsvp(rsvpReq);
        expect(rsvpRes.status).toBe(200);
      })
    );

    // 25 GET /api/schedule (1 InvitationCode + 1 AppConfig each)
    // + 25 POST /api/rsvp (1 InvitationCode + 1 AppConfig each)
    expect(counters.invitationCodeSelects).toBe(50);
    expect(counters.appConfigSelects).toBe(50);
    expect(parseSpy).toHaveBeenCalledTimes(50);
  });

  it('immediately enforces revoked or sample invitation cookies (401 + Max-Age=0) and RSVP locks (403) on subsequent HTTP requests', async () => {
    const invite = await prisma.invitationCode.create({
      data: {
        code: 'REVOKE26',
        guestName: 'Harper Household',
        plusOneAllocations: 0,
        isSample: false,
      },
    });
    const sampleInvite = await prisma.invitationCode.create({
      data: {
        code: 'SAMPLE26',
        guestName: 'Sample Household',
        isSample: true,
      },
    });
    const event = await prisma.subEvent.create({
      data: {
        title: 'Evening Reception',
        startTime: new Date('2027-06-20T22:00:00.000Z'),
        isPrivate: false,
      },
    });

    const activeToken = await signGuestInviteSessionToken({
      code: invite.code,
      guestName: invite.guestName,
    });
    const sampleToken = await signGuestInviteSessionToken({
      code: sampleInvite.code,
      guestName: sampleInvite.guestName,
    });

    // Request 1: Active guest RSVP succeeds while rsvpOpen is true
    const rsvpReq1 = new NextRequest('http://localhost/api/rsvp', {
      method: 'POST',
      headers: {
        cookie: `${GUEST_INVITE_COOKIE}=${activeToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        rsvps: [{ subEventId: event.id, status: 'attending', plusOneCount: 0 }],
      }),
    });
    const rsvpRes1 = await postRsvp(rsvpReq1);
    expect(rsvpRes1.status).toBe(200);

    // Admin closes RSVPs -> Request 2 immediately returns 403 without stale AppConfig cache
    await prisma.appConfig.update({
      where: { id: 'global' },
      data: { rsvpOpen: false, rsvpClosedMessage: 'RSVPs are locked.' },
    });

    const rsvpReq2 = new NextRequest('http://localhost/api/rsvp', {
      method: 'POST',
      headers: {
        cookie: `${GUEST_INVITE_COOKIE}=${activeToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        rsvps: [{ subEventId: event.id, status: 'declined', plusOneCount: 0 }],
      }),
    });
    const rsvpRes2 = await postRsvp(rsvpReq2);
    expect(rsvpRes2.status).toBe(403);
    const rsvpBody2 = await rsvpRes2.json();
    expect(rsvpBody2.error).toContain('RSVPs are locked.');

    // Sample invitation cookie without guest_auth/admin_auth returns 401 and clears cookie
    const sampleReq = new NextRequest('http://localhost/api/schedule', {
      method: 'GET',
      headers: { cookie: `${GUEST_INVITE_COOKIE}=${sampleToken}` },
    });
    const sampleRes = await getSchedule(sampleReq);
    expect(sampleRes.status).toBe(401);
    expect(sampleRes.headers.get('set-cookie')).toContain(`${GUEST_INVITE_COOKIE}=`);
    expect(sampleRes.headers.get('set-cookie')).toContain('Max-Age=0');

    // Admin revokes/deletes active invitation -> next HTTP request immediately returns 401 and clears cookie
    await prisma.subEventRsvp.deleteMany({ where: { invitationCodeId: invite.id } });
    await prisma.invitationCode.delete({ where: { id: invite.id } });

    const revokedReq = new NextRequest('http://localhost/api/schedule', {
      method: 'GET',
      headers: { cookie: `${GUEST_INVITE_COOKIE}=${activeToken}` },
    });
    const revokedRes = await getSchedule(revokedReq);
    expect(revokedRes.status).toBe(401);
    expect(revokedRes.headers.get('set-cookie')).toContain(`${GUEST_INVITE_COOKIE}=`);
    expect(revokedRes.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('preserves standalone SubEventService database fallback when called outside request context', async () => {
    const invite = await prisma.invitationCode.create({
      data: {
        code: 'DIRECT26',
        guestName: 'Direct Caller',
        plusOneAllocations: 2,
        plusOneFirstName: 'Robin',
        plusOneLastName: 'Park',
        isSample: false,
      },
    });
    const event = await prisma.subEvent.create({
      data: {
        title: 'Brunch',
        startTime: new Date('2027-06-21T16:00:00.000Z'),
        isPrivate: true,
      },
    });
    await prisma.subEventAccess.create({
      data: {
        invitationCodeId: invite.id,
        subEventId: event.id,
      },
    });

    clearReactTestCache();
    expect(await subEventService.getPlusOneAllowanceForGuest('DIRECT26')).toBe(2);
    expect(await subEventService.getSavedPlusOneNamesForGuest('DIRECT26')).toEqual(['Robin Park']);
    const schedule = await subEventService.getScheduleForGuest('DIRECT26');
    expect(schedule).toHaveLength(1);
    expect(schedule[0]?.id).toBe(event.id);
  });

  it('isolates session cache entries by NextRequest instance and signed session key', async () => {
    await prisma.invitationCode.createMany({
      data: [
        { code: 'ISOA2026', guestName: 'Guest Alpha', isSample: false },
        { code: 'ISOB2026', guestName: 'Guest Beta', isSample: false },
      ],
    });

    const tokenA = await signGuestInviteSessionToken({
      code: 'ISOA2026',
      guestName: 'Guest Alpha',
    });
    const tokenB = await signGuestInviteSessionToken({
      code: 'ISOB2026',
      guestName: 'Guest Beta',
    });

    const reqA = new NextRequest('http://localhost/api/schedule', {
      headers: { cookie: `${GUEST_INVITE_COOKIE}=${tokenA}` },
    });
    const reqB = new NextRequest('http://localhost/api/schedule', {
      headers: { cookie: `${GUEST_INVITE_COOKIE}=${tokenB}` },
    });

    resetCounters();
    await runWithRequestContext(reqA, async () => {
      const sessionA1 = await getGuestInviteSession(reqA);
      const sessionA2 = await getGuestInviteSession(reqA);
      const sessionB = await getGuestInviteSession(reqB);

      expect(sessionA1?.code).toBe('ISOA2026');
      expect(sessionA2?.code).toBe('ISOA2026');
      expect(sessionB?.code).toBe('ISOB2026');
    });

    expect(counters.invitationCodeSelects).toBe(2);
  });

  it('executes 1 ContentNode select and preserves fallback Schedule nodes when SubEvent table is empty during concurrent RootLayout + HomePage render', async () => {
    await prisma.invitationCode.create({
      data: {
        code: 'EMPTYSE26',
        guestName: 'Fallback Household',
        isSample: false,
      },
    });
    await prisma.contentNode.createMany({
      data: [
        {
          type: 'FAQ',
          tags: ['FAQ'],
          data: {
            question: 'Can we bring kids?',
            answer: 'Adults-only reception.',
            displayOrder: 1,
            isVisible: true,
          },
        },
        {
          type: 'Schedule',
          tags: ['Homepage', 'Schedule'],
          data: {
            title: 'Legacy Fallback Ceremony',
            startTime: '2027-06-20T20:00:00.000Z',
            isPrivate: false,
          },
        },
      ],
    });

    const token = await signGuestInviteSessionToken({
      code: 'EMPTYSE26',
      guestName: 'Fallback Household',
    });

    clearReactTestCache();
    mockCookieMap.set(GUEST_INVITE_COOKIE, token);
    mockHeaderMap.set('x-guest-gated-page', '1');
    mockHeaderMap.set('x-guest-callback-url', '/');
    const contentNodeParseSpy = jest.spyOn(ContentNodeSchema, 'parse');
    resetCounters();

    const [layoutElement, homeElement] = await Promise.all([
      RootLayout({ children: null }),
      HomePage(),
    ]);
    expect(layoutElement).toBeTruthy();
    expect(homeElement).toBeTruthy();
    expect(counters.appConfigSelects).toBe(1);
    expect(counters.invitationCodeSelects).toBe(1);
    expect(counters.contentNodeSelects).toBe(1);
    expect(counters.subEventSelects).toBe(1);
    expect(contentNodeParseSpy).toHaveBeenCalledTimes(2);
    expect((homeElement as { props: { contentNodes: Array<{ data: { title?: string; isReadOnly?: boolean } }> } }).props.contentNodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'Schedule',
          data: expect.objectContaining({
            title: 'Legacy Fallback Ceremony',
            isReadOnly: true,
          }),
        }),
      ])
    );

    // Non-homepage RootLayout render queries only FAQ rows when homepage ContentNodes are not in flight
    contentNodeParseSpy.mockClear();
    clearReactTestCache();
    resetCounters();

    const standaloneLayout = await RootLayout({ children: null });
    expect(standaloneLayout).toBeTruthy();
    expect(counters.contentNodeSelects).toBe(1);
    expect(contentNodeParseSpy).toHaveBeenCalledTimes(1);
    contentNodeParseSpy.mockRestore();
  });
});
