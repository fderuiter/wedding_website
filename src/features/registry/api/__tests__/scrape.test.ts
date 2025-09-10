/** @jest-environment node */

import { POST } from '@/app/api/registry/scrape/route';
import ogs from 'open-graph-scraper';

// Mock open-graph-scraper
jest.mock('open-graph-scraper');
const ogsMock = ogs as jest.Mock;

// Mock native fetch
const fetchMock = jest.fn();
global.fetch = fetchMock;

describe('POST /api/registry/scrape', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return an empty image string when ogs fails and the URL is not from Amazon', async () => {
    const testUrl = 'https://www.example.com';
    ogsMock.mockResolvedValue({
      error: false,
      result: {
        ogTitle: 'Example Site',
        ogDescription: 'An example site.',
        ogImage: [], // No image found
        success: true,
      },
    });

    const request = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: testUrl }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.name).toBe('Example Site');
    expect(body.image).toBe(''); // Expect empty image
  });

  it('should fail to get an image for an Amazon URL when ogs finds no image (demonstrates the bug)', async () => {
    const amazonUrl = 'https://www.amazon.com/dp/B08C1F553M';
    const expectedImageUrl = 'https://m.media-amazon.com/images/I/CORRECT_IMAGE.jpg';

    // Simulate open-graph-scraper failing to find an image
    ogsMock.mockResolvedValue({
      error: false,
      result: {
        ogTitle: 'Keurig K-Mini Coffee Maker',
        ogDescription: 'A great coffee maker.',
        ogImage: [], // Simulate no OG image
        twitterImage: [], // Simulate no Twitter image
        success: true,
      },
    });

    // Mock the raw HTML fetch for the fallback mechanism
    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <img id="landingImage" src="${expectedImageUrl}" />
        </body>
      </html>
    `;
    fetchMock.mockResolvedValue(new Response(mockHtml, {
      headers: { 'Content-Type': 'text/html' },
    }));


    const request = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: amazonUrl }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.name).toBe('Keurig K-Mini Coffee Maker');
    // This assertion will fail initially because the fallback logic is not implemented.
    // After the fix, it should pass by extracting the URL from the mocked HTML.
    expect(body.image).toBe(expectedImageUrl);
  });

  it('should correctly scrape an Amazon image using the data-a-dynamic-image attribute', async () => {
    const amazonUrl = 'https://www.amazon.com/dp/B08C1F553M';
    const expectedImageUrl = 'https://m.media-amazon.com/images/I/ACTUAL_IMAGE.jpg';

    ogsMock.mockResolvedValue({
      error: false,
      result: {
        ogTitle: 'Keurig K-Mini Coffee Maker',
        ogDescription: 'A great coffee maker.',
        ogImage: [],
        twitterImage: [],
        success: true,
      },
    });

    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <img id="landingImage" data-a-dynamic-image='{"${expectedImageUrl}":[349,350],"https://m.media-amazon.com/images/I/OTHER_IMAGE.jpg":[500,500]}' />
        </body>
      </html>
    `;
    fetchMock.mockResolvedValue(new Response(mockHtml, {
      headers: { 'Content-Type': 'text/html' },
    }));

    const request = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: amazonUrl }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.image).toBe(expectedImageUrl);
  });
});
