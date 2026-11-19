import { test, expect } from '@playwright/test';
import { seedGuestAuthCookies } from './helpers/auth';

test.describe('Guest Photos Empty State', () => {
  test('displays guest photos empty state container when no guest photos exist', async ({ context, page }) => {
    const validJpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
    await context.route(/cdn\.jsdelivr\.net/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await context.route(/googleusercontent\.com/, (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: validJpeg }));
    await seedGuestAuthCookies(context);

    try {
      await page.goto('/photos', { waitUntil: 'networkidle' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('crashed') || msg.includes('closed') || msg.includes('net::ERR_ABORTED')) {
        await seedGuestAuthCookies(context).catch(() => {});
        page = await context.newPage();
        await page.goto('/photos', { waitUntil: 'networkidle', timeout: 30000 });
      } else {
        throw err;
      }
    }

    expect(new URL(page.url()).pathname).toBe('/photos');

    // Wait for client-side hydration
    await page.locator('[data-hydrated="true"]').waitFor({ timeout: 15000 });

    // Switch to Guest tab to view guest empty state
    await page.locator('[data-testid="tab-guest"]').click();

    // Verify empty state container is rendered
    const emptyState = page.locator('[data-testid="guest-photos-empty-state"]');
    await expect(emptyState).toBeVisible();
    await emptyState.screenshot({ path: '/tmp/photos_empty_state.png' });
  });
});
