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

  it('should correctly scrape an Amazon image using the simplified fallback selector', async () => {
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

    // Mock the raw HTML fetch for the new fallback mechanism
    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <div id="imgTagWrapperId">
            <img src="${expectedImageUrl}" />
          </div>
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
    // This assertion will now pass with the simplified logic
    expect(body.image).toBe(expectedImageUrl);
  });

  it('should return an empty image string if the Amazon fallback fails to find the element', async () => {
    const amazonUrl = 'https://www.amazon.com/dp/B09XYZ1234';

    // Simulate OGS failing to find an image
    ogsMock.mockResolvedValue({
      error: false,
      result: {
        ogTitle: 'A Different Product',
        ogDescription: 'Another great product.',
        ogImage: [],
        twitterImage: [],
        success: true,
      },
    });

    // Mock HTML that does NOT contain the target selector
    const mockHtml = `
      <!DOCTYPE html>
      <html>
        <body>
          <div id="some-other-wrapper">
            <img src="https://m.media-amazon.com/images/I/WRONG_IMAGE.jpg" />
          </div>
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
    expect(body.name).toBe('A Different Product');
    // Should be empty since the fallback selector was not found
    expect(body.image).toBe('');
  });
});
