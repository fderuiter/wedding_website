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
    test.setTimeout(60000);

    const guestCookieValue = generateGuestCookieValue();
    const cookies = [
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
    ];
    await context.addCookies(cookies);

    let attempt = 0;
    let success = false;
    let lastError: any = null;

    while (attempt < 3 && !success) {
      attempt++;
      try {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('a.skip-link', { timeout: 15000 });
        await page.focus('body');
        await page.keyboard.press('Tab');

        const skipLink = page.locator('a.skip-link');
        await expect(skipLink).toBeFocused({ timeout: 15000 });
        await expect(skipLink).toBeVisible({ timeout: 15000 });

        const color = await skipLink.evaluate((el) => getComputedStyle(el).color);
        const bgColor = await skipLink.evaluate((el) => getComputedStyle(el).backgroundColor);
        const outlineColor = await skipLink.evaluate((el) => getComputedStyle(el).outlineColor);
        const outlineStyle = await skipLink.evaluate((el) => getComputedStyle(el).outlineStyle);

        expect(color).toBe('rgb(17, 24, 39)'); // #111827
        expect(bgColor).toBe('rgb(255, 255, 255)'); // white
        expect(outlineStyle).toBe('solid');
        expect(outlineColor).toBe('rgb(185, 28, 28)'); // #B91C1C

        await page.screenshot({ path: '/tmp/skip-link-focused.png' });
        success = true;
      } catch (err: any) {
        lastError = err;
        if (
          attempt < 3 &&
          (err?.message?.includes('crashed') ||
           err?.message?.includes('closed') ||
           err?.message?.includes('Target crashed') ||
           err?.message?.includes('net::ERR_ABORTED'))
        ) {
          console.log(`[Skip Link] Page crashed or closed (attempt ${attempt}), retrying on fresh page...`);
          await page.close().catch(() => {});
          await context.addCookies(cookies).catch(() => {});
          page = await context.newPage();
        } else {
          throw err;
        }
      }
    }

    if (!success && lastError) {
      throw lastError;
    }
  });
});
