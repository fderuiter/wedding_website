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

test.describe('Skip Link Accessibility', () => {
  test('skip link appears with high contrast styles and focus outline on tab', async ({ context, page }) => {
    const guestCookieValue = generateGuestCookieValue();
    await context.addCookies([
      {
        name: 'guest_auth',
        value: guestCookieValue,
        url: 'http://127.0.0.1:3000',
      }
    ]);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('a.skip-link');
    await page.focus('body');
    await page.keyboard.press('Tab');

    const skipLink = page.locator('a.skip-link');
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();

    const color = await skipLink.evaluate((el) => getComputedStyle(el).color);
    const bgColor = await skipLink.evaluate((el) => getComputedStyle(el).backgroundColor);
    const outlineColor = await skipLink.evaluate((el) => getComputedStyle(el).outlineColor);
    const outlineStyle = await skipLink.evaluate((el) => getComputedStyle(el).outlineStyle);

    expect(color).toBe('rgb(17, 24, 39)'); // #111827
    expect(bgColor).toBe('rgb(255, 255, 255)'); // white
    expect(outlineStyle).toBe('solid');
    expect(outlineColor).toBe('rgb(185, 28, 28)'); // #B91C1C

    await page.screenshot({ path: '/tmp/skip-link-focused.png' });
  });
});
