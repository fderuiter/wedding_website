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

      // The main content should be visible
      const mainContent = page.locator('main#main-content');
      await expect(mainContent).toBeVisible();

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

    const axeBuilder = new AxeBuilder({ page }).withTags(a11yConfig.runOnly.values);
    if (a11yConfig.rules) {
      axeBuilder.options({ rules: a11yConfig.rules });
    }
    const results = await axeBuilder.analyze();
    recordRouteViolations('/admin/dashboard/seating-chart', results.violations);
    expect(results.violations).toEqual([]);
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

  test('should skip static Wedding Registry heading on Tab and pass axe heading checks on /registry', async ({
    context,
    page,
  }) => {
    await seedGuestAuthCookies(context);

    await page.goto('/registry', { waitUntil: 'domcontentloaded' });
    expect(new URL(page.url()).pathname).toBe('/registry');

    const registryHeading = page.getByRole('heading', { level: 1, name: 'Wedding Registry' });
    await expect(registryHeading).toBeVisible();
    await expect(registryHeading).not.toHaveAttribute('tabindex');

    // Focus the last focusable control in the top header, then press Tab once:
    // focus must move directly to the search input without stopping on the static h1.
    const focusedLastNavControl = await page.evaluate(() => {
      const headerControls = Array.from(
        document.querySelectorAll<HTMLElement>(
          'header a[href], header button:not([disabled]), nav[aria-label="Primary"] a[href], nav[aria-label="Primary"] button:not([disabled])'
        )
      ).filter((el) => el.offsetParent !== null);
      const last = headerControls[headerControls.length - 1];
      if (!last) return false;
      last.focus();
      return document.activeElement === last;
    });
    expect(focusedLastNavControl).toBe(true);

    await page.keyboard.press('Tab');
    await expect(page.locator('#registry-search-input')).toBeFocused();

    const axeBuilder = new AxeBuilder({ page }).withTags(a11yConfig.runOnly.values);
    if (a11yConfig.rules) {
      axeBuilder.options({ rules: a11yConfig.rules });
    }
    const results = await axeBuilder.analyze();
    recordRouteViolations('/registry', results.violations);
    expect(results.violations).toEqual([]);
  });

  test('should expose a single h1 and zero heading-order violations across 404, standalone editors, media, and admin dashboard routes', async ({
    context,
    page,
  }) => {
    await seedAdminAndGuestAuthCookies(context);

    const routesToAudit = [
      '/missing-route-404-heading-audit',
      '/heart',
      '/schedule',
      '/history',
      '/things-to-do',
      '/wedding-party',
      '/registry/add-item',
      '/registry/edit-item/1',
      '/admin/dashboard',
      '/admin/dashboard/site-manager',
      '/admin/dashboard/registry',
      '/admin/dashboard/settings',
    ];

    for (const route of routesToAudit) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('h1')).toHaveCount(1);

      const axeBuilder = new AxeBuilder({ page })
        .exclude('iframe')
        .withTags(a11yConfig.runOnly.values);
      if (a11yConfig.rules) {
        axeBuilder.options({ rules: a11yConfig.rules });
      }
      const results = await axeBuilder.analyze();
      recordRouteViolations(route, results.violations);
      expect(results.violations).toEqual([]);
    }
  });
});
