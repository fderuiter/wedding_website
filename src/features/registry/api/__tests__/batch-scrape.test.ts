/** @jest-environment node */

import { POST } from '../batch-scrape';
import { isAdminRequest } from '@/core/auth/auth.server';
import { server } from '@/mocks/server';
import { http, HttpResponse } from 'msw';
import type { NextRequest } from 'next/server';

// Mock DNS for SSRF check
jest.mock('dns', () => {
  return {
    promises: {
      lookup: jest.fn().mockImplementation(async (hostname, _options) => {
        if (hostname === '127.0.0.1' || hostname === 'localhost') {
          return { address: '127.0.0.1', family: 4 };
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

describe('POST /api/registry/scrape/batch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(true);
  });

  it('rejects unauthenticated requests with 401', async () => {
    mockIsAdminRequest.mockResolvedValue(false);

    const request = new Request('http://localhost/api/registry/scrape/batch', {
      method: 'POST',
      body: JSON.stringify({ urls: ['https://example.com/product1'] }),
    });

    const response = await POST(request as unknown as NextRequest);
    expect(response.status).toBe(401);
  });

  it('rejects batch requests with more than 20 URLs with 400', async () => {
    const urls = Array.from({ length: 21 }, (_, i) => `https://example.com/item-${i}`);
    const request = new Request('http://localhost/api/registry/scrape/batch', {
      method: 'POST',
      body: JSON.stringify({ urls }),
    });

    const response = await POST(request as unknown as NextRequest);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Maximum of 20 URLs allowed');
  });

  it('rejects empty URL array with 400', async () => {
    const request = new Request('http://localhost/api/registry/scrape/batch', {
      method: 'POST',
      body: JSON.stringify({ urls: [] }),
    });

    const response = await POST(request as unknown as NextRequest);
    expect(response.status).toBe(400);
  });

  it('scrapes valid URLs in parallel and returns metadata', async () => {
    server.use(
      http.get('https://retailer.example.com/p1', () => {
        return new HttpResponse(
          '<html><head><meta property="og:title" content="Product 1" /><meta property="og:price:amount" content="49.99" /><meta property="og:image" content="https://retailer.example.com/p1.jpg" /></head><body></body></html>',
          { headers: { 'Content-Type': 'text/html' } }
        );
      }),
      http.get('https://retailer.example.com/p2', () => {
        return new HttpResponse(
          '<html><head><meta property="og:title" content="Product 2" /><meta property="og:price:amount" content="99.00" /><meta property="og:image" content="https://retailer.example.com/p2.jpg" /></head><body></body></html>',
          { headers: { 'Content-Type': 'text/html' } }
        );
      })
    );

    const request = new Request('http://localhost/api/registry/scrape/batch', {
      method: 'POST',
      body: JSON.stringify({
        urls: [
          'https://retailer.example.com/p1',
          'https://retailer.example.com/p2',
        ],
      }),
    });

    const response = await POST(request as unknown as NextRequest);
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.total).toBe(2);
    expect(body.successful).toBe(2);
    expect(body.failed).toBe(0);

    expect(body.results[0].success).toBe(true);
    expect(body.results[0].data.name).toBe('Product 1');
    expect(body.results[0].data.price).toBe(49.99);

    expect(body.results[1].success).toBe(true);
    expect(body.results[1].data.name).toBe('Product 2');
    expect(body.results[1].data.price).toBe(99.0);
  });

  it('keeps valid items available when one URL fails or is malformed', async () => {
    server.use(
      http.get('https://retailer.example.com/valid-item', () => {
        return new HttpResponse(
          '<html><head><meta property="og:title" content="Valid Item" /><meta property="og:price:amount" content="19.99" /></head><body></body></html>',
          { headers: { 'Content-Type': 'text/html' } }
        );
      }),
      http.get('https://retailer.example.com/error-404', () => {
        return new HttpResponse('Not Found', { status: 404 });
      })
    );

    const request = new Request('http://localhost/api/registry/scrape/batch', {
      method: 'POST',
      body: JSON.stringify({
        urls: [
          'https://retailer.example.com/valid-item',
          'not-a-valid-url',
          'https://retailer.example.com/error-404',
        ],
      }),
    });

    const response = await POST(request as unknown as NextRequest);
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.total).toBe(3);
    expect(body.successful).toBe(1);
    expect(body.failed).toBe(2);

    // First item succeeded
    expect(body.results[0].success).toBe(true);
    expect(body.results[0].data.name).toBe('Valid Item');

    // Second item failed due to invalid URL format
    expect(body.results[1].success).toBe(false);
    expect(body.results[1].errorDomain).toBe('INVALID_URL');
    expect(body.results[1].error).toBeDefined();

    // Third item failed due to 404
    expect(body.results[2].success).toBe(false);
    expect(body.results[2].errorDomain).toBe('URL_NOT_FOUND');
  });

  it('blocks private IP addresses with SSRF protection', async () => {
    const request = new Request('http://localhost/api/registry/scrape/batch', {
      method: 'POST',
      body: JSON.stringify({
        urls: ['http://localhost/admin/secrets'],
      }),
    });

    const response = await POST(request as unknown as NextRequest);
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.total).toBe(1);
    expect(body.successful).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.results[0].success).toBe(false);
    expect(body.results[0].error).toContain('Blocked:');
  });
});
