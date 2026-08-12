import { test, expect } from '@playwright/test';
import crypto from 'crypto';

function generateAdminToken() {
  const payload = {
    isAdmin: true,
    iat: Date.now(),
    exp: Date.now() + 60 * 60 * 8 * 1000, // 8 hours
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const secret = process.env.ADMIN_PASSWORD || 'scrypt:c2FsdA==:aGFzaA==';
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64url');
  return `${data}.${signature}`;
}

test.describe('Legacy Registry API Smoke Suite', () => {
  // Run tests sequentially since they depend on the created item ID
  test.describe.configure({ mode: 'serial' });

  let createdItemId: string;
  const adminToken = generateAdminToken();

  test('1. POST /api/registry/items - Should create a new registry item using legacy field prefixes', async ({ request }) => {
    const legacyPayload = {
      legacy_name: 'Playwright Smoke Test Mixer',
      legacy_price: 349.99,
      legacy_quantity: 3,
      legacy_category: 'Kitchen Appliances',
      legacy_description: 'An automatic stand mixer verified via headless smoke test.',
      legacy_imageUrl: '/images/test-mixer.jpg',
      legacy_vendorUrl: 'https://example.com/test-mixer',
      legacy_isGroupGift: true,
    };

    const response = await request.post('/api/registry/items', {
      headers: {
        'Cookie': `admin_auth=${adminToken}`,
        'x-api-version': 'v1',
        'Content-Type': 'application/json',
      },
      data: legacyPayload,
    });

    expect(response.status()).toBe(201);
    expect(response.headers()['x-api-version']).toBe('v1');

    const body = await response.json();
    expect(body.success).toBe(true);
    
    const nestedData = body.data || body;
    const item = nestedData.item;
    expect(item).toBeDefined();
    expect(item.id).toBeDefined();
    
    // Store ID for subsequent test steps
    createdItemId = item.id;

    // Validate returned payload fields have legacy prefixes
    expect(item.legacy_name).toBe(legacyPayload.legacy_name);
    expect(item.legacy_price).toBe(legacyPayload.legacy_price);
    expect(item.legacy_quantity).toBe(legacyPayload.legacy_quantity);
    expect(item.legacy_category).toBe(legacyPayload.legacy_category);
    expect(item.legacy_description).toBe(legacyPayload.legacy_description);
    expect(item.legacy_imageUrl).toBe(legacyPayload.legacy_imageUrl);
    expect(item.legacy_vendorUrl).toBe(legacyPayload.legacy_vendorUrl);
    expect(item.legacy_isGroupGift).toBe(legacyPayload.legacy_isGroupGift);
  });

  test('2. GET /api/registry/items - Should list registry items translated into legacy field formats', async ({ request }) => {
    // We pass version=v1 query param instead of header to verify both entrypoints work
    const response = await request.get('/api/registry/items?version=v1');

    expect(response.status()).toBe(200);
    expect(response.headers()['x-api-version']).toBe('v1');

    const body = await response.json();
    expect(body.success).toBe(true);

    const items = body.data;
    expect(Array.isArray(items)).toBe(true);

    // Find the item we created
    const foundItem = items.find((item: { id: string }) => item.id === createdItemId);
    expect(foundItem).toBeDefined();

    // Check fields of the returned legacy structure
    expect(foundItem.legacy_name).toBe('Playwright Smoke Test Mixer');
    expect(foundItem.legacy_price).toBe(349.99);
    expect(foundItem.legacy_quantity).toBe(3);
    expect(foundItem.legacy_category).toBe('Kitchen Appliances');
  });

  test('3. GET /api/registry/items/[id] - Should fetch a single item translated into legacy format', async ({ request }) => {
    const response = await request.get(`/api/registry/items/${createdItemId}`, {
      headers: {
        'x-api-version': 'v1',
      },
    });

    expect(response.status()).toBe(200);
    expect(response.headers()['x-api-version']).toBe('v1');

    const body = await response.json();
    expect(body.success).toBe(true);

    const item = body.data;
    expect(item).toBeDefined();
    expect(item.id).toBe(createdItemId);
    expect(item.legacy_name).toBe('Playwright Smoke Test Mixer');
    expect(item.legacy_price).toBe(349.99);
  });

  test('4. PUT /api/registry/items/[id] - Should update the item using legacy field inputs and return legacy format', async ({ request }) => {
    const legacyUpdatePayload = {
      legacy_name: 'Playwright Smoke Test Mixer (Updated)',
      legacy_price: 399.99,
      legacy_quantity: 1,
      legacy_category: 'Kitchen Appliances & Gear',
      legacy_description: 'An updated stand mixer verified via headless smoke test.',
      legacy_imageUrl: '/images/test-mixer-updated.jpg',
      legacy_vendorUrl: 'https://example.com/test-mixer-updated',
      legacy_isGroupGift: false,
    };

    const response = await request.put(`/api/registry/items/${createdItemId}`, {
      headers: {
        'Cookie': `admin_auth=${adminToken}`,
        'x-api-version': 'v1',
        'Content-Type': 'application/json',
      },
      data: legacyUpdatePayload,
    });

    expect(response.status()).toBe(200);
    expect(response.headers()['x-api-version']).toBe('v1');

    const body = await response.json();
    expect(body.success).toBe(true);

    const nestedData = body.data || body;
    const item = nestedData.item;
    expect(item).toBeDefined();
    expect(item.id).toBe(createdItemId);
    expect(item.legacy_name).toBe(legacyUpdatePayload.legacy_name);
    expect(item.legacy_price).toBe(legacyUpdatePayload.legacy_price);
    expect(item.legacy_quantity).toBe(legacyUpdatePayload.legacy_quantity);
    expect(item.legacy_category).toBe(legacyUpdatePayload.legacy_category);
    expect(item.legacy_description).toBe(legacyUpdatePayload.legacy_description);
    expect(item.legacy_imageUrl).toBe(legacyUpdatePayload.legacy_imageUrl);
    expect(item.legacy_vendorUrl).toBe(legacyUpdatePayload.legacy_vendorUrl);
    expect(item.legacy_isGroupGift).toBe(legacyUpdatePayload.legacy_isGroupGift);
  });

  test('5. DELETE /api/registry/items/[id] - Should successfully delete the registry item via legacy path', async ({ request }) => {
    const response = await request.delete(`/api/registry/items/${createdItemId}`, {
      headers: {
        'Cookie': `admin_auth=${adminToken}`,
        'x-api-version': 'v1',
      },
    });

    expect(response.status()).toBe(200);
    expect(response.headers()['x-api-version']).toBe('v1');

    const body = await response.json();
    expect(body.success).toBe(true);

    // Verify item is actually deleted by attempting to read it again
    const checkResponse = await request.get(`/api/registry/items/${createdItemId}`, {
      headers: {
        'x-api-version': 'v1',
      },
    });
    expect(checkResponse.status()).toBe(404);
  });
});
