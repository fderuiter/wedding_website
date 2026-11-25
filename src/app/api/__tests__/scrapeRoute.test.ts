/** @jest-environment node */

import { POST } from '../registry/scrape/route';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getAppConfig } from '@/lib/config';
import { DEFAULT_MODULE_CONFIG } from '@/lib/modules';
import type { NextRequest } from 'next/server';

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
}));

const mockIsAdminRequest = isAdminRequest as jest.Mock;
const mockGetAppConfig = getAppConfig as jest.Mock;

const fetchMock = jest.fn();
global.fetch = fetchMock;

describe('POST /api/registry/scrape', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAppConfig.mockResolvedValue({ modules: { ...DEFAULT_MODULE_CONFIG } });
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns 401 when user is not admin', async () => {
    mockIsAdminRequest.mockResolvedValue(false);

    const req = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/product' }),
    });

    const res = await POST(req as unknown as NextRequest);
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/product' }),
    });

    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({
      name: 'Mock Item',
      description: 'Mock Description',
      imageUrl: 'https://example.com/image.jpg',
      imageAlt: '',
      vendorUrl: 'https://example.com/product',
      quantity: 1,
      faviconUrl: 'https://example.com/favicon.ico',
    });
  });

  it('returns 400 when URL is empty', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const req = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: '' }),
    });

    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('URL is required');
  });

  it('returns classified URL_NOT_FOUND domain when scraping non-200 (e.g. 404) response', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    
    fetchMock.mockResolvedValue(new Response('Not Found', {
      status: 404,
      statusText: 'Not Found',
    }));

    const req = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/broken' }),
    });

    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toContain('URL_NOT_FOUND');
    expect(json.details.errorDomain).toBe('URL_NOT_FOUND');
    expect(console.error).toHaveBeenCalledWith('Scraping failed:', expect.any(Error));
  });

  it('returns classified NETWORK_TIMEOUT domain when fetch throws a network error', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const error = new Error('network error');
    fetchMock.mockRejectedValue(error);

    const req = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/error' }),
    });

    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toContain('NETWORK_TIMEOUT');
    expect(json.details.errorDomain).toBe('NETWORK_TIMEOUT');
    expect(console.error).toHaveBeenCalledWith('Scraping failed:', expect.any(Error));
  });

  it('returns 400 when URL resolves to a private or restricted IP address', async () => {
    mockIsAdminRequest.mockResolvedValue(true);

    const req = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1/sensitive-data' }),
    });

    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Blocked: URL resolves to a private or restricted IP address');
  });

  it('returns 400 when safeFetch detects too many redirects', async () => {
    mockIsAdminRequest.mockResolvedValue(true);

    // Setup redirect responses
    for (let i = 1; i <= 6; i++) {
      fetchMock.mockResolvedValueOnce(new Response('', {
        status: 302,
        headers: { location: `https://example.com/redirect${i}` },
      }));
    }

    const req = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/start' }),
    });

    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Blocked: Too many redirects (maximum of 5 hops allowed)');
  });

  it('returns 404 when registry feature module is disabled', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    mockGetAppConfig.mockResolvedValueOnce({
      modules: { ...DEFAULT_MODULE_CONFIG, registry: false, groupGifting: false },
    });

    const req = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/product' }),
    });

    const res = await POST(req as unknown as NextRequest);
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain("Feature 'registry' is disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks non-canonical IPv6, NAT64, and benchmarking literals with 400 before fetching', async () => {
    mockIsAdminRequest.mockResolvedValue(true);

    for (const blockedUrl of [
      'http://[0:0:0:0:0:0:0:1]/admin',
      'http://[0:0:0:0:0:ffff:127.0.0.1]/admin',
      'http://[64:ff9b::a9fe:a9fe]/latest/meta-data',
      'http://198.18.0.1/internal',
    ]) {
      const req = new Request('http://localhost/api/registry/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: blockedUrl }),
      });

      const res = await POST(req as unknown as NextRequest);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Blocked: URL resolves to a private or restricted IP address');
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects oversized HTML responses exceeding 1 MiB via Content-Length or chunked stream with 422 NETWORK_TIMEOUT', async () => {
    mockIsAdminRequest.mockResolvedValue(true);

    fetchMock.mockResolvedValueOnce(
      new Response('<html></html>', {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Content-Length': String(2 * 1024 * 1024),
        },
      })
    );

    const headerReq = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/huge-header' }),
    });
    const headerRes = await POST(headerReq as unknown as NextRequest);
    expect(headerRes.status).toBe(422);
    const headerJson = await headerRes.json();
    expect(headerJson.details.errorDomain).toBe('NETWORK_TIMEOUT');
    expect(headerJson.error).toContain('Response body exceeded maximum size of 1048576 bytes');

    let streamCancelled = false;
    const chunk = new Uint8Array(300 * 1024).fill(0x61);
    const infiniteHtmlStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
      cancel() {
        streamCancelled = true;
      },
    });
    fetchMock.mockResolvedValueOnce(
      new Response(infiniteHtmlStream, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );

    const streamReq = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/huge-stream' }),
    });
    const streamRes = await POST(streamReq as unknown as NextRequest);
    expect(streamRes.status).toBe(422);
    const streamJson = await streamRes.json();
    expect(streamJson.details.errorDomain).toBe('NETWORK_TIMEOUT');
    expect(streamCancelled).toBe(true);
  });
});
