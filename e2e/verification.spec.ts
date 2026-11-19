import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { a11yConfig } from '../src/a11y-config';
import fs from 'fs';
import path from 'path';
import { seedAdminAndGuestAuthCookies, seedGuestAuthCookies } from './helpers/auth';

test.describe('UI Verification', () => {
  test('should show the main content on visit and be accessible', async ({ context, page }) => {
    await seedGuestAuthCookies(context);

    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('crashed') || msg.includes('closed') || msg.includes('net::ERR_ABORTED')) {
        await seedGuestAuthCookies(context).catch(() => {});
        page = await context.newPage();
        await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      } else {
        throw err;
      }
    }

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

    const reportDir = path.join(process.cwd(), 'test-results');
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    const reportFile = path.join(reportDir, 'playwright-a11y-violations.json');
    let existingViolations = [];
    if (fs.existsSync(reportFile)) {
      existingViolations = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    }
    fs.writeFileSync(reportFile, JSON.stringify([...existingViolations, ...accessibilityScanResults.violations], null, 2));

    // Assert no violations
    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('should pass axe accessibility scan on /weather route with zero contrast violations', async ({ context, page }) => {
    await seedGuestAuthCookies(context);

    try {
      await page.goto('/weather', { waitUntil: 'domcontentloaded' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('crashed') || msg.includes('closed') || msg.includes('net::ERR_ABORTED')) {
        await seedGuestAuthCookies(context).catch(() => {});
        page = await context.newPage();
        await page.goto('/weather', { waitUntil: 'domcontentloaded', timeout: 30000 });
      } else {
        throw err;
      }
    }

    expect(new URL(page.url()).pathname).toBe('/weather');

    const axeBuilder = new AxeBuilder({ page }).withTags(a11yConfig.runOnly.values);
    if (a11yConfig.rules) {
      axeBuilder.options({ rules: a11yConfig.rules });
    }
    const results = await axeBuilder.analyze();
    expect(results.violations.filter((v) => v.id === 'color-contrast')).toEqual([]);
  });

  test('should pass axe accessibility scan on /admin/dashboard/thank-you-notes with zero contrast violations', async ({ context, page }) => {
    await seedAdminAndGuestAuthCookies(context);

    try {
      await page.goto('/admin/dashboard/thank-you-notes', { waitUntil: 'domcontentloaded' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('crashed') || msg.includes('closed') || msg.includes('net::ERR_ABORTED')) {
        await seedAdminAndGuestAuthCookies(context).catch(() => {});
        page = await context.newPage();
        await page.goto('/admin/dashboard/thank-you-notes', { waitUntil: 'domcontentloaded', timeout: 30000 });
      } else {
        throw err;
      }
    }

    expect(new URL(page.url()).pathname).toBe('/admin/dashboard/thank-you-notes');

    const axeBuilder = new AxeBuilder({ page }).withTags(a11yConfig.runOnly.values);
    if (a11yConfig.rules) {
      axeBuilder.options({ rules: a11yConfig.rules });
    }
    const results = await axeBuilder.analyze();
    expect(results.violations.filter((v) => v.id === 'color-contrast')).toEqual([]);
  });

  test('should pass axe accessibility scan on /admin/dashboard/seating-chart with zero contrast violations', async ({ context, page }) => {
    await seedAdminAndGuestAuthCookies(context);

    try {
      await page.goto('/admin/dashboard/seating-chart', { waitUntil: 'domcontentloaded' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('crashed') || msg.includes('closed') || msg.includes('net::ERR_ABORTED')) {
        await seedAdminAndGuestAuthCookies(context).catch(() => {});
        page = await context.newPage();
        await page.goto('/admin/dashboard/seating-chart', { waitUntil: 'domcontentloaded', timeout: 30000 });
      } else {
        throw err;
      }
    }

    expect(new URL(page.url()).pathname).toBe('/admin/dashboard/seating-chart');

    const axeBuilder = new AxeBuilder({ page }).withTags(a11yConfig.runOnly.values);
    if (a11yConfig.rules) {
      axeBuilder.options({ rules: a11yConfig.rules });
    }
    const results = await axeBuilder.analyze();
    expect(results.violations.filter((v) => v.id === 'color-contrast')).toEqual([]);
  });
});
