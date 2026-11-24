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
      await expect(previewIframe).toBeVisible({ timeout: 15_000 });

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

  test('should pass WCAG 2.2 A/AA axe checks across /registry grid, dual price filter, empty state, and contribution modal in light and dark modes', async ({
    context,
    page,
  }) => {
    await seedGuestAuthCookies(context);

    const mockRegistryItems = [
      {
        id: 'a11y-item-1',
        name: 'Artisan Stand Mixer',
        description: 'Tilt-head stand mixer for weekend baking.',
        price: 349.99,
        image: '',
        url: 'https://example.com/mixer',
        vendor: 'Kitchen Co',
        category: 'Kitchen',
        quantity: 1,
        isGroupGift: false,
        isMostWanted: true,
        purchased: false,
        purchaserName: null,
        amountContributed: 0,
        contributors: [],
        itemType: 'product',
      },
      {
        id: 'a11y-item-2',
        name: 'Amalfi Coast Honeymoon Fund',
        description: 'Contribute toward coastal excursions and dinners.',
        price: 1000,
        image: '',
        url: null,
        vendor: null,
        category: 'Honeymoon',
        quantity: 1,
        isGroupGift: true,
        isMostWanted: false,
        purchased: false,
        purchaserName: null,
        amountContributed: 450,
        contributors: [],
        itemType: 'cash',
      },
      {
        id: 'a11y-item-3',
        name: 'Linen Duvet Set',
        description: 'Stonewashed flax linen bedding.',
        price: 220,
        image: '',
        url: 'https://example.com/duvet',
        vendor: 'Home Loom',
        category: 'Bedroom',
        quantity: 1,
        isGroupGift: false,
        isMostWanted: false,
        purchased: true,
        purchaserName: 'Jordan Lee',
        amountContributed: 220,
        contributors: [],
        itemType: 'product',
      },
    ];

    await page.route('**/api/registry/items*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            items: mockRegistryItems,
            total: mockRegistryItems.length,
            page: 1,
            limit: 200,
          },
        }),
      });
    });

    await page.route('**/api/registry/validate-code*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          valid: true,
          guestName: 'Taylor Morgan',
          code: 'WED2026A',
        }),
      });
    });

    const runRegistryAxe = async (label: string) => {
      const axeBuilder = new AxeBuilder({ page })
        .exclude('iframe')
        .withTags(a11yConfig.runOnly.values);
      if (a11yConfig.rules) {
        axeBuilder.options({ rules: a11yConfig.rules });
      }
      const results = await axeBuilder.analyze();
      recordRouteViolations(label, results.violations);
      expect(results.violations).toEqual([]);
    };

    for (const mode of ['light', 'dark'] as const) {
      await page.addInitScript((themeMode) => {
        window.localStorage.setItem('theme-mode', themeMode);
      }, mode);

      await page.goto('/registry', { waitUntil: 'domcontentloaded' });
      expect(new URL(page.url()).pathname).toBe('/registry');

      await page.evaluate((themeMode) => {
        document.documentElement.classList.toggle('dark', themeMode === 'dark');
        document.documentElement.classList.toggle('light', themeMode === 'light');
        document.documentElement.setAttribute('data-theme', themeMode);
      }, mode);

      await expect(page.getByRole('heading', { level: 1, name: 'Wedding Registry' })).toBeVisible();
      await expect(page.getByTestId('registry-card').first()).toBeVisible({ timeout: 15000 });
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('[data-testid="registry-card"]'));
            if (cards.length === 0) return false;
            return cards.every((card) => {
              let el: HTMLElement | null = card as HTMLElement;
              while (el) {
                if (window.getComputedStyle(el).opacity !== '1') return false;
                el = el.parentElement;
              }
              return true;
            });
          })
        )
        .toBe(true);

      await expect(page.getByRole('slider', { name: 'Minimum price' })).toHaveAttribute(
        'aria-valuetext',
        /^\$/
      );
      await expect(page.getByRole('slider', { name: 'Maximum price' })).toHaveAttribute(
        'aria-valuetext',
        /^\$/
      );

      // 1. Scan registry grid (available, group gift, and claimed cards) & filters
      await runRegistryAxe(`/registry grid (${mode})`);

      // 2. Open contribution modal, verify invitation code status + Clear button, and scan modal dialog
      await page.getByTestId('registry-card').first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await runRegistryAxe(`/registry modal initial (${mode})`);

      const codeInput = dialog.getByLabel(/Invitation Code/i);
      if ((await codeInput.count()) > 0 && !(await codeInput.inputValue())) {
        await codeInput.fill('WED2026A');
        await expect(dialog.getByText(/Code verified! Name pre-filled\./i)).toBeVisible();
        const clearBtn = dialog.getByRole('button', { name: 'Clear' });
        await expect(clearBtn).toBeFocused();
        await runRegistryAxe(`/registry modal verified (${mode})`);
        await clearBtn.click();
        await expect(codeInput).toBeFocused();
      } else {
        await runRegistryAxe(`/registry modal verified (${mode})`);
      }

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      // 3. Trigger zero-result filtered EmptyState and verify polite status + axe scan
      const searchInput = page.locator('#registry-search-input');
      await searchInput.fill('__no_matching_gift_99999__');
      const emptyStatus = page.getByRole('status').filter({
        hasText: /No gifts match the current filters/i,
      });
      await expect(emptyStatus).toBeVisible();
      await runRegistryAxe(`/registry filtered empty state (${mode})`);
      await searchInput.fill('');
    }
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
