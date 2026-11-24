import { test, expect, type Page } from '@playwright/test';
import {
  generateAdminCookieValue,
  seedAdminAndGuestAuthCookies,
  seedGuestAuthCookies,
} from './helpers/auth';
import {
  inspectFocusedControlOcclusion,
  type FocusOcclusionSampleResult,
} from './helpers/focusOcclusion';

const RESPONSIVE_WIDTHS = [375, 768, 1024, 1280] as const;

async function tabAndAuditControls(
  page: Page,
  steps: number,
  direction: 'forward' | 'backward'
): Promise<FocusOcclusionSampleResult[]> {
  const results: FocusOcclusionSampleResult[] = [];
  const key = direction === 'forward' ? 'Tab' : 'Shift+Tab';

  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press(key);
    const sample = await inspectFocusedControlOcclusion(page);
    if (sample) {
      results.push(sample);
    }
  }

  return results;
}

test.describe('Sticky Bar Focus Occlusion (WCAG 2.4.11 & C43)', { tag: ['@a11y'] }, () => {
  test.beforeAll(async ({ request }) => {
    const adminCookie = generateAdminCookieValue();
    const res = await request.post('/api/admin/sample-data', {
      headers: { Cookie: `admin_auth=${adminCookie}` },
      data: {
        archetype: 'classic',
        modules: ['registry', 'guests'],
      },
    });
    expect(res.ok()).toBe(true);
  });

  test.afterAll(async ({ request }) => {
    const adminCookie = generateAdminCookieValue();
    await request.delete('/api/admin/sample-data', {
      headers: { Cookie: `admin_auth=${adminCookie}` },
    });
  });

  test('tabbing and reverse-tabbing across / and /registry keeps 0 obscured controls and visible focus outlines at 375px, 768px, 1024px, and 1280px', async ({
    context,
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await seedGuestAuthCookies(context);

    for (const width of RESPONSIVE_WIDTHS) {
      const height = width === 375 ? 812 : width === 768 ? 1024 : 720;
      await page.setViewportSize({ width, height });

      // 1. Audit Home (/)
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('header[aria-label="Site header"]')).toBeVisible();

      await page.focus('body');
      const homeForward = await tabAndAuditControls(page, 14, 'forward');
      const homeBackward = await tabAndAuditControls(page, 10, 'backward');

      for (const item of [...homeForward, ...homeBackward]) {
        expect(item.fullyObscured, `Obscured on / at ${width}px: ${JSON.stringify(item)}`).toBe(
          false
        );
        expect(
          item.hasVisibleFocusIndicator,
          `Missing :focus-visible indicator on / at ${width}px: ${JSON.stringify(item)}`
        ).toBe(true);
      }

      // 2. Audit Registry (/registry)
      await page.goto('/registry', { waitUntil: 'domcontentloaded' });
      const filterNav = page.getByRole('navigation', { name: 'Registry Filters' });
      await expect(filterNav).toBeVisible();
      await expect(page.getByTestId('registry-card').first()).toBeVisible();

      const offsets = await page.evaluate(() => {
        const header = document.querySelector('header[aria-label="Site header"]');
        const filters = document.querySelector('nav[aria-label="Registry Filters"]');
        const htmlStyle = window.getComputedStyle(document.documentElement);
        const headerH = header ? header.getBoundingClientRect().height : 0;
        const filtersH = filters ? filters.getBoundingClientRect().height : 0;
        const scrollPaddingTop = Number.parseFloat(htmlStyle.scrollPaddingTop) || 0;
        return { headerH, filtersH, scrollPaddingTop };
      });

      expect(offsets.scrollPaddingTop).toBeGreaterThanOrEqual(
        Math.floor(offsets.headerH + offsets.filtersH)
      );

      await page.focus('body');
      const registryForward = await tabAndAuditControls(page, 22, 'forward');
      if (width === 1280) {
        await page.screenshot({
          path: testInfo.outputPath('registry-focus-clearance-desktop.png'),
          animations: 'disabled',
        });
      }
      const registryBackward = await tabAndAuditControls(page, 16, 'backward');

      for (const item of [...registryForward, ...registryBackward]) {
        expect(
          item.fullyObscured,
          `Obscured on /registry at ${width}px: ${JSON.stringify(item)}`
        ).toBe(false);
        expect(
          item.hasVisibleFocusIndicator,
          `Missing :focus-visible indicator on /registry at ${width}px: ${JSON.stringify(item)}`
        ).toBe(true);
      }
    }
  });

  test('Registry Filters sticks cleanly below wrapped Admin Navbar at 768px without overlap', async ({
    context,
    page,
  }, testInfo) => {
    await seedAdminAndGuestAuthCookies(context);
    await page.addInitScript(() => {
      window.localStorage.setItem('isAdminLoggedIn', 'true');
    });

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/registry', { waitUntil: 'domcontentloaded' });

    const header = page.locator('header[aria-label="Site header"]');
    const filterNav = page.getByRole('navigation', { name: 'Registry Filters' });
    await expect(header).toBeVisible();
    await expect(filterNav).toBeVisible();
    await expect(page.getByTestId('registry-card').first()).toBeVisible();

    // Scroll down so Registry Filters engages sticky positioning beneath wrapped Admin Navbar
    await page.evaluate(() => window.scrollTo(0, 500));

    const layoutMetrics = await page.evaluate(() => {
      const headerEl = document.querySelector('header[aria-label="Site header"]')!;
      const filterEl = document.querySelector('nav[aria-label="Registry Filters"]')!;
      const headerRect = headerEl.getBoundingClientRect();
      const filterRect = filterEl.getBoundingClientRect();
      const scrollPaddingTop =
        Number.parseFloat(window.getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      return {
        headerBottom: headerRect.bottom,
        headerHeight: headerRect.height,
        filterTop: filterRect.top,
        filterHeight: filterRect.height,
        scrollPaddingTop,
      };
    });

    expect(layoutMetrics.filterTop).toBeGreaterThanOrEqual(layoutMetrics.headerBottom - 1);
    expect(layoutMetrics.scrollPaddingTop).toBeGreaterThanOrEqual(
      Math.floor(layoutMetrics.headerHeight + layoutMetrics.filterHeight)
    );

    // Tab through gift cards while scrolled and verify 0 obscured controls
    const firstCardShare = page
      .getByTestId('registry-card')
      .first()
      .getByRole('button', { name: /^Share / });
    await firstCardShare.focus();
    const forwardSamples = await tabAndAuditControls(page, 10, 'forward');
    const backwardSamples = await tabAndAuditControls(page, 8, 'backward');

    for (const sample of [...forwardSamples, ...backwardSamples]) {
      expect(sample.fullyObscured).toBe(false);
    }

    await page.screenshot({
      path: testInfo.outputPath('registry-admin-768px-sticky-stack.png'),
      animations: 'disabled',
    });
  });

  test('tabbing and reverse-tabbing across /admin/dashboard/settings clears the 72px sticky footer on #studio-left-pane with 0 obscured controls', async ({
    context,
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await seedAdminAndGuestAuthCookies(context);
    await page.addInitScript(() => {
      window.localStorage.setItem('isAdminLoggedIn', 'true');
    });

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/admin/dashboard/settings', { waitUntil: 'domcontentloaded' });

    const leftPane = page.locator('#studio-left-pane[data-scroll-region]');
    await expect(leftPane).toBeVisible();
    const saveButton = page.getByRole('button', { name: 'Save Settings' });
    await expect(saveButton).toBeVisible();

    const paneMetrics = await leftPane.evaluate((pane) => {
      const style = window.getComputedStyle(pane);
      return {
        localStickyBottom: pane.style.getPropertyValue('--local-sticky-bottom'),
        scrollPaddingBottom: Number.parseFloat(style.scrollPaddingBottom) || 0,
      };
    });

    expect(Number.parseFloat(paneMetrics.localStickyBottom)).toBeGreaterThanOrEqual(64);
    expect(paneMetrics.scrollPaddingBottom).toBeGreaterThanOrEqual(72);

    // Tab through all form controls inside #studio-left-pane from first input to Save Settings
    const firstFormControl = leftPane.locator('input, select, textarea, button').first();
    await firstFormControl.focus();

    const forwardResults: FocusOcclusionSampleResult[] = [];
    for (let step = 0; step < 120; step += 1) {
      await page.keyboard.press('Tab');
      const sample = await inspectFocusedControlOcclusion(page);
      if (sample) {
        forwardResults.push(sample);
        if (sample.label === 'Save Settings') {
          break;
        }
      }
    }

    expect(forwardResults.length).toBeGreaterThan(20);
    for (const item of forwardResults) {
      expect(
        item.fullyObscured,
        `Obscured on forward Tab in AdminSettingsClient: ${JSON.stringify(item)}`
      ).toBe(false);
    }

    // Reverse-tab back up from Save Settings across bottom SEO & file upload controls
    const initialReverseResults = await tabAndAuditControls(page, 2, 'backward');
    await page.screenshot({
      path: testInfo.outputPath('admin-settings-sticky-footer-clearance.png'),
      animations: 'disabled',
    });
    const remainingReverseResults = await tabAndAuditControls(page, 18, 'backward');
    const reverseResults = [...initialReverseResults, ...remainingReverseResults];
    for (const item of reverseResults) {
      expect(
        item.fullyObscured,
        `Obscured on Shift+Tab in AdminSettingsClient: ${JSON.stringify(item)}`
      ).toBe(false);
    }
  });

  test('BroadcastModal [data-scroll-region] and InvitationCodes floating batch toolbar publish bottom offsets and prevent occlusion', async ({
    context,
    page,
  }) => {
    await seedAdminAndGuestAuthCookies(context);
    await page.addInitScript(() => {
      window.localStorage.setItem('isAdminLoggedIn', 'true');
    });

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/admin/dashboard/invitation-codes', { waitUntil: 'domcontentloaded' });

    // Select guest rows to mount the floating Batch actions toolbar
    const selectAllCheckbox = page.getByRole('checkbox', {
      name: 'Select all filtered invitation codes',
    });
    await expect(selectAllCheckbox).toBeVisible({ timeout: 15_000 });
    await selectAllCheckbox.check();

    const batchToolbar = page.getByRole('region', { name: 'Batch actions toolbar' });
    await expect(batchToolbar).toBeVisible();

    const docBottomExtra = await page.evaluate(() =>
      Number.parseFloat(
        document.documentElement.style.getPropertyValue('--sticky-bottom-extra')
      ) || 0
    );
    expect(docBottomExtra).toBeGreaterThan(50);

    // Open BroadcastModal from the batch toolbar and verify [data-scroll-region] --local-sticky-bottom
    await batchToolbar.getByRole('button', { name: /Send Broadcast/i }).click();
    const dialog = page.getByRole('dialog', { name: 'Compose Multi-Channel Broadcast' });
    await expect(dialog).toBeVisible();

    const dialogScrollMetrics = await dialog.evaluate((dlg) => {
      const region = dlg.querySelector<HTMLElement>('[data-scroll-region]');
      if (!region) {
        return null;
      }
      const computed = window.getComputedStyle(region);
      return {
        localStickyBottom: Number.parseFloat(
          region.style.getPropertyValue('--local-sticky-bottom')
        ) || 0,
        scrollPaddingBottom: Number.parseFloat(computed.scrollPaddingBottom) || 0,
      };
    });

    expect(dialogScrollMetrics).not.toBeNull();
    expect(dialogScrollMetrics!.localStickyBottom).toBeGreaterThan(36);
    expect(dialogScrollMetrics!.scrollPaddingBottom).toBeGreaterThan(44);

    // Tab through BroadcastModal fields and verify 0 obscured controls
    const modalSamples = await tabAndAuditControls(page, 18, 'forward');
    for (const sample of modalSamples) {
      expect(
        sample.fullyObscured,
        `Obscured inside BroadcastModal: ${JSON.stringify(sample)}`
      ).toBe(false);
    }
  });

  test('caps scroll-padding-top at 45vh on short mobile viewports (max-height: 560px) and respects prefers-reduced-motion', async ({
    context,
    page,
  }) => {
    await seedAdminAndGuestAuthCookies(context);
    await page.addInitScript(() => {
      window.localStorage.setItem('isAdminLoggedIn', 'true');
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // 768x500 short landscape/mobile viewport where wrapped Admin Navbar + Registry Filters > 225px (45vh)
    await page.setViewportSize({ width: 768, height: 500 });
    await page.goto('/registry', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('navigation', { name: 'Registry Filters' })).toBeVisible();

    const shortViewportMetrics = await page.evaluate(() => {
      const htmlStyle = window.getComputedStyle(document.documentElement);
      return {
        scrollPaddingTop: Number.parseFloat(htmlStyle.scrollPaddingTop) || 0,
        scrollBehavior: htmlStyle.scrollBehavior,
        maxCapPx: window.innerHeight * 0.45,
      };
    });

    expect(shortViewportMetrics.scrollPaddingTop).toBeLessThanOrEqual(
      shortViewportMetrics.maxCapPx + 0.5
    );
    expect(shortViewportMetrics.scrollBehavior).toBe('auto');
  });
});
