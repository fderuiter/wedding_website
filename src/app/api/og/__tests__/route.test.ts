import { ImageResponse } from 'next/og';
import { GET } from '../route';

jest.mock('next/og', () => {
  return {
    ImageResponse: jest.fn().mockImplementation((element, options) => {
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

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    partner1Name: 'Alice',
    partner2Name: 'Bob',
    brideName: 'Alice',
    groomName: 'Bob',
    seoTitle: "Alice & Bob's Wedding",
    colorPrimary: '#B91C1C',
    colorSecondary: '#B45309',
    weddingDate: new Date('2026-06-20T16:00:00.000Z'),
    venueName: 'The Grand Ballroom',
    venueCity: 'New York',
    venueState: 'NY',
  }),
}));

describe('/api/og route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders an OpenGraph image with configured colors and couple names', async () => {
    const req = new Request('http://localhost:3000/api/og');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('public');

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
  });

  it('supports query parameter overrides for custom previews', async () => {
    const req = new Request('http://localhost:3000/api/og?p1=Charlie&p2=Dana&primary=%230000ff&secondary=%2300ff00&title=Custom+Title');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');

    const buffer = await res.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it('passes loaded font buffers asynchronously to ImageResponse without error', async () => {
    const req = new Request('http://localhost:3000/api/og');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const mockCalls = (ImageResponse as jest.Mock).mock.calls;
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
      const mockCalls = (ImageResponse as jest.Mock).mock.calls;
      const lastCall = mockCalls[mockCalls.length - 1];
      const options = lastCall[1];

      expect(options.fonts).toBeUndefined();
    });
  });
});


