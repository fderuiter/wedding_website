import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';
import { GUEST_COOKIE, signGuestToken } from '@/core/auth/guest.server';
import { getAppConfig } from '@/lib/config';
import { GET } from '../route';

jest.mock('next/og', () => {
  return {
    ImageResponse: jest.fn().mockImplementation((_element, options) => {
      const headers = new Headers(options?.headers || {});
      if (!headers.has('content-type')) {
        headers.set('content-type', 'image/png');
      }
      return new Response(Buffer.from('fake-png-binary-data'), {
        status: 200,
        headers,
      });
    }),
  };
});

jest.mock('@/lib/config', () => {
  const actual = jest.requireActual('@/lib/config');
  return {
    ...actual,
    getAppConfig: jest.fn().mockResolvedValue({
      partner1Name: 'Alice',
      partner2Name: 'Bob',
      brideName: 'Alice',
      groomName: 'Bob',
      brandMonogram: 'A & B',
      seoTitle: "Alice & Bob's Wedding",
      colorPrimary: '#B91C1C',
      colorSecondary: '#B45309',
      weddingDate: new Date('2026-06-20T16:00:00.000Z'),
      venueName: 'The Grand Ballroom',
      venueCity: 'New York',
      venueState: 'NY',
    }),
  };
});

describe('/api/og route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders a redacted monogram card for unauthenticated callers, ignores query overrides, and sets Vary: Cookie', async () => {
    const req = new Request(
      'http://localhost:3000/api/og?title=Test&p1=A&p2=B&primary=%230000ff&secondary=%2300ff00'
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('vary')).toBe('Cookie');
    expect(res.headers.get('cache-control')).toContain('private');
    expect(res.headers.get('cache-control')).not.toContain('public');
    expect(res.headers.get('cache-control')).not.toContain('s-maxage');

    const buffer = await res.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);

    const mockCalls = (ImageResponse as unknown as jest.Mock).mock.calls;
    const [renderedElement] = mockCalls[mockCalls.length - 1];
    const serializedTree = JSON.stringify(renderedElement);

    expect(serializedTree).toContain('A & B');
    expect(serializedTree).toContain('Wedding Website');
    expect(serializedTree).not.toContain('Test');
    expect(serializedTree).not.toContain('Alice');
    expect(serializedTree).not.toContain('Bob');
    expect(serializedTree).not.toContain('June');
    expect(serializedTree).not.toContain('2026');
    expect(serializedTree).not.toContain('The Grand Ballroom');
    expect(serializedTree).not.toContain('New York');
    expect(serializedTree).not.toContain('#0000ff');
    expect(serializedTree).not.toContain('#00ff00');
  });

  it('renders full couple, date, and venue details with Cache-Control: private, max-age=3600 and Vary: Cookie when authenticated', async () => {
    const guestToken = await signGuestToken({
      guest: true,
      exp: Date.now() + 60_000,
    });
    const req = new NextRequest('http://localhost:3000/api/og', {
      headers: {
        cookie: `${GUEST_COOKIE}=${guestToken}`,
      },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(res.headers.get('vary')).toBe('Cookie');

    const buffer = await res.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);

    expect(ImageResponse).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        width: 1200,
        height: 630,
        fonts: expect.arrayContaining([
          expect.objectContaining({ name: 'LiberationSans', weight: 400 }),
          expect.objectContaining({ name: 'LiberationSans', weight: 700 }),
        ]),
      })
    );

    const mockCalls = (ImageResponse as unknown as jest.Mock).mock.calls;
    const serializedTree = JSON.stringify(mockCalls[mockCalls.length - 1][0]);
    expect(serializedTree).toContain("Alice & Bob's Wedding");
    expect(serializedTree).toContain('June 20, 2026');
    expect(serializedTree).toContain('The Grand Ballroom • New York • NY');
  });

  it('supports query parameter overrides for custom previews when authenticated', async () => {
    const guestToken = await signGuestToken({
      guest: true,
      exp: Date.now() + 60_000,
    });
    const req = new NextRequest(
      'http://localhost:3000/api/og?p1=Charlie&p2=Dana&primary=%230000ff&secondary=%2300ff00&title=Custom+Title',
      {
        headers: {
          cookie: `${GUEST_COOKIE}=${guestToken}`,
        },
      }
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(res.headers.get('vary')).toBe('Cookie');

    const mockCalls = (ImageResponse as unknown as jest.Mock).mock.calls;
    const serializedTree = JSON.stringify(mockCalls[mockCalls.length - 1][0]);
    expect(serializedTree).toContain('Charlie & Dana');
    expect(serializedTree).toContain('Custom Title');
  });

  it('enforces the 100-requests-per-minute rate limit across 105 rapid unauthenticated requests', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 105; i += 1) {
      const req = new NextRequest('http://localhost:3000/api/og', {
        headers: {
          'x-forwarded-for': '203.0.113.42',
        },
      });
      const res = await GET(req);
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 100).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(100)).toEqual([429, 429, 429, 429, 429]);
  });

  it('passes loaded font buffers asynchronously to ImageResponse without error', async () => {
    const req = new Request('http://localhost:3000/api/og');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const mockCalls = (ImageResponse as unknown as jest.Mock).mock.calls;
    const lastCall = mockCalls[mockCalls.length - 1];
    const options = lastCall[1];

    expect(options.fonts).toBeDefined();
    expect(options.fonts.length).toBe(2);
    expect(options.fonts[0].name).toBe('LiberationSans');
    expect(options.fonts[0].data.byteLength).toBeGreaterThan(0);
  });

  it('falls back gracefully when font files fail to load', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('fs/promises', () => ({
        readFile: jest.fn().mockRejectedValue(new Error('File not found')),
      }));
      const { GET: GETFallback } = await import('../route');

      const req = new Request('http://localhost:3000/api/og');
      const res = await GETFallback(req);

      expect(res.status).toBe(200);
      const mockCalls = (ImageResponse as unknown as jest.Mock).mock.calls;
      const lastCall = mockCalls[mockCalls.length - 1];
      const options = lastCall[1];

      expect(options.fonts).toBeUndefined();
    });
  });

  it('respects active themePreset configured in getAppConfig', async () => {
    (getAppConfig as jest.Mock).mockResolvedValueOnce({
      partner1Name: 'Alice',
      partner2Name: 'Bob',
      themePreset: 'romantic',
      colorPrimary: '#B91C1C',
      colorSecondary: '#B45309',
    });

    const req = new Request('http://localhost:3000/api/og');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(ImageResponse).toHaveBeenCalled();
  });
});


