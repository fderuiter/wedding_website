/** @jest-environment node */

import { POST } from '@/app/api/registry/scrape/route';
import { parsePrice } from '../scrape';
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

  runIfMock('should return an empty image string and extract favicon when no image tags exist and the URL is not from Amazon', async () => {
    const testUrl = 'https://www.example.com';
    
    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta property="og:title" content="Example Site" />
          <meta property="og:description" content="An example site." />
          <link rel="icon" href="/assets/favicon.ico" />
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
    expect(body.data.faviconUrl).toBe('https://www.example.com/assets/favicon.ico');
  });

  runIfMock('should correctly scrape Target products using Target selectors', async () => {
    const targetUrl = 'https://www.target.com/p/sample-item/-/A-12345678';
    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head></head>
        <body>
          <h1 data-test="product-title">Target Stand Mixer</h1>
          <div data-test="item-details-description">High quality kitchen mixer</div>
          <div data-test="product-image">
            <img src="https://target.scene7.com/is/image/Target/GUEST_123" alt="Target Mixer" />
          </div>
        </body>
      </html>
    `;
    server.use(
      rest.get(targetUrl, (_req, res, ctx) => {
        return res(
          ctx.set('Content-Type', 'text/html'),
          ctx.body(mockHtml)
        );
      })
    );

    const request = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: targetUrl }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.name).toBe('Target Stand Mixer');
    expect(body.data.description).toBe('High quality kitchen mixer');
    expect(body.data.imageUrl).toBe('https://target.scene7.com/is/image/Target/GUEST_123');
  });

  runIfMock('should correctly scrape Costco products using Costco selectors', async () => {
    const costcoUrl = 'https://www.costco.com/sample-product.product.100123.html';
    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <head></head>
        <body>
          <h1 data-qa="product-title">Costco Blender Set</h1>
          <div id="product-description">Multi-speed counter blender</div>
          <img id="initialLoadedImage" src="https://images.costco-static.com/item123.jpg" alt="Costco Blender" />
        </body>
      </html>
    `;
    server.use(
      rest.get(costcoUrl, (_req, res, ctx) => {
        return res(
          ctx.set('Content-Type', 'text/html'),
          ctx.body(mockHtml)
        );
      })
    );

    const request = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: costcoUrl }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.name).toBe('Costco Blender Set');
    expect(body.data.description).toBe('Multi-speed counter blender');
    expect(body.data.imageUrl).toBe('https://images.costco-static.com/item123.jpg');
  });

  runIfMock('should classify 403 response into BLOCKED_BY_VENDOR error domain', async () => {
    const costcoUrl = 'https://www.costco.com/blocked-product';
    server.use(
      rest.get(costcoUrl, (_req, res, ctx) => {
        return res(ctx.status(403));
      })
    );

    const request = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: costcoUrl }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toContain('BLOCKED_BY_VENDOR');
    expect(body.details.errorDomain).toBe('BLOCKED_BY_VENDOR');
  });

  runIfMock('should classify 404 response into URL_NOT_FOUND error domain', async () => {
    const testUrl = 'https://www.example.com/missing-404';
    server.use(
      rest.get(testUrl, (_req, res, ctx) => {
        return res(ctx.status(404));
      })
    );

    const request = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: testUrl }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toContain('URL_NOT_FOUND');
    expect(body.details.errorDomain).toBe('URL_NOT_FOUND');
  });

  runIfMock('should classify network error into NETWORK_TIMEOUT error domain', async () => {
    const testUrl = 'https://www.example.com/network-error';
    server.use(
      rest.get(testUrl, (_req, res) => {
        return res.networkError('Failed to connect');
      })
    );

    const request = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: testUrl }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.error).toContain('NETWORK_TIMEOUT');
    expect(body.details.errorDomain).toBe('NETWORK_TIMEOUT');
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

  describe('parsePrice helper unit tests', () => {
    it('should sanitize currency strings with symbols and commas', () => {
      expect(parsePrice('$1,299.99')).toBe(1299.99);
      expect(parsePrice('29.99 USD')).toBe(29.99);
      expect(parsePrice('£15.50')).toBe(15.5);
      expect(parsePrice(' 49.99 ')).toBe(49.99);
      expect(parsePrice('$0.99')).toBe(0.99);
    });

    it('should handle numeric input', () => {
      expect(parsePrice(19.99)).toBe(19.99);
      expect(parsePrice(100)).toBe(100);
    });

    it('should ignore malformed, zero, negative, or empty input', () => {
      expect(parsePrice('0')).toBeUndefined();
      expect(parsePrice(0)).toBeUndefined();
      expect(parsePrice('$0.00')).toBeUndefined();
      expect(parsePrice('-10.50')).toBeUndefined();
      expect(parsePrice('Free')).toBeUndefined();
      expect(parsePrice('N/A')).toBeUndefined();
      expect(parsePrice('')).toBeUndefined();
      expect(parsePrice(null)).toBeUndefined();
      expect(parsePrice(undefined)).toBeUndefined();
      expect(parsePrice(NaN)).toBeUndefined();
    });
  });

  describe('Multi-tier price extraction in scrape API', () => {
    runIfMock('should extract price from JSON-LD offers object with price string', async () => {
      const testUrl = 'https://www.example.com/jsonld-price';
      const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        'name': 'JSON-LD Price Item',
        'offers': {
          '@type': 'Offer',
          'price': '$89.99',
          'priceCurrency': 'USD'
        }
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
        rest.get(testUrl, (_req, res, ctx) => res(ctx.set('Content-Type', 'text/html'), ctx.body(mockHtml)))
      );

      const request = new Request('http://localhost/api/registry/scrape', {
        method: 'POST',
        body: JSON.stringify({ url: testUrl }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.price).toBe(89.99);
    });

    runIfMock('should extract price from JSON-LD AggregateOffer lowPrice', async () => {
      const testUrl = 'https://www.example.com/jsonld-lowprice';
      const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        'name': 'Aggregate Item',
        'offers': {
          '@type': 'AggregateOffer',
          'lowPrice': '19.99',
          'highPrice': '49.99'
        }
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
        rest.get(testUrl, (_req, res, ctx) => res(ctx.set('Content-Type', 'text/html'), ctx.body(mockHtml)))
      );

      const request = new Request('http://localhost/api/registry/scrape', {
        method: 'POST',
        body: JSON.stringify({ url: testUrl }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.price).toBe(19.99);
    });

    runIfMock('should extract price from JSON-LD priceSpecification.price', async () => {
      const testUrl = 'https://www.example.com/jsonld-pricespec';
      const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        'name': 'Price Spec Item',
        'offers': {
          '@type': 'Offer',
          'priceSpecification': {
            '@type': 'UnitPriceSpecification',
            'price': '45.00'
          }
        }
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
        rest.get(testUrl, (_req, res, ctx) => res(ctx.set('Content-Type', 'text/html'), ctx.body(mockHtml)))
      );

      const request = new Request('http://localhost/api/registry/scrape', {
        method: 'POST',
        body: JSON.stringify({ url: testUrl }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.price).toBe(45);
    });

    runIfMock('should extract price from OpenGraph og:price:amount when JSON-LD is absent', async () => {
      const testUrl = 'https://www.example.com/og-price';
      const mockHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta property="og:title" content="OG Price Product" />
            <meta property="og:price:amount" content="34.50" />
            <meta property="og:price:currency" content="USD" />
          </head>
          <body></body>
        </html>
      `;

      server.use(
        rest.get(testUrl, (_req, res, ctx) => res(ctx.set('Content-Type', 'text/html'), ctx.body(mockHtml)))
      );

      const request = new Request('http://localhost/api/registry/scrape', {
        method: 'POST',
        body: JSON.stringify({ url: testUrl }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.price).toBe(34.5);
    });

    runIfMock('should extract price from product:price:amount as fallback', async () => {
      const testUrl = 'https://www.example.com/product-price';
      const mockHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta property="og:title" content="Product Tag Price Item" />
            <meta property="product:price:amount" content="55.00" />
          </head>
          <body></body>
        </html>
      `;

      server.use(
        rest.get(testUrl, (_req, res, ctx) => res(ctx.set('Content-Type', 'text/html'), ctx.body(mockHtml)))
      );

      const request = new Request('http://localhost/api/registry/scrape', {
        method: 'POST',
        body: JSON.stringify({ url: testUrl }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.price).toBe(55);
    });

    runIfMock('should extract price from twitter:data1 when twitter:label1 is price', async () => {
      const testUrl = 'https://www.example.com/twitter-price';
      const mockHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta property="og:title" content="Twitter Price Item" />
            <meta name="twitter:label1" content="Price" />
            <meta name="twitter:data1" content="$25.99" />
          </head>
          <body></body>
        </html>
      `;

      server.use(
        rest.get(testUrl, (_req, res, ctx) => res(ctx.set('Content-Type', 'text/html'), ctx.body(mockHtml)))
      );

      const request = new Request('http://localhost/api/registry/scrape', {
        method: 'POST',
        body: JSON.stringify({ url: testUrl }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.price).toBe(25.99);
    });

    runIfMock('should extract price from Amazon DOM element .a-price .a-offscreen', async () => {
      const testUrl = 'https://www.amazon.com/dp/B08C1F553M-PRICE';
      const mockHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta property="og:title" content="Amazon Price Item" />
          </head>
          <body>
            <span class="a-price"><span class="a-offscreen">$149.99</span></span>
          </body>
        </html>
      `;

      server.use(
        rest.get(testUrl, (_req, res, ctx) => res(ctx.set('Content-Type', 'text/html'), ctx.body(mockHtml)))
      );

      const request = new Request('http://localhost/api/registry/scrape', {
        method: 'POST',
        body: JSON.stringify({ url: testUrl }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.price).toBe(149.99);
    });

    runIfMock('should respect multi-tier priority (JSON-LD > og:price:amount > product:price:amount)', async () => {
      const testUrl = 'https://www.example.com/multi-tier-priority';
      const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        'name': 'Multi-Tier Item',
        'offers': {
          '@type': 'Offer',
          'price': '99.00'
        }
      };

      const mockHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <script type="application/ld+json">
              ${JSON.stringify(jsonLd)}
            </script>
            <meta property="og:price:amount" content="88.00" />
            <meta property="product:price:amount" content="77.00" />
          </head>
          <body>
            <span class="a-price"><span class="a-offscreen">$66.00</span></span>
          </body>
        </html>
      `;

      server.use(
        rest.get(testUrl, (_req, res, ctx) => res(ctx.set('Content-Type', 'text/html'), ctx.body(mockHtml)))
      );

      const request = new Request('http://localhost/api/registry/scrape', {
        method: 'POST',
        body: JSON.stringify({ url: testUrl }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.price).toBe(99.00);
    });

    runIfMock('should omit price property when price metadata is absent or invalid', async () => {
      const testUrl = 'https://www.example.com/no-price';
      const mockHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta property="og:title" content="Priceless Item" />
            <meta property="og:price:amount" content="$0.00" />
          </head>
          <body></body>
        </html>
      `;

      server.use(
        rest.get(testUrl, (_req, res, ctx) => res(ctx.set('Content-Type', 'text/html'), ctx.body(mockHtml)))
      );

      const request = new Request('http://localhost/api/registry/scrape', {
        method: 'POST',
        body: JSON.stringify({ url: testUrl }),
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.price).toBeUndefined();
    });
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
