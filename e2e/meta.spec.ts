import { test, expect } from '@playwright/test';
import { seedGuestAuthCookies } from './helpers/auth';

test.describe('Metadata', { tag: '@smoke' }, () => {
  test('should have the correct metadata', async ({ context, page }) => {
    await seedGuestAuthCookies(context);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).pathname).toBe('/');

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
    await expect(ogUrl).toHaveAttribute('content', /^http:\/\/(localhost|127\.0\.0\.1):3000\/?$/);
    const ogType = page.locator('meta[property="og:type"]');
    await expect(ogType).toHaveAttribute('content', 'website');
    const ogImage = page.locator('meta[property="og:image"]');
    await expect(ogImage).toHaveAttribute('content', /^http:\/\/(localhost|127\.0\.0\.1):3000\/(api\/og|images\/(placeholder\.png|sunset-embrace\.jpg))/);

    // Check Twitter card metadata
    const twitterCard = page.locator('meta[name="twitter:card"]');
    await expect(twitterCard).toHaveAttribute('content', 'summary_large_image');
    const twitterTitle = page.locator('meta[name="twitter:title"]');
    await expect(twitterTitle).toHaveAttribute('content', /Jane & John|Wedding Website/);
    const twitterDescription = page.locator('meta[name="twitter:description"]');
    await expect(twitterDescription).toHaveAttribute('content', /Welcome to our wedding website|Join Jane and John/);
    const twitterImage = page.locator('meta[name="twitter:image"]');
    await expect(twitterImage).toHaveAttribute('content', /^http:\/\/(localhost|127\.0\.0\.1):3000\/(api\/og|images\/(placeholder\.png|sunset-embrace\.jpg))/);

    // Check canonical link
    const canonicalLink = page.locator('link[rel="canonical"]');
    await expect(canonicalLink).toHaveAttribute('href', /^http:\/\/(localhost|127\.0\.0\.1):3000\/?$/);
  });
});
