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

    // 1b. Unified v2.0 15-model backup pre-flight summary verification
    const nowIso = new Date().toISOString();
    const validV2Backup = {
      version: '2.0',
      schemaVersion: '2.0',
      exportedAt: nowIso,
      appConfig: [
        {
          id: 'global',
          partner1Name: 'Alex',
          partner2Name: 'Taylor',
          baseUrl: 'https://wedding.example.com',
          layoutContainerMaxWidth: '72rem',
          emailProvider: 'smtp',
          smtpHost: 'smtp.example.com',
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ],
      contentNode: [
        { id: 'cn-1', type: 'FAQ', tags: ['FAQ'], data: { q: 'Dress code?' }, createdAt: nowIso, updatedAt: nowIso },
      ],
      media: [
        { id: 'm-1', url: '/images/hero.jpg', altText: 'Hero', createdAt: nowIso, updatedAt: nowIso },
      ],
      seatingTable: [
        { id: 'st-1', name: 'Garden Table 1', shape: 'round', capacity: 8, createdAt: nowIso, updatedAt: nowIso },
        { id: 'st-2', name: 'Garden Table 2', shape: 'round', capacity: 8, createdAt: nowIso, updatedAt: nowIso },
      ],
      invitationCode: [
        { id: 'ic-1', code: 'GUEST01', guestName: 'Sam Rivera', tableId: 'st-1', seatNumber: 1, createdAt: nowIso, updatedAt: nowIso },
        { id: 'ic-2', code: 'GUEST02', guestName: 'Jordan Lee', tableId: 'st-1', seatNumber: 2, createdAt: nowIso, updatedAt: nowIso },
        { id: 'ic-3', code: 'GUEST03', guestName: 'Morgan Kim', tableId: 'st-2', seatNumber: 1, createdAt: nowIso, updatedAt: nowIso },
      ],
      weddingPartyMember: [
        { id: 'wp-1', name: 'Casey', role: 'Best Person', bio: 'Friend', side: 'BRIDE', createdAt: nowIso, updatedAt: nowIso },
      ],
      attraction: [
        {
          id: 'att-1',
          name: 'Harbor Hotel',
          description: 'Room block',
          category: 'Hotel',
          website: 'https://harbor.example.com',
          directions: 'Waterfront',
          latitude: 41.88,
          longitude: -87.62,
          promoCode: 'WED26',
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ],
      registryItem: [
        {
          id: 'item-1',
          name: 'Stand Mixer',
          description: 'A kitchen mixer',
          category: 'Kitchen',
          price: 299.99,
          imageId: 'm-1',
          quantity: 1,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ],
      contributor: [
        {
          id: 'contrib-1',
          name: 'Sam Rivera',
          amount: 150,
          registryItemId: 'item-1',
          invitationCodeId: 'ic-1',
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ],
      subEvent: [
        { id: 'se-1', title: 'Welcome Drinks', description: 'Terrace reception', isPrivate: true, createdAt: nowIso, updatedAt: nowIso },
      ],
      subEventAccess: [
        { id: 'sea-1', subEventId: 'se-1', invitationCodeId: 'ic-1', createdAt: nowIso },
        { id: 'sea-2', subEventId: 'se-1', invitationCodeId: 'ic-2', createdAt: nowIso },
      ],
      subEventRsvp: [
        { id: 'rsvp-1', subEventId: 'se-1', invitationCodeId: 'ic-1', status: 'attending', plusOneCount: 1, createdAt: nowIso, updatedAt: nowIso },
      ],
      broadcastMessage: [
        { id: 'bm-1', channel: 'EMAIL', subject: 'Arrival Info', body: 'Shuttle departs at 3:30 PM', status: 'SENT', createdAt: nowIso, updatedAt: nowIso },
      ],
      broadcastRecipient: [
        { id: 'br-1', broadcastId: 'bm-1', invitationCodeId: 'ic-1', guestName: 'Sam Rivera', destination: 'sam@example.com', createdAt: nowIso, updatedAt: nowIso },
      ],
      snapshotVersion: [
        { id: 'sv-1', entityType: 'AppConfig', entityId: 'global', data: { partner1Name: 'Alex' }, createdAt: nowIso },
      ],
    };

    await fileInput.setInputFiles({
      name: 'unified-backup-v2.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(validV2Backup, null, 2)),
    });

    await expect(page.locator('text=unified-backup-v2.json')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Guests:')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Seating Tables:')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Sub-Events:')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=RSVPs:')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Broadcasts:')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Snapshots:')).toBeVisible({ timeout: 15000 });

    await page.screenshot({ path: '/tmp/maintenance-preflight-v2.png', fullPage: true });

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
