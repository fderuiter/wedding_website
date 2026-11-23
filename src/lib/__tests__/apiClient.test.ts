import { ApiClient } from '../apiClient';

describe('ApiClient subpath resolution', () => {
  const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
  const originalFetch = global.fetch;

  afterEach(() => {
    if (originalBasePath === undefined) {
      delete process.env.NEXT_PUBLIC_BASE_PATH;
    } else {
      process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
    }
    global.fetch = originalFetch;
  });

  it('prepends NEXT_PUBLIC_BASE_PATH to root-relative API requests without double-prefixing', async () => {
    process.env.NEXT_PUBLIC_BASE_PATH = '/wedding_website/demo';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true, data: { ok: true } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new ApiClient();
    await client.get('/api/registry');
    await client.post('/wedding_website/demo/api/registry', { amount: 50 });
    await client.get('https://api.example.com/health');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/wedding_website/demo/api/registry',
      expect.objectContaining({ method: 'GET' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/wedding_website/demo/api/registry',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://api.example.com/health',
      expect.objectContaining({ method: 'GET' })
    );
  });
});
