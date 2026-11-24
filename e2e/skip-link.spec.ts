import { test, expect, type Page } from '@playwright/test';
import { seedAdminAndGuestAuthCookies, seedGuestAuthCookies } from './helpers/auth';

const ADMIN_DASHBOARD_ROUTES = [
  '/admin/dashboard',
  '/admin/dashboard/registry',
  '/admin/dashboard/thank-you-notes',
  '/admin/dashboard/invitation-codes',
  '/admin/dashboard/sub-events',
  '/admin/dashboard/seating-chart',
  '/admin/dashboard/site-manager',
  '/admin/dashboard/wedding-party',
  '/admin/dashboard/media',
  '/admin/dashboard/attractions',
  '/admin/dashboard/content',
  '/admin/dashboard/settings',
  '/admin/dashboard/history',
  '/admin/dashboard/maintenance',
] as const;

async function activateSkipLinkAndAssertMainFocused(page: Page) {
  const skipLink = page.locator('a.skip-link');
  await expect(skipLink).toBeAttached();
  await page.focus('body');
  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();

  await page.keyboard.press('Enter');

  const mainContent = page.locator('main#main-content');
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('main main')).toHaveCount(0);
  await expect(mainContent).toHaveAttribute('tabindex', '-1');
  await expect(mainContent).toBeFocused();
}

async function assertAdminShellPrecedesMain(page: Page) {
  const ordering = await page.evaluate(() => {
    const main = document.querySelector('main#main-content');
    const siteHeader = document.querySelector('header[aria-label="Site header"]');
    const adminNav = document.querySelector('nav[aria-label="Admin Navigation"]');
    const sampleBanner = document.querySelector('[data-testid="sample-data-banner"]');
    if (!main || !siteHeader || !adminNav || !sampleBanner) {
      return {
        foundAll: false,
        afterNavbar: false,
        afterAdminNav: false,
        afterSampleBanner: false,
      };
    }
    return {
      foundAll: true,
      afterNavbar: Boolean(siteHeader.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING),
      afterAdminNav: Boolean(adminNav.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING),
      afterSampleBanner: Boolean(
        sampleBanner.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING
      ),
    };
  });

  expect(ordering).toEqual({
    foundAll: true,
    afterNavbar: true,
    afterAdminNav: true,
    afterSampleBanner: true,
  });
}

test.describe('Skip Link Accessibility', { tag: ['@a11y', '@smoke'] }, () => {
  test('skip link appears with high contrast styles and focuses main#main-content on /', async ({ context, page }, testInfo) => {
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

    await page.keyboard.press('Enter');
    const mainContent = page.locator('main#main-content');
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('main main')).toHaveCount(0);
    await expect(mainContent).toHaveAttribute('tabindex', '-1');
    await expect(mainContent).toBeFocused();
  });

  test('activating Skip to main content on /guest/collect focuses main#main-content with zero nested main elements', async ({
    context,
    page,
  }) => {
    await seedGuestAuthCookies(context);

    await page.goto('/guest/collect', { waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).pathname).toBe('/guest/collect');
    await expect(page.getByRole('heading', { name: 'Mailing Address Form' })).toBeVisible();

    await activateSkipLinkAndAssertMainFocused(page);
  });

  test('activating Skip to main content focuses main#main-content after Navbar, AdminNav, and SampleDataBanner across all /admin/dashboard routes', async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    await seedAdminAndGuestAuthCookies(context);

    await page.route('**/api/admin/sample-data', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            hasSampleData: true,
            counts: { guests: 4, weddingParty: 2 },
          }),
        });
        return;
      }
      await route.continue();
    });

    for (const routePath of ADMIN_DASHBOARD_ROUTES) {
      await page.goto(routePath, { waitUntil: 'domcontentloaded' });
      expect(new URL(page.url()).pathname).toBe(routePath);
      await expect(page.getByTestId('sample-data-banner')).toBeVisible();

      await assertAdminShellPrecedesMain(page);
      await activateSkipLinkAndAssertMainFocused(page);
    }
  });

  test('activating Skip to main content focuses main#main-content when admin/dashboard/error.tsx boundary renders', async ({
    context,
    page,
  }) => {
    await seedAdminAndGuestAuthCookies(context);

    await page.route('**/api/admin/sample-data', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            hasSampleData: true,
            counts: { guests: 3 },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.route('**/api/admin/thank-you-notes*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [null] }),
      });
    });

    await page.goto('/admin/dashboard/thank-you-notes', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Admin Dashboard Error' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('sample-data-banner')).toBeVisible();

    await assertAdminShellPrecedesMain(page);
    await activateSkipLinkAndAssertMainFocused(page);
  });
});
