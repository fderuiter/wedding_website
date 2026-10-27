import { test, expect } from '@playwright/test';
import crypto from 'crypto';

function generateAdminCookieValue() {
  const secret = process.env.ADMIN_PASSWORD || 'scrypt:c2FsdA==:aGFzaA==';
  const payload = {
    isAdmin: true,
    iat: Date.now(),
    exp: Date.now() + 8 * 60 * 60 * 1000,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64url');
  return `${data}.${signature}`;
}

function generateGuestCookieValue() {
  const secret = process.env.GUEST_PASSCODE || 'wedding2026';
  const payload = {
    guest: true,
    iat: Date.now(),
    exp: Date.now() + 8 * 60 * 60 * 1000,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64url');
  return `${data}.${signature}`;
}

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
        modules: ['registry', 'guests', 'seating', 'weddingParty', 'attractions'],
      },
    });
    expect(postRes.status()).toBe(200);
    const postBody = await postRes.json();
    expect(postBody.success).toBe(true);
    expect(postBody.createdCounts.registry).toBeGreaterThan(0);

    // Get status
    const getRes = await request.get('/api/admin/sample-data', { headers });
    expect(getRes.status()).toBe(200);
    const getBody = await getRes.json();
    expect(getBody.hasSampleData).toBe(true);
    expect(getBody.counts.registry).toBeGreaterThan(0);
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

  test('displays sample data banner and badges in admin UI, then purges sample data', async ({ context, page }) => {
    const adminCookie = generateAdminCookieValue();
    await context.addCookies([
      { name: 'admin_auth', value: adminCookie, url: 'http://127.0.0.1:3000' },
      { name: 'admin_auth', value: adminCookie, url: 'http://localhost:3000' },
    ]);

    // Seed sample data via API
    const request = context.request;
    const seedRes = await request.post('/api/admin/sample-data', {
      headers: { Cookie: `admin_auth=${adminCookie}` },
      data: {
        archetype: 'classic',
        modules: ['registry', 'guests', 'weddingParty', 'attractions'],
      },
    });
    expect(seedRes.status()).toBe(200);

    // Visit admin dashboard
    try {
      await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' });
    } catch (err: any) {
      if (err?.message?.includes('crashed') || err?.message?.includes('closed')) {
        await context.addCookies([
          { name: 'admin_auth', value: adminCookie, url: 'http://127.0.0.1:3000' },
          { name: 'admin_auth', value: adminCookie, url: 'http://localhost:3000' },
        ]).catch(() => {});
        page = await context.newPage();
        await page.goto('/admin/dashboard', { waitUntil: 'domcontentloaded' });
      } else {
        throw err;
      }
    }

    // Sample data banner should be visible
    const banner = page.locator('[data-testid="sample-data-banner"]');
    await expect(banner).toBeVisible();

    // Should contain "Sample Data Active"
    await expect(banner).toContainText('Sample Data Active');

    // Click Purge Sample Data button in banner
    const purgeButton = banner.locator('button', { hasText: 'Purge Sample Data' });
    await expect(purgeButton).toBeVisible();
    await purgeButton.click();

    // Confirm in the confirmation dialog modal
    const confirmButton = page.locator('button', { hasText: 'Confirm' });
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    // Banner should disappear after purging
    await expect(banner).not.toBeVisible();

    // Verify status API reports no sample data
    const statusRes = await request.get('/api/admin/sample-data', {
      headers: { Cookie: `admin_auth=${adminCookie}` },
    });
    const statusBody = await statusRes.json();
    expect(statusBody.hasSampleData).toBe(false);
  });
});
