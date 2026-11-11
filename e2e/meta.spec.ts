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

test.describe('Metadata', () => {
  test('should have the correct metadata', async ({ context, page }) => {
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
    let lastError: unknown = null;

    while (attempt < 3 && !success) {
      attempt++;
      try {
        await page.goto('/', { waitUntil: 'domcontentloaded' });

        // Check title
        await expect(page).toHaveTitle(/Jane & John|Home|Wedding Website/);

        // Check meta description
        const metaDescription = page.locator('meta[name="description"]');
        await expect(metaDescription).toHaveAttribute('content', /Welcome to our wedding website|Join Jane and John/);

        // Check Open Graph metadata
        const ogTitle = page.locator('meta[property="og:title"]');
        await expect(ogTitle).toHaveAttribute('content', /Jane & John|Wedding Website/);
        const ogDescription = page.locator('meta[property="og:description"]');
        await expect(ogDescription).toHaveAttribute('content', /Welcome to our wedding website|Join Jane and John/);
        const ogUrl = page.locator('meta[property="og:url"]');
        await expect(ogUrl).toHaveAttribute('content', 'http://localhost:3000');
        const ogType = page.locator('meta[property="og:type"]');
        await expect(ogType).toHaveAttribute('content', 'website');
        const ogImage = page.locator('meta[property="og:image"]');
        await expect(ogImage).toHaveAttribute('content', /(api\/og|images\/(placeholder\.png|sunset-embrace\.jpg))/);

        // Check Twitter card metadata
        const twitterCard = page.locator('meta[name="twitter:card"]');
        await expect(twitterCard).toHaveAttribute('content', 'summary_large_image');
        const twitterTitle = page.locator('meta[name="twitter:title"]');
        await expect(twitterTitle).toHaveAttribute('content', /Jane & John|Wedding Website/);
        const twitterDescription = page.locator('meta[name="twitter:description"]');
        await expect(twitterDescription).toHaveAttribute('content', /Welcome to our wedding website|Join Jane and John/);
        const twitterImage = page.locator('meta[name="twitter:image"]');
        await expect(twitterImage).toHaveAttribute('content', /(api\/og|images\/(placeholder\.png|sunset-embrace\.jpg))/);

        // Check canonical link
        const canonicalLink = page.locator('link[rel="canonical"]');
        await expect(canonicalLink).toHaveAttribute('href', 'http://localhost:3000');

        success = true;
      } catch (err: unknown) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (
          attempt < 3 &&
          (msg.includes('crashed') ||
           msg.includes('closed') ||
           msg.includes('Target page, context or browser has been closed') ||
           msg.includes('Target crashed') ||
           msg.includes('net::ERR_ABORTED'))
        ) {
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
