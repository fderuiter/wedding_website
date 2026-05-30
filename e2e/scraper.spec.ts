import { test, expect } from '@playwright/test';
import crypto from 'crypto';

function signAdminToken(payload: any, secret: string): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64url');
  return `${data}.${signature}`;
}

test.describe('Scraper API', () => {
  let adminCookie: string;

  test.beforeAll(() => {
    const SECRET = '$2b$10$HYiV4HBBMU9iB5GEaeWV2u0Yt51iTwj4Hm7tlNR7OQuzAL7F8uNUO';
    const iat = Date.now();
    const exp = iat + 60 * 60 * 8 * 1000;
    adminCookie = signAdminToken({ isAdmin: true, iat, exp }, SECRET);
  });

  test('successfully scrapes product data from Amazon without being blocked', async ({ request }) => {
    const response = await request.post('/api/registry/scrape', {
      data: { url: 'https://www.amazon.com/dp/B01DFKC2SO' },
      headers: {
        'cookie': `admin_auth=${adminCookie}`
      }
    });
    
    expect(response.status()).toBe(200);
    const data = await response.json();
    console.log('Amazon scraped name:', data.name);
    
    expect(data).toHaveProperty('name');
    expect(data.name.length).toBeGreaterThan(0);
    // Amazon returns actual text for the product
    expect(data.name.toLowerCase()).not.toContain('page not found');
    expect(data.name.toLowerCase()).not.toContain('robot check');
    
    expect(data).toHaveProperty('image');
    expect(data.image).toMatch(/^https?:\/\//);
  });

  test('successfully scrapes product data from a standard site', async ({ request }) => {
    const response = await request.post('/api/registry/scrape', {
      data: { url: 'https://example.com' },
      headers: {
        'cookie': `admin_auth=${adminCookie}`
      }
    });
    
    expect(response.status()).toBe(200);
    const data = await response.json();
    
    expect(data).toHaveProperty('name');
    expect(data.name).toBe('Example Domain');
  });
});
