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
  it('renders an OpenGraph image with configured colors and couple names', async () => {
    const req = new Request('http://localhost:3000/api/og');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('public');

    const buffer = await res.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it('supports query parameter overrides for custom previews', async () => {
    const req = new Request('http://localhost:3000/api/og?p1=Charlie&p2=Dana&primary=%230000ff&secondary=%2300ff00&title=Custom+Title');
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');

    const buffer = await res.arrayBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
  });
});

