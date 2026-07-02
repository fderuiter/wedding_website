/** @jest-environment node */

import { POST } from '@/app/api/registry/scrape/route';
import { isAdminRequest } from '@/utils/adminAuth.server';
import { server } from '@/mocks/server';
import { rest } from 'msw';

// Mock DNS for SSRF check
jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn().mockResolvedValue({ address: '93.184.216.34', family: 4 }),
  },
}));

// Mock admin auth
jest.mock('@/utils/adminAuth.server', () => ({
  isAdminRequest: jest.fn(),
}));

const mockIsAdminRequest = isAdminRequest as jest.Mock;

describe('POST /api/registry/scrape', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(true);
  });

  it('should return an empty image string when no image tags exist and the URL is not from Amazon', async () => {
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
      rest.get('https://www.example.com/', (req, res, ctx) => {
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
    expect(body.data.image).toBe(''); // Expect empty image
  });

  it('should correctly scrape an Amazon image using the simplified fallback selector', async () => {
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
      rest.get('https://www.amazon.com/dp/B08C1F553M', (req, res, ctx) => {
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
    expect(body.data.image).toBe(expectedImageUrl);
  });

  it('should return an empty image string if the Amazon fallback fails to find the element', async () => {
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
      rest.get('https://www.amazon.com/dp/B09XYZ1234', (req, res, ctx) => {
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
    expect(body.data.image).toBe('');
  });
});
