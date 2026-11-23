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
    { tag: '@smoke' },
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
});
