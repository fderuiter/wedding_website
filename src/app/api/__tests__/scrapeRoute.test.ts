/** @jest-environment node */

import { POST } from '../registry/scrape/route';
import ogs from 'open-graph-scraper';
import { isAdminRequest } from '@/utils/adminAuth.server';

jest.mock('open-graph-scraper');
jest.mock('@/utils/adminAuth.server', () => ({
  isAdminRequest: jest.fn(),
}));

const mockOgs = ogs as jest.Mock;
const mockIsAdminRequest = isAdminRequest as jest.Mock;

describe('POST /api/registry/scrape', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    mockOgs.mockResolvedValue({
      error: false,
      result: {
        ogTitle: 'Mock Item',
        ogDescription: 'Mock Description',
        ogImage: [{ url: 'https://example.com/image.jpg' }],
        success: true,
      },
    });

    const req = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/product' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({
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

  it('returns 500 when scraping fails', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    mockOgs.mockResolvedValue({
      error: true,
      result: { success: false, error: 'some scraping error' },
    });

    const req = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/broken' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('Failed to scrape product info');
  });

  it('returns 500 when an unexpected error occurs', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    mockOgs.mockRejectedValue(new Error('network error'));

    const req = new Request('http://localhost/api/registry/scrape', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/error' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('Failed to scrape product info');
  });
});
