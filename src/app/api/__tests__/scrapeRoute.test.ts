/** @jest-environment node */

import { POST } from '../registry/scrape/route';
import { isAdminRequest } from '@/utils/adminAuth.server';

jest.mock('@/utils/adminAuth.server', () => ({
  isAdminRequest: jest.fn(),
}));

const mockIsAdminRequest = isAdminRequest as jest.Mock;

const fetchMock = jest.fn();
global.fetch = fetchMock;

describe('POST /api/registry/scrape', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns 401 when user is not admin', async () => {
    mockIsAdminRequest.mockResolvedValue(false);

    const req = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/product' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  it('returns scraped metadata for valid URL when admin', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    
    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta property="og:title" content="Mock Item" />
          <meta property="og:description" content="Mock Description" />
          <meta property="og:image" content="https://example.com/image.jpg" />
        </head>
        <body></body>
      </html>
    `;
    fetchMock.mockResolvedValue(new Response(mockHtml, {
      headers: { 'Content-Type': 'text/html' },
    }));

    const req = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/product' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({
      name: 'Mock Item',
      description: 'Mock Description',
      image: 'https://example.com/image.jpg',
      vendorUrl: 'https://example.com/product',
      quantity: 1,
    });
  });

  it('returns 400 when URL is empty', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: '' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('URL is required');
  });

  it('returns 500 when scraping fails (e.g. response not ok)', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    
    fetchMock.mockResolvedValue(new Response('Not Found', {
      status: 404,
      statusText: 'Not Found',
    }));

    const req = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/broken' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('Failed to fetch the provided URL');
    expect(console.error).toHaveBeenCalledWith('Scraping failed:', expect.any(Error));
  });

  it('returns 500 when an unexpected error occurs (e.g. fetch throws)', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const error = new Error('network error');
    fetchMock.mockRejectedValue(error);

    const req = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/error' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('Failed to scrape product info');
    expect(console.error).toHaveBeenCalledWith('Scraping failed:', error);
  });
});
