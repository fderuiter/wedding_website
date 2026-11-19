import { test, expect } from '@playwright/test';
import { seedAdminAndGuestAuthCookies } from './helpers/auth';

test.describe('Maintenance Hub Pre-flight Validation Visual Tests', () => {
  test('displays pre-flight summary card for valid backup and diagnostic error panel for invalid backup', async ({
    page,
    context,
  }) => {
    test.setTimeout(60000);

    // Set admin and guest cookies across both loopback origins
    await seedAdminAndGuestAuthCookies(context);

    try {
      await page.goto('/admin/dashboard/maintenance', { waitUntil: 'domcontentloaded' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('crashed') || msg.includes('closed') || msg.includes('net::ERR_ABORTED')) {
        await seedAdminAndGuestAuthCookies(context).catch(() => {});
        page = await context.newPage();
        await page.goto('/admin/dashboard/maintenance', { waitUntil: 'domcontentloaded', timeout: 30000 });
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

    // Verify diagnostic panel appears with plain section & field labels
    await expect(page.locator('text=Pre-flight Validation Failed')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Registry Items (Entry 1) — Price')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Site Settings (Entry 1) — Website URL')).toBeVisible({ timeout: 15000 });

    // Take screenshot of invalid pre-flight diagnostic report
    await page.screenshot({ path: '/tmp/maintenance-preflight-invalid.png', fullPage: true });
  });
});
