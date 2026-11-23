import { test, expect } from '@playwright/test';
import { seedGuestAuthCookies } from './helpers/auth';

test.describe('Skip Link Accessibility', { tag: ['@a11y', '@smoke'] }, () => {
  test('skip link appears with high contrast styles and focus outline on tab', async ({ context, page }, testInfo) => {
    await seedGuestAuthCookies(context);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).pathname).toBe('/');

    const skipLink = page.locator('a.skip-link');
    await expect(skipLink).toBeAttached();
    await page.focus('body');
    await page.keyboard.press('Tab');

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

    await page.screenshot({
      path: testInfo.outputPath('skip-link-focused.png'),
      animations: 'disabled',
    });
  });
});
