import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { a11yConfig } from '../src/a11y-config';
import fs from 'fs';
import path from 'path';
import { seedAdminAndGuestAuthCookies, seedGuestAuthCookies } from './helpers/auth';

function recordRouteViolations(route: string, violations: unknown[]) {
  const reportDir = path.join(process.cwd(), 'test-results');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  const reportFile = path.join(reportDir, 'playwright-a11y-violations.json');
  let violationsByRoute: Record<string, unknown[]> = {};
  if (fs.existsSync(reportFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        violationsByRoute = parsed as Record<string, unknown[]>;
      }
    } catch {
      violationsByRoute = {};
    }
  }
  violationsByRoute[route] = violations;
  fs.writeFileSync(reportFile, JSON.stringify(violationsByRoute, null, 2));
}

test.describe('UI Verification', { tag: '@a11y' }, () => {
  test(
    'should show the main content on visit and be accessible',
    async ({ context, page }) => {
      await seedGuestAuthCookies(context);

      await page.goto('/', { waitUntil: 'domcontentloaded' });
      expect(new URL(page.url()).pathname).toBe('/');

      // The main content should be visible, focusable, and free of nested main elements
      const mainContent = page.locator('main#main-content');
      await expect(mainContent).toBeVisible();
      await expect(mainContent).toHaveAttribute('tabindex', '-1');
      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.locator('main main')).toHaveCount(0);

      // Top-level contentinfo footer must sit outside main#main-content
      const siteFooter = page.getByRole('contentinfo');
      await expect(siteFooter).toBeVisible();
      const footerOutsideMain = await page.evaluate(() => {
        const main = document.querySelector('main#main-content');
        const footer = document.querySelector('footer');
        return Boolean(main && footer && !main.contains(footer));
      });
      expect(footerOutsideMain).toBe(true);

      // Run accessibility audit
      const axeBuilder = new AxeBuilder({ page }).withTags(a11yConfig.runOnly.values);
      if (a11yConfig.rules) {
        axeBuilder.options({ rules: a11yConfig.rules });
      }
      const accessibilityScanResults = await axeBuilder.analyze();
      recordRouteViolations('/', accessibilityScanResults.violations);

      // Assert no violations
      expect(accessibilityScanResults.violations).toEqual([]);
    }
  );

  test('should pass axe accessibility scan on /weather route with zero violations', async ({ context, page }) => {
    await seedGuestAuthCookies(context);

    await page.goto('/weather', { waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).pathname).toBe('/weather');
    await expect(page.getByRole('heading', { name: 'The Forecast for Our Big Day' })).toBeVisible();

    const axeBuilder = new AxeBuilder({ page }).withTags(a11yConfig.runOnly.values);
    if (a11yConfig.rules) {
      axeBuilder.options({ rules: a11yConfig.rules });
    }
    const results = await axeBuilder.analyze();
    recordRouteViolations('/weather', results.violations);
    expect(results.violations).toEqual([]);
  });

  test('should pass axe accessibility scan on /photos across curated and guest tabs in light and dark modes', async ({
    context,
    page,
  }) => {
    await seedGuestAuthCookies(context);

    await page.goto('/photos', { waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).pathname).toBe('/photos');
    await expect(page.getByTestId('photo-gallery-tabs')).toBeVisible();

    const runScan = async (label: string) => {
      const axeBuilder = new AxeBuilder({ page })
        .withTags(a11yConfig.runOnly.values)
        .options({
          rules: {
            ...a11yConfig.rules,
            'label-content-name-mismatch': { enabled: true },
          },
        });
      const results = await axeBuilder.analyze();
      recordRouteViolations(label, results.violations);
      expect(results.violations).toEqual([]);
    };

    // Light mode: Curated Album + Guest Uploads
    await runScan('/photos (curated, light)');
    await page.getByTestId('tab-guest').click();
    await expect(page.getByTestId('guest-photos-section')).toBeVisible();
    await runScan('/photos (guest, light)');

    // Dark mode: Guest Uploads + Curated Album
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    });
    await runScan('/photos (guest, dark)');
    await page.getByTestId('tab-curated').click();
    await expect(page.getByTestId('curated-photos-section')).toBeVisible();
    await runScan('/photos (curated, dark)');
  });

  test('should pass axe accessibility scan on /admin/dashboard/thank-you-notes with zero violations', async ({ context, page }) => {
    await seedAdminAndGuestAuthCookies(context);

    await page.goto('/admin/dashboard/thank-you-notes', { waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).pathname).toBe('/admin/dashboard/thank-you-notes');
    await expect(page.getByRole('heading', { name: 'Thank-You Note Manager' })).toBeVisible();

    const axeBuilder = new AxeBuilder({ page }).withTags(a11yConfig.runOnly.values);
    if (a11yConfig.rules) {
      axeBuilder.options({ rules: a11yConfig.rules });
    }
    const results = await axeBuilder.analyze();
    recordRouteViolations('/admin/dashboard/thank-you-notes', results.violations);
    expect(results.violations).toEqual([]);
  });

  test('should pass axe accessibility scan on /admin/dashboard/seating-chart with zero violations', async ({ context, page }) => {
    await seedAdminAndGuestAuthCookies(context);

    await page.goto('/admin/dashboard/seating-chart', { waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).pathname).toBe('/admin/dashboard/seating-chart');
    await expect(
      page.getByRole('heading', { name: 'Interactive Seating Chart & Reception Floorplan' })
    ).toBeVisible();
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('main main')).toHaveCount(0);

    const axeBuilder = new AxeBuilder({ page }).withTags(a11yConfig.runOnly.values);
    if (a11yConfig.rules) {
      axeBuilder.options({ rules: a11yConfig.rules });
    }
    const results = await axeBuilder.analyze();
    recordRouteViolations('/admin/dashboard/seating-chart', results.violations);
    expect(results.violations).toEqual([]);

    await page.emulateMedia({ media: 'print' });
    await expect(
      page.getByRole('region', { name: 'Reception Seating Roster & Floorplan' })
    ).toBeVisible();
    await page.emulateMedia({ media: 'screen' });
  });

  test('should pass axe accessibility scan including label-content-name-mismatch on /photos/slideshow in light and dark modes', async ({
    context,
    page,
  }) => {
    await seedGuestAuthCookies(context);

    for (const mode of ['light', 'dark'] as const) {
      await page.addInitScript((themeMode) => {
        window.localStorage.setItem('theme-mode', themeMode);
      }, mode);

      await page.goto('/photos/slideshow', { waitUntil: 'domcontentloaded' });
      expect(new URL(page.url()).pathname).toBe('/photos/slideshow');

      await page.evaluate((themeMode) => {
        document.documentElement.classList.toggle('dark', themeMode === 'dark');
        document.documentElement.setAttribute('data-theme', themeMode);
      }, mode);

      await expect(
        page.getByRole('button', { name: '5s cycle photo every 5 seconds' })
      ).toBeVisible();
      await expect(
        page.getByRole('button', { name: '8s cycle photo every 8 seconds' })
      ).toHaveAttribute('aria-pressed', 'true');
      await expect(
        page.getByRole('button', { name: '10s cycle photo every 10 seconds' })
      ).toBeVisible();

      await expect(page.locator('main#main-content')).toHaveAttribute('tabindex', '-1');
      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.locator('main main')).toHaveCount(0);
      await expect(
        page.getByRole('complementary', { name: 'Guest Photo Upload QR Code' })
      ).toBeVisible();
      await expect(page.getByRole('toolbar', { name: 'Slideshow Controls' })).toBeVisible();

      const axeBuilder = new AxeBuilder({ page })
        .withTags(a11yConfig.runOnly.values)
        .options({
          rules: {
            ...a11yConfig.rules,
            'label-content-name-mismatch': { enabled: true },
          },
        });
      const results = await axeBuilder.analyze();
      recordRouteViolations(`/photos/slideshow (${mode})`, results.violations);
      expect(results.violations).toEqual([]);
    }
  });

  test('should pass axe accessibility scan on /guest/collect with one top-level main#main-content and zero violations', async ({
    context,
    page,
  }) => {
    await seedGuestAuthCookies(context);

    await page.goto('/guest/collect', { waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).pathname).toBe('/guest/collect');
    await expect(page.getByRole('heading', { name: 'Mailing Address Form' })).toBeVisible();
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('main main')).toHaveCount(0);
    await expect(page.locator('main#main-content')).toHaveAttribute('tabindex', '-1');

    const axeBuilder = new AxeBuilder({ page })
      .withTags(a11yConfig.runOnly.values)
      .options({ rules: a11yConfig.rules });
    const results = await axeBuilder.analyze();
    recordRouteViolations('/guest/collect', results.violations);
    expect(results.violations).toEqual([]);
  });

  test('should pass axe accessibility scan across all admin studio preview routes without duplicate iframe landmarks', async ({
    context,
    page,
  }) => {
    test.setTimeout(120_000);
    await seedAdminAndGuestAuthCookies(context);

    const studioPreviewRoutes = [
      '/admin/dashboard/settings',
      '/admin/dashboard/content',
      '/admin/dashboard/wedding-party',
      '/admin/dashboard/attractions',
    ] as const;

    for (const studioRoute of studioPreviewRoutes) {
      await page.goto(studioRoute, { waitUntil: 'domcontentloaded' });
      expect(new URL(page.url()).pathname).toBe(studioRoute);

      const previewIframe = page.locator('iframe[title="Live Preview"]');
      await expect(previewIframe).toBeVisible();

      const previewFrame = page.frameLocator('iframe[title="Live Preview"]');
      await expect(previewFrame.getByRole('region', { name: 'Live Preview' })).toBeAttached({
        timeout: 15_000,
      });
      await expect(previewFrame.locator('h1').first()).toBeVisible({
        timeout: 15_000,
      });
      await expect
        .poll(
          async () =>
            previewFrame
              .locator('#home-main > section:first-child [style*="opacity"]')
              .evaluateAll((els) => els.every((el) => Number(getComputedStyle(el).opacity) >= 0.99)),
          { timeout: 10_000 }
        )
        .toBe(true);
      await expect(previewFrame.locator('main')).toHaveCount(0);
      await expect(previewFrame.locator('header')).toHaveCount(0);
      await expect(previewFrame.locator('footer')).toHaveCount(0);

      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.locator('main main')).toHaveCount(0);

      const axeBuilder = new AxeBuilder({ page })
        .withTags(a11yConfig.runOnly.values)
        .options({ rules: a11yConfig.rules });
      const results = await axeBuilder.analyze();
      recordRouteViolations(studioRoute, results.violations);
      expect(results.violations).toEqual([]);
    }
  });
});
