/** @jest-environment node */

jest.mock('node-fetch', () => {
  class FetchError extends Error {}
  return { __esModule: true, default: jest.fn(), FetchError };
});
jest.mock('metascraper', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('metascraper-title', () => jest.fn());
jest.mock('metascraper-description', () => jest.fn());
jest.mock('metascraper-image', () => jest.fn());

import fetch from 'node-fetch';
import metascraper from 'metascraper';

const mockFetch = fetch as jest.Mock;
const mockMetadata = {
  title: 'Mock Item',
  description: 'Mock Description',
  image: 'https://example.com/image.jpg',
};
const mockScraper = jest.fn().mockResolvedValue(mockMetadata);
(metascraper as jest.Mock).mockReturnValue(mockScraper);

let POST: typeof import('../registry/scrape/route').POST;

beforeAll(async () => {
  ({ POST } = await import('../registry/scrape/route'));
});

describe('POST /api/registry/scrape', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns scraped metadata for valid URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue('<html></html>'),
    });

    const req = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/product' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(
      expect.objectContaining({
        name: mockMetadata.title,
        description: mockMetadata.description,
        image: mockMetadata.image,
        vendorUrl: 'https://example.com/product',
      })
    );
  });

  it('returns 400 when URL is empty', async () => {
    const req = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: '' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('URL is required');
  });

  it('returns 400 when fetch responds with client error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const req = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/broken' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Failed to fetch');
  });

  it('returns 502 when network error occurs', async () => {
    const { FetchError } = await import('node-fetch');
    mockFetch.mockRejectedValue(new FetchError('network error'));

    const req = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/error' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toContain('network error');
  });
});
