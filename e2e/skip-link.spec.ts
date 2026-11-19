import { test, expect } from '@playwright/test';
import { seedGuestAuthCookies } from './helpers/auth';

test.describe('Skip Link Accessibility', () => {
  test('skip link appears with high contrast styles and focus outline on tab', async ({ context, page }) => {
    await seedGuestAuthCookies(context);

    try {
      await page.goto('/', { waitUntil: 'load' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('crashed') || msg.includes('closed') || msg.includes('net::ERR_ABORTED')) {
        await seedGuestAuthCookies(context).catch(() => {});
        page = await context.newPage();
        await page.goto('/', { waitUntil: 'load', timeout: 30000 });
      } else {
        throw err;
      }
    }
    expect(new URL(page.url()).pathname).toBe('/');
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
