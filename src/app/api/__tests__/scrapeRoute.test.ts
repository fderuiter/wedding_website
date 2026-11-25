/** @jest-environment node */

import { POST } from '../registry/scrape/route';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getAppConfig } from '@/lib/config';
import { DEFAULT_MODULE_CONFIG } from '@/lib/modules';
import { parse } from 'node-html-parser';
import type { NextRequest } from 'next/server';

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

jest.mock('@/lib/config', () => {
  const actual = jest.requireActual('@/lib/config');
  return {
    ...actual,
    getAppConfig: jest.fn(actual.getAppConfig),
  };
});

jest.mock('node-html-parser', () => {
  const actual = jest.requireActual('node-html-parser');
  return {
    ...actual,
    parse: jest.fn(actual.parse),
  };
});

const mockIsAdminRequest = isAdminRequest as jest.Mock;
const mockGetAppConfig = getAppConfig as jest.MockedFunction<typeof getAppConfig>;
const mockParseHtml = parse as jest.MockedFunction<typeof parse>;

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

  it('returns 404 when the registry feature module is disabled', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const baseConfig = await mockGetAppConfig();
    mockGetAppConfig.mockResolvedValueOnce({
      ...baseConfig,
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
    expect(json.error).toBe("Feature 'registry' is disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enforces 1 MiB HTML byte limit on POST /api/registry/scrape before node-html-parser runs', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const maxHtmlBytes = 1024 * 1024;

    // 1. Oversized Content-Length header rejected immediately
    fetchMock.mockResolvedValueOnce(
      new Response('<html></html>', {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Content-Length': String(maxHtmlBytes + 1),
        },
      })
    );

    const headerReq = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://93.184.216.34/oversized-header' }),
    });
    const headerRes = await POST(headerReq as unknown as NextRequest);
    expect(headerRes.status).toBe(422);
    const headerJson = await headerRes.json();
    expect(headerJson.details.errorDomain).toBe('NETWORK_TIMEOUT');
    expect(mockParseHtml).not.toHaveBeenCalled();

    // 2. Chunked stream exceeding 1 MiB without Content-Length stops mid-stream before parse()
    let chunksPulled = 0;
    const chunkPayload = new Uint8Array(256 * 1024).fill(65);
    fetchMock.mockImplementationOnce(() => {
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            chunksPulled += 1;
            controller.enqueue(chunkPayload);
            if (chunksPulled >= 10) {
              controller.close();
            }
          },
        },
        { highWaterMark: 0 }
      );
      return Promise.resolve(
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        })
      );
    });

    const streamReq = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://93.184.216.34/oversized-stream' }),
    });
    const streamRes = await POST(streamReq as unknown as NextRequest);
    expect(streamRes.status).toBe(422);
    const streamJson = await streamRes.json();
    expect(streamJson.details.errorDomain).toBe('NETWORK_TIMEOUT');
    expect(chunksPulled).toBe(5);
    expect(mockParseHtml).not.toHaveBeenCalled();
  });
});
