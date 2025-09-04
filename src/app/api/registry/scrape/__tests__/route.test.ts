/** @jest-environment node */

/** @jest-environment node */

import { POST } from '@/app/api/registry/scrape/route';
import ogs from 'open-graph-scraper';

jest.mock('open-graph-scraper');
const ogsMock = ogs as jest.Mock;

describe('POST /api/registry/scrape', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should scrape an image from a URL even if it does not have an og:image tag', async () => {
    const testUrl = 'https://www.amazon.com/dp/B08C1F553M';

    ogsMock.mockResolvedValue({
      error: false,
      result: {
        ogTitle: 'Keurig K-Mini Coffee Maker',
        ogDescription: 'A great coffee maker.',
        twitterImage: [{ url: 'https://m.media-amazon.com/images/I/71+J6kR6D4L._AC_SX679_.jpg' }],
        success: true,
      },
    });

    // Create a mock request
    const request = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: testUrl }),
      headers: { 'Content-Type': 'application/json' },
    });

    // Call the endpoint
    const response = await POST(request);
    const body = await response.json();

    // Assertions
    expect(ogsMock).toHaveBeenCalledWith({
      url: testUrl,
      fetchOptions: {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
        },
      },
    });
    expect(response.status).toBe(200);
    expect(body.name).toBe('Keurig K-Mini Coffee Maker');
    expect(body.description).toBe('A great coffee maker.');
    expect(body.image).not.toBe(''); // This should fail initially, then pass after the fix.
  });
});
