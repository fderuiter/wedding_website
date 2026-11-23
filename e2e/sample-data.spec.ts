import { test, expect } from '@playwright/test';
import {
  generateAdminCookieValue,
  generateGuestCookieValue,
  generateGuestInviteSessionCookieValue,
  seedAdminAndGuestAuthCookies,
} from './helpers/auth';

test.describe('Sample Data Generator & Admin Workflow', () => {
  test.beforeEach(async ({ request }) => {
    // Purge any existing sample data before tests
    const adminCookie = generateAdminCookieValue();
    await request.delete('/api/admin/sample-data', {
      headers: {
        Cookie: `admin_auth=${adminCookie}`,
      },
    });
  });

  test('generates sample data via API and verifies status', async ({ request }) => {
    const adminCookie = generateAdminCookieValue();
    const headers = { Cookie: `admin_auth=${adminCookie}` };

    // Generate classic archetype
    const postRes = await request.post('/api/admin/sample-data', {
      headers,
      data: {
        archetype: 'classic',
        modules: ['registry', 'guests', 'seating', 'weddingParty', 'attractions', 'faqs'],
      },
    });
    expect(postRes.status()).toBe(200);
    const postBody = await postRes.json();
    expect(postBody.success).toBe(true);
    expect(postBody.createdCounts.registry).toBeGreaterThan(0);
    expect(postBody.createdCounts.faqs).toBeGreaterThan(0);

    // Get status
    const getRes = await request.get('/api/admin/sample-data', { headers });
    expect(getRes.status()).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.hasSampleData).toBe(true);
    expect(getBody.counts.registry).toBeGreaterThan(0);
    expect(getBody.counts.faqs).toBeGreaterThan(0);
  });

  test('prevents real contributions on sample registry items', async ({ request }) => {
    const adminCookie = generateAdminCookieValue();

    // 1. Generate sample data
    const postRes = await request.post('/api/admin/sample-data', {
      headers: { Cookie: `admin_auth=${adminCookie}` },
      data: {
        archetype: 'classic',
        modules: ['registry'],
      },
    });
    expect(postRes.status()).toBe(200);
    const postData = await postRes.json();
    expect(postData.createdCounts?.registry).toBeGreaterThan(0);

    // 2. Fetch registry items as admin
    const itemsRes = await request.get('/api/registry/items', {
      headers: { Cookie: `admin_auth=${adminCookie}` },
    });
    expect(itemsRes.status()).toBe(200);
    const itemsData = await itemsRes.json();
    const itemsList = Array.isArray(itemsData) ? itemsData : (itemsData.data?.items || itemsData.items || []);
    expect(itemsList.length).toBeGreaterThan(0);
    const sampleItem = itemsList.find((i: any) => i.isSample);
    expect(sampleItem).toBeDefined();

    // 3. Attempt to contribute to sample item
    const contributeRes = await request.post('/api/registry/contribute', {
      headers: { Cookie: `admin_auth=${adminCookie}` },
      data: {
        itemId: sampleItem.id,
        amount: 50,
        name: 'Tester',
      },
    });

    expect(contributeRes.status()).toBe(400);
    const contributeBody = await contributeRes.json();
    expect(contributeBody.error).toMatch(/sample/i);
  });

  test('rejects sample guest invitation codes across validation, login, lookup, and downstream guest routes', async ({ request }) => {
    const adminCookie = generateAdminCookieValue();
    const guestCookie = generateGuestCookieValue();

    // 1. Seed classic sample data including sample guests (e.g. SMITH2026) and registry items
    const seedRes = await request.post('/api/admin/sample-data', {
      headers: { Cookie: `admin_auth=${adminCookie}` },
      data: {
        archetype: 'classic',
        modules: ['registry', 'guests'],
      },
    });
    expect(seedRes.status()).toBe(200);

    // 2. Validate sample code SMITH2026 -> expect 404 and no guest_invite_session Set-Cookie
    const validateRes = await request.get('/api/registry/validate-code?code=SMITH2026');
    expect(validateRes.status()).toBe(404);
    const validateBody = await validateRes.json();
    expect(validateBody.error).toBe('Invalid invitation code.');
    const validateSetCookies = validateRes.headersArray().filter(h => h.name.toLowerCase() === 'set-cookie');
    expect(validateSetCookies.some(h => h.value.includes('guest_invite_session='))).toBe(false);

    // 3. Unauthenticated request to protected /api/registry/items still receives 401
    const unauthItemsRes = await request.get('/api/registry/items');
    expect(unauthItemsRes.status()).toBe(401);

    // 4. Unified guest login with sample code SMITH2026 -> expect 401 and no session cookie
    const loginRes = await request.post('/api/guest/login', {
      data: { passcode: 'SMITH2026' },
    });
    expect(loginRes.status()).toBe(401);
    const loginSetCookies = loginRes.headersArray().filter(h => h.name.toLowerCase() === 'set-cookie');
    expect(loginSetCookies.some(h => h.value.includes('guest_invite_session=') || h.value.includes('guest_auth='))).toBe(false);

    // 5. Self-service guest lookup for sample guest name -> expect 404 and no guest_invite_session cookie
    const lookupRes = await request.post('/api/guest/lookup', {
      headers: { Cookie: `guest_auth=${guestCookie}` },
      data: { query: 'Mr. & Mrs. Robert Smith' },
    });
    expect(lookupRes.status()).toBe(404);
    const lookupSetCookies = lookupRes.headersArray().filter(h => h.name.toLowerCase() === 'set-cookie');
    expect(lookupSetCookies.some(h => h.value.includes('guest_invite_session='))).toBe(false);

    // 6. Pre-deployment signed guest_invite_session cookie for sample code is rejected as unauthorized
    const preSignedSampleCookie = generateGuestInviteSessionCookieValue(
      'SMITH2026',
      'Mr. & Mrs. Robert Smith'
    );

    const addrGetRes = await request.get('/api/guest/address', {
      headers: { Cookie: `guest_invite_session=${preSignedSampleCookie}` },
    });
    expect(addrGetRes.status()).toBe(401);

    const addrPutRes = await request.put('/api/guest/address', {
      headers: { Cookie: `guest_invite_session=${preSignedSampleCookie}` },
      data: {
        addressLine1: '100 Demo Way',
        city: 'Chicago',
        state: 'IL',
        zipCode: '60601',
        country: 'United States',
      },
    });
    expect(addrPutRes.status()).toBe(401);

    const sampleSessionRes = await request.get('/api/registry/session', {
      headers: { Cookie: `guest_invite_session=${preSignedSampleCookie}` },
    });
    expect(sampleSessionRes.status()).toBe(200);
    const sampleSessionJson = await sampleSessionRes.json();
    expect(sampleSessionJson.data.isVerified).toBe(false);
    const sampleSessionCookies = sampleSessionRes
      .headersArray()
      .filter(h => h.name.toLowerCase() === 'set-cookie');
    expect(
      sampleSessionCookies.some(
        h => h.value.includes('guest_invite_session=') && h.value.includes('Max-Age=0')
      )
    ).toBe(true);

    const samplePhotosRes = await request.get('/api/photos', {
      headers: { Cookie: `guest_invite_session=${preSignedSampleCookie}` },
    });
    expect(samplePhotosRes.status()).toBe(401);
  });

  test('displays sample data banner and badges in admin UI, then purges sample data', async ({ context, page }) => {
    const { adminCookieValue: adminCookie } = await seedAdminAndGuestAuthCookies(context);

    // Seed sample data via API
    const request = context.request;
    const seedRes = await request.post('/api/admin/sample-data', {
      headers: { Cookie: `admin_auth=${adminCookie}` },
      data: {
        archetype: 'classic',
        modules: ['registry', 'guests', 'weddingParty', 'attractions', 'faqs'],
      },
    });
    expect(seedRes.status()).toBe(200);

    // Visit admin dashboard
    const banner = page.locator('[data-testid="sample-data-banner"]');
    await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).pathname).toBe('/admin/dashboard');
    await expect(banner).toBeVisible({ timeout: 20000 });

    // Should contain "Sample Data Active" and FAQ count badge
    await expect(banner).toContainText('Sample Data Active');
    await expect(banner).toContainText('FAQs');

    // Click Purge Sample Data button in banner
    const purgeButton = banner.locator('button', { hasText: 'Purge Sample Data' });
    await expect(purgeButton).toBeVisible();
    await purgeButton.click();

    // Confirm in the confirmation dialog modal
    const confirmButton = page.locator('button', { hasText: 'Confirm' });
    await expect(confirmButton).toBeVisible();
    const [purgeRes] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/admin/sample-data') && res.request().method() === 'DELETE'),
      confirmButton.click(),
    ]);
    expect(purgeRes.status()).toBe(200);

    // Banner should disappear after purging
    await expect(banner).not.toBeVisible({ timeout: 15000 });

    // Verify status API reports no sample data
    const statusRes = await request.get('/api/admin/sample-data', {
      headers: { Cookie: `admin_auth=${adminCookie}` },
    });
    const statusBody = await statusRes.json();
    expect(statusBody.hasSampleData).toBe(false);
  });
});
