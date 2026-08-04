/** @jest-environment node */

import { POST } from '@/app/api/registry/scrape/route';
import { isAdminRequest } from '@/core/auth/auth.server';
import { server } from '@/mocks/server';
import { rest } from 'msw';

// Mock DNS for SSRF check
jest.mock('dns', () => {
  const originalDns = jest.requireActual('dns');
  return {
    promises: {
      lookup: jest.fn().mockImplementation(async (hostname, options) => {
        if (process.env.LIVE_TESTS === 'true') {
          return originalDns.promises.lookup(hostname, options);
        }
        return { address: '93.184.216.34', family: 4 };
      }),
    },
  };
});

// Mock admin auth
jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

const mockIsAdminRequest = isAdminRequest as jest.Mock;

const runIfMock = process.env.LIVE_TESTS !== 'true' ? it : it.skip;
const runIfLive = process.env.LIVE_TESTS === 'true' ? it : it.skip;

describe('POST /api/registry/scrape', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(true);
  });

  runIfMock('should return an empty image string when no image tags exist and the URL is not from Amazon', async () => {
    const testUrl = 'https://www.example.com';
    
    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta property="og:title" content="Example Site" />
          <meta property="og:description" content="An example site." />
        </head>
        <body></body>
      </html>
    `;
    server.use(
      rest.get('https://www.example.com/', (_req, res, ctx) => {
        return res(
          ctx.set('Content-Type', 'text/html'),
          ctx.body(mockHtml)
        );
      })
    );

    const request = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: testUrl }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.name).toBe('Example Site');
    expect(body.data.imageUrl).toBe(''); // Expect empty image
  });

  runIfMock('should correctly scrape an Amazon image using the simplified fallback selector', async () => {
    const amazonUrl = 'https://www.amazon.com/dp/B08C1F553M';
    const expectedImageUrl = 'https://m.media-amazon.com/images/I/CORRECT_IMAGE.jpg';

    // Mock the raw HTML fetch for the new fallback mechanism
    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta property="og:title" content="Keurig K-Mini Coffee Maker" />
          <meta property="og:description" content="A great coffee maker." />
        </head>
        <body>
          <div id="imgTagWrapperId">
            <img src="${expectedImageUrl}" />
          </div>
        </body>
      </html>
    `;
    server.use(
      rest.get('https://www.amazon.com/dp/B08C1F553M', (_req, res, ctx) => {
        return res(
          ctx.set('Content-Type', 'text/html'),
          ctx.body(mockHtml)
        );
      })
    );

    const request = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: amazonUrl }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.name).toBe('Keurig K-Mini Coffee Maker');
    expect(body.data.imageUrl).toBe(expectedImageUrl);
  });

  runIfMock('should return an empty image string if the Amazon fallback fails to find the element', async () => {
    const amazonUrl = 'https://www.amazon.com/dp/B09XYZ1234';

    // Mock HTML that does NOT contain the target selector
    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta property="og:title" content="A Different Product" />
          <meta property="og:description" content="Another great product." />
        </head>
        <body>
          <div id="some-other-wrapper">
            <img src="https://m.media-amazon.com/images/I/WRONG_IMAGE.jpg" />
          </div>
        </body>
      </html>
    `;
    server.use(
      rest.get('https://www.amazon.com/dp/B09XYZ1234', (_req, res, ctx) => {
        return res(
          ctx.set('Content-Type', 'text/html'),
          ctx.body(mockHtml)
        );
      })
    );

    const request = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: amazonUrl }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.name).toBe('A Different Product');
    // Should be empty since the fallback selector was not found
    expect(body.data.imageUrl).toBe('');
  });

  runIfMock('should parse details from standard JSON-LD product payload', async () => {
    const testUrl = 'https://www.example.com/jsonld-simple';
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      'name': 'JSON-LD Simple Product',
      'description': 'Simple description from JSON-LD',
      'image': 'https://example.com/simple-product.jpg'
    };

    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <script type="application/ld+json">
            ${JSON.stringify(jsonLd)}
          </script>
        </head>
        <body></body>
      </html>
    `;

    server.use(
      rest.get(testUrl, (_req, res, ctx) => {
        return res(
          ctx.set('Content-Type', 'text/html'),
          ctx.body(mockHtml)
        );
      })
    );

    const request = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: testUrl }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.name).toBe('JSON-LD Simple Product');
    expect(body.data.description).toBe('Simple description from JSON-LD');
    expect(body.data.imageUrl).toBe('https://example.com/simple-product.jpg');
  });

  runIfMock('should parse details from nested `@graph` in JSON-LD payload', async () => {
    const testUrl = 'https://www.example.com/jsonld-graph';
    const jsonLd = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'BreadcrumbList',
          'itemListElement': []
        },
        {
          '@type': 'Product',
          'name': 'JSON-LD Graph Product',
          'description': 'Graph description',
          'image': {
            '@type': 'ImageObject',
            'url': 'https://example.com/graph-product.jpg',
            'caption': 'Graph Product Image Caption'
          }
        }
      ]
    };

    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <script type="application/ld+json">
            ${JSON.stringify(jsonLd)}
          </script>
        </head>
        <body></body>
      </html>
    `;

    server.use(
      rest.get(testUrl, (_req, res, ctx) => {
        return res(
          ctx.set('Content-Type', 'text/html'),
          ctx.body(mockHtml)
        );
      })
    );

    const request = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: testUrl }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.name).toBe('JSON-LD Graph Product');
    expect(body.data.description).toBe('Graph description');
    expect(body.data.imageUrl).toBe('https://example.com/graph-product.jpg');
    expect(body.data.imageAlt).toBe('Graph Product Image Caption');
  });

  runIfMock('should parse details from JSON-LD with array of images', async () => {
    const testUrl = 'https://www.example.com/jsonld-images-array';
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      'name': 'Array of Images Product',
      'description': 'Array description',
      'image': [
        'https://example.com/img1.jpg',
        'https://example.com/img2.jpg'
      ]
    };

    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <script type="application/ld+json">
            ${JSON.stringify(jsonLd)}
          </script>
        </head>
        <body></body>
      </html>
    `;

    server.use(
      rest.get(testUrl, (_req, res, ctx) => {
        return res(
          ctx.set('Content-Type', 'text/html'),
          ctx.body(mockHtml)
        );
      })
    );

    const request = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: testUrl }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.name).toBe('Array of Images Product');
    expect(body.data.imageUrl).toBe('https://example.com/img1.jpg');
  });

  runIfMock('should gracefully handle malformed JSON-LD syntax and fall back to regular tags', async () => {
    const testUrl = 'https://www.example.com/jsonld-malformed';

    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta property="og:title" content="Fallback Metadata Product" />
          <meta property="og:description" content="Fallback description" />
          <meta property="og:image" content="https://example.com/fallback.jpg" />
          <script type="application/ld+json">
            { "malformed JSON-LD: [ "missing bracket" }
          </script>
        </head>
        <body></body>
      </html>
    `;

    server.use(
      rest.get(testUrl, (_req, res, ctx) => {
        return res(
          ctx.set('Content-Type', 'text/html'),
          ctx.body(mockHtml)
        );
      })
    );

    const request = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: testUrl }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.name).toBe('Fallback Metadata Product');
    expect(body.data.description).toBe('Fallback description');
    expect(body.data.imageUrl).toBe('https://example.com/fallback.jpg');
  });

  it('should block private/loopback addresses under SSRF protection even if in live test mode', async () => {
    const originalEnvLiveTests = process.env.LIVE_TESTS;
    try {
      process.env.LIVE_TESTS = 'true';
      const testUrl = 'http://127.0.0.1:5432/some-internal-path';

      const request = new Request('http://localhost/api/registry/scrape', {
        method: 'POST',
        body: JSON.stringify({ url: testUrl }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Blocked: URL resolves to a private or restricted IP address');
    } finally {
      process.env.LIVE_TESTS = originalEnvLiveTests;
    }
  });

  runIfLive('should perform genuine outbound calls to actual public websites in live mode', async () => {
    const testUrl = 'https://www.example.com';
    const request = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: testUrl }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.name).toContain('Example Domain');
  });
});
