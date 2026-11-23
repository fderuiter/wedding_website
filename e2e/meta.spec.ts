import { test, expect } from '@playwright/test';
import { seedAdminAndGuestAuthCookies, seedGuestAuthCookies } from './helpers/auth';

const SITE_TITLE_SUFFIX = /\|\s+.+$/;

test.describe('Metadata', { tag: '@smoke' }, () => {
  test('should have the correct metadata on the homepage', async ({ context, page }) => {
    await seedGuestAuthCookies(context);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).pathname).toBe('/');

    // Check title formatted with site title template
    await expect(page).toHaveTitle(/^Home \| .+/);

    // Check meta description
    const metaDescription = page.locator('meta[name="description"]');
    await expect(metaDescription).toHaveAttribute('content', /Welcome to our wedding website|Join .+ and .+/);

    // Check Open Graph metadata
    const ogTitle = page.locator('meta[property="og:title"]');
    await expect(ogTitle).toHaveAttribute('content', /.+'s Wedding|Wedding Website/);
    const ogDescription = page.locator('meta[property="og:description"]');
    await expect(ogDescription).toHaveAttribute('content', /Welcome to our wedding website|Join .+ and .+/);
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
    await expect(twitterTitle).toHaveAttribute('content', /.+'s Wedding|Wedding Website/);
    const twitterDescription = page.locator('meta[name="twitter:description"]');
    await expect(twitterDescription).toHaveAttribute('content', /Welcome to our wedding website|Join .+ and .+/);
    const twitterImage = page.locator('meta[name="twitter:image"]');
    await expect(twitterImage).toHaveAttribute('content', /^http:\/\/(localhost|127\.0\.0\.1):3000\/(api\/og|images\/(placeholder\.png|sunset-embrace\.jpg))/);

    // Check canonical link
    const canonicalLink = page.locator('link[rel="canonical"]');
    await expect(canonicalLink).toHaveAttribute('href', /^http:\/\/(localhost|127\.0\.0\.1):3000\/?$/);
  });

  test('should emit unique server-generated titles across guest, registry, project, admin, and 404 routes', async ({
    context,
    page,
  }) => {
    test.setTimeout(120000);
    const seededCookies = await seedAdminAndGuestAuthCookies(context);

    const routeExpectations: Array<{
      path: string;
      expectedPrefix: string;
      expectNoIndex: boolean;
      expectedPathname?: string;
    }> = [
      { path: '/guest/login', expectedPrefix: 'Guest Sign-In', expectNoIndex: true },
      { path: '/guest', expectedPrefix: 'Guest RSVP & Address Portal', expectNoIndex: true },
      { path: '/guest/collect', expectedPrefix: 'Mailing Address Form', expectNoIndex: true },
      { path: '/guest/claim', expectedPrefix: 'Gift Reservation Verification', expectNoIndex: true },
      { path: '/project-info', expectedPrefix: 'About This Project', expectNoIndex: false },
      { path: '/registry', expectedPrefix: 'Gift Registry', expectNoIndex: false },
      { path: '/registry/add-item', expectedPrefix: 'Add Registry Item', expectNoIndex: true },
      { path: '/registry/edit-item/1', expectedPrefix: 'Edit Registry Item', expectNoIndex: true },
      { path: '/admin/login', expectedPrefix: 'Admin Login', expectNoIndex: true },
      { path: '/admin/dashboard', expectedPrefix: 'Admin Dashboard Overview', expectNoIndex: true },
      { path: '/admin/dashboard/registry', expectedPrefix: 'Registry Management', expectNoIndex: true },
      { path: '/admin/dashboard/seating-chart', expectedPrefix: 'Seating Chart', expectNoIndex: true },
      { path: '/admin/dashboard/invitation-codes', expectedPrefix: 'Invitation Codes', expectNoIndex: true },
      { path: '/admin/dashboard/settings', expectedPrefix: 'Site Settings', expectNoIndex: true },
      {
        path: '/missing-route-404-verification',
        expectedPrefix: 'Page Not Found',
        expectNoIndex: true,
        expectedPathname: '/missing-route-404-verification',
      },
    ];

    const observedTitles = new Set<string>();

    for (const entry of routeExpectations) {
      await seedAdminAndGuestAuthCookies(context, seededCookies);
      try {
        await page.goto(entry.path, { waitUntil: 'domcontentloaded' });
      } catch (err) {
        if (err instanceof Error && err.message.includes('ERR_ABORTED')) {
          await seedAdminAndGuestAuthCookies(context, seededCookies);
          await page.goto(entry.path, { waitUntil: 'domcontentloaded' });
        } else {
          throw err;
        }
      }
      expect(new URL(page.url()).pathname).toBe(entry.expectedPathname ?? entry.path);

      const escapedPrefix = entry.expectedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await expect(page).toHaveTitle(new RegExp(`^${escapedPrefix} \\| .+`));

      const title = await page.title();
      expect(title).toMatch(SITE_TITLE_SUFFIX);
      expect(observedTitles.has(title)).toBe(false);
      observedTitles.add(title);

      if (entry.expectNoIndex) {
        const robotsContents = await page
          .locator('meta[name="robots"]')
          .evaluateAll((elements) => elements.map((el) => el.getAttribute('content') ?? ''));
        expect(robotsContents.length).toBeGreaterThan(0);
        for (const content of robotsContents) {
          expect(content).toMatch(/noindex/i);
        }
      } else {
        const robotsContents = await page
          .locator('meta[name="robots"]')
          .evaluateAll((elements) => elements.map((el) => el.getAttribute('content') ?? ''));
        for (const content of robotsContents) {
          expect(content).not.toMatch(/noindex/i);
        }
      }
    }
  });
});
