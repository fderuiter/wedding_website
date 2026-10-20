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

test.describe('Maintenance Hub Pre-flight Validation Visual Tests', () => {
  test('displays pre-flight summary card for valid backup and diagnostic error panel for invalid backup', async ({
    page,
    context,
  }) => {
    test.setTimeout(60000);

    const baseURL = 'http://127.0.0.1:3000';

    // Set admin and guest cookies using URL property matching repository pattern
    await context.addCookies([
      {
        name: 'admin_auth',
        value: generateAdminCookieValue(),
        url: 'http://127.0.0.1:3000',
      },
      {
        name: 'guest_auth',
        value: generateGuestCookieValue(),
        url: 'http://127.0.0.1:3000',
      },
      {
        name: 'admin_auth',
        value: generateAdminCookieValue(),
        url: 'http://localhost:3000',
      },
      {
        name: 'guest_auth',
        value: generateGuestCookieValue(),
        url: 'http://localhost:3000',
      },
    ]);

    try {
      await page.goto('/admin/dashboard/maintenance', { waitUntil: 'domcontentloaded' });
    } catch (err: any) {
      if (err?.message?.includes('crashed') || err?.message?.includes('closed')) {
        page = await context.newPage();
        await page.goto('/admin/dashboard/maintenance', { waitUntil: 'domcontentloaded' });
      } else {
        throw err;
      }
    }

    // 1. Valid backup test
    const validBackup = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      appConfig: [
        {
          id: 'global',
          partner1Name: 'Alice',
          partner2Name: 'Bob',
          baseUrl: 'https://wedding.example.com',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      media: [],
      registryItem: [
        {
          id: 'item-1',
          name: 'Stand Mixer',
          description: 'A kitchen mixer',
          category: 'Kitchen',
          price: 299.99,
          imageId: 'img-1',
          quantity: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      contributor: [
        {
          id: 'contrib-1',
          name: 'Sarah Connor',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };

    const fileInput = page.locator('#backup-file-input');
    await expect(fileInput).toBeAttached({ timeout: 15000 });

    await fileInput.setInputFiles({
      name: 'valid-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(validBackup, null, 2)),
    });

    // Verify summary card appears
    await expect(page.locator('text=Pre-flight Inspection Passed')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Ready for Import')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=valid-backup.json')).toBeVisible({ timeout: 15000 });

    // Take screenshot of valid pre-flight summary
    await page.screenshot({ path: '/tmp/maintenance-preflight-valid.png', fullPage: true });

    // 2. Invalid backup test
    const invalidBackup = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      appConfig: [
        {
          id: 'global',
          baseUrl: 'invalid-not-a-url', // Schema validation failure
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      registryItem: [
        {
          id: 'item-2',
          name: 'Negative Price Item',
          description: 'Bad item',
          category: 'Home',
          price: -25.0, // Schema validation failure
          imageId: 'img-2',
          quantity: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    };

    await fileInput.setInputFiles({
      name: 'invalid-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(invalidBackup, null, 2)),
    });

    // Verify diagnostic panel appears
    await expect(page.locator('text=Pre-flight Validation Failed')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=registryItem.0.price')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=appConfig.0.baseUrl')).toBeVisible({ timeout: 15000 });

    // Take screenshot of invalid pre-flight diagnostic report
    await page.screenshot({ path: '/tmp/maintenance-preflight-invalid.png', fullPage: true });
  });
});
