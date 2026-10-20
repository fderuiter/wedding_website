import { test, expect } from '@playwright/test';
import crypto from 'crypto';

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

test.describe('Guest Photos Empty State', () => {
  test('displays guest photos empty state container when no guest photos exist', async ({ context, page }) => {
    const guestCookieValue = generateGuestCookieValue();
    const validJpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
    await context.route(/cdn\.jsdelivr\.net/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await context.route(/googleusercontent\.com/, (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: validJpeg }));
    await context.addCookies([
      {
        name: 'guest_auth',
        value: guestCookieValue,
        url: 'http://127.0.0.1:3000',
      },
      {
        name: 'guest_auth',
        value: guestCookieValue,
        url: 'http://localhost:3000',
      },
    ]);

    await page.goto('/photos', { waitUntil: 'domcontentloaded' });

    // Verify empty state container is rendered
    const emptyState = page.locator('[data-testid="guest-photos-empty-state"]');
    await expect(emptyState).toBeVisible();
    await emptyState.screenshot({ path: '/tmp/photos_empty_state.png' });
  });
});
